begin;
alter table public.point_submissions add column if not exists removed_at timestamptz;

create or replace function portal_private.edit_points(record_id uuid,payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.point_submissions%rowtype; person public.members%rowtype; desired text; award integer; actor uuid; actor_name text; snapshot jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select * into p from public.point_submissions where id=record_id for update;
 if not found then raise exception 'Point entry not found'; end if;
 select * into person from public.members where id=p.member_id for share;
 if not portal_private.can_manage(person.cohort_id,'points') then raise exception 'Point management access required'; end if;
 if person.program_status<>'active' then raise exception 'Historical points are read-only for inactive or archived Trailblazers'; end if;
 snapshot:=jsonb_build_object('activity_name',p.activity_name,'activity_date',p.activity_date,'category',p.category,'points_awarded',p.points_awarded,'status',p.status,'director_note',p.director_note,'reviewed_at',p.reviewed_at,'removed_at',p.removed_at);
 if payload->'expected' is null or payload->'expected' is distinct from snapshot then raise exception 'This point entry changed. Refresh and try again.'; end if;
 select id,first_name||' '||last_name into actor,actor_name from public.directors where auth_user_id=auth.uid() and active limit 1;
 if payload->>'operation'='remove' then
   if p.status<>'approved' or p.removed_at is not null then raise exception 'Only approved points can be removed'; end if;
   if nullif(trim(payload->>'reason'),'') is null then raise exception 'Enter a reason for removal'; end if;
   update public.point_submissions set points_awarded=0,status='denied',removed_at=clock_timestamp(),director_note='Points removed: '||trim(payload->>'reason'),
     reviewed_by=actor,reviewed_at=clock_timestamp() where id=record_id;
 elsif payload->>'operation'='edit' then
   desired:=payload->>'status'; award:=(payload->>'points_awarded')::integer;
   if desired is null or desired not in ('approved','pending','needs_review','denied') or award is null or award not between 0 and 1000
     or nullif(trim(payload->>'activity_name'),'') is null or length(trim(payload->>'activity_name'))>200
     or (payload->>'activity_date')::date is null or (payload->>'activity_date')::date>(now() at time zone 'America/New_York')::date then
     raise exception 'Enter an activity, a valid date, status, and 0 to 1000 awarded points';
   end if;
   update public.point_submissions set activity_name=trim(payload->>'activity_name'),activity_date=(payload->>'activity_date')::date,
     category=nullif(trim(payload->>'category'),''),status=desired,points_awarded=case when desired='approved' then award else 0 end,
     removed_at=null,director_note=nullif(trim(payload->>'director_note'),''),reviewed_by=actor,reviewed_at=clock_timestamp() where id=record_id;
 else raise exception 'Invalid point operation'; end if;
 -- Existing audit trigger captures before/after values and the acting account.
 return record_id;
end $$;
create or replace function public.portal_edit_points(record_id uuid,payload jsonb)
returns uuid language sql security invoker set search_path='' as $$ select portal_private.edit_points(record_id,payload); $$;
revoke all on function public.portal_edit_points(uuid,jsonb),portal_private.edit_points(uuid,jsonb) from public,anon;
grant execute on function public.portal_edit_points(uuid,jsonb),portal_private.edit_points(uuid,jsonb) to authenticated;

-- Preserve assignment and submission notices, and describe ledger adjustments accurately.
do $$ declare definition text; begin
 select pg_get_functiondef('portal_private.inventory_notifications()'::regprocedure) into definition;
 if position('if tg_op=''INSERT'' and new.director_assigned then' in definition)=0 then raise exception 'Unexpected notification function. Review before applying.'; end if;
 definition:=replace(definition,'if tg_op=''INSERT'' and new.director_assigned then',
 'if tg_op=''UPDATE'' and (new.removed_at is distinct from old.removed_at or (new.status=old.status and (new.points_awarded is distinct from old.points_awarded or new.activity_name is distinct from old.activity_name))) then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page,dedupe_key)
    values(new.member_id,''accountability'',case when new.removed_at is not null then ''Points removed'' else ''Points updated'' end,
      new.activity_name||'': ''||case when new.status=''approved'' then coalesce(new.points_awarded,0) else 0 end||'' approved points. ''||coalesce(new.director_note,''''),''points'',''point-adjustment:''||new.id||'':''||gen_random_uuid());
  elsif tg_op=''INSERT'' and new.director_assigned then');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
