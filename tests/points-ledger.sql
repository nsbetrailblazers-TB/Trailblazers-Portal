-- Owner-run integration test. All point edits, audit rows, and queued notices roll back.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.portal_admins where active limit 1),true);
set local role authenticated;
do $$
declare mid uuid; rid uuid; p public.point_submissions%rowtype; expected jsonb; payload jsonb; rejected boolean:=false;
begin
 select id into mid from public.members where program_status='active' limit 1;
 if mid is null then raise exception 'An active Trailblazer is required for this test'; end if;
 rid:=public.portal_assign_points(jsonb_build_object('member_id',mid,'activity_name','Ledger test (rolled back)',
   'activity_date',(now() at time zone 'America/New_York')::date,'points_awarded',3,'request_id',gen_random_uuid()));
 select * into p from public.point_submissions where id=rid;
 expected:=jsonb_build_object('activity_name',p.activity_name,'activity_date',p.activity_date,'category',p.category,'points_awarded',p.points_awarded,'status',p.status,'director_note',p.director_note,'reviewed_at',p.reviewed_at,'removed_at',p.removed_at);
 payload:=jsonb_build_object('operation','edit','expected',expected,'activity_name','Corrected activity','activity_date',p.activity_date,'status','approved','points_awarded',7);
 perform public.portal_edit_points(rid,payload);
 select * into p from public.point_submissions where id=rid;
 if p.points_awarded<>7 or p.points_requested<>3 or p.activity_name<>'Corrected activity' then raise exception 'Free award editing failed'; end if;
 begin perform public.portal_edit_points(rid,payload); exception when others then
   if sqlerrm='This point entry changed. Refresh and try again.' then rejected:=true; else raise; end if;
 end;
 if not rejected then raise exception 'Stale edit accepted'; end if;
 expected:=jsonb_build_object('activity_name',p.activity_name,'activity_date',p.activity_date,'category',p.category,'points_awarded',p.points_awarded,'status',p.status,'director_note',p.director_note,'reviewed_at',p.reviewed_at,'removed_at',p.removed_at);
 perform public.portal_edit_points(rid,jsonb_build_object('operation','remove','reason','Duplicate award','expected',expected));
 select * into p from public.point_submissions where id=rid;
 if p.points_awarded<>0 or p.status<>'denied' or p.removed_at is null then raise exception 'Removal failed'; end if;
 expected:=jsonb_build_object('activity_name',p.activity_name,'activity_date',p.activity_date,'category',p.category,'points_awarded',p.points_awarded,'status',p.status,'director_note',p.director_note,'reviewed_at',p.reviewed_at,'removed_at',p.removed_at);
 payload:=jsonb_build_object('operation','edit','expected',expected,'activity_name',p.activity_name,'activity_date',p.activity_date,'status','approved','points_awarded',4);
 perform public.portal_edit_points(rid,payload);
 select * into p from public.point_submissions where id=rid;
 if p.points_awarded<>4 or p.status<>'approved' or p.removed_at is not null then raise exception 'Restoration failed'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 rejected:=false;
 begin perform public.portal_edit_points(rid,payload); exception when others then
   if sqlerrm='Point management access required' then rejected:=true; else raise; end if;
 end;
 if not rejected then raise exception 'Unauthorized edit accepted'; end if;
end $$;
select true as edits_removal_restore_stale_edit_and_access_checks_passed;
rollback;
