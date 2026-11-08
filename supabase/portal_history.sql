create table public.one_on_one_history (
 id uuid primary key default gen_random_uuid(),
 one_on_one_id uuid not null references public.one_on_ones(id),
 member_id uuid not null references public.members(id),
 director_id uuid not null references public.directors(id),
 previous_status text not null,
 scheduled_date timestamptz,
 location_method text,
 meeting_method text,
 changed_by uuid references auth.users(id),
 changed_at timestamptz not null default now()
);
alter table public.one_on_one_history enable row level security;
create policy meeting_history_read on public.one_on_one_history for select to authenticated using(portal_private.member_access(member_id));
grant select on public.one_on_one_history to authenticated;
revoke insert,update,delete on public.one_on_one_history from anon,authenticated;
create index meeting_history_member_idx on public.one_on_one_history(member_id);
create function portal_private.meeting_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.status,old.scheduled_date,old.location_method,old.meeting_method) is distinct from (new.status,new.scheduled_date,new.location_method,new.meeting_method) then
 insert into public.one_on_one_history(one_on_one_id,member_id,director_id,previous_status,scheduled_date,location_method,meeting_method,changed_by)
 values(old.id,old.member_id,old.director_id,old.status,old.scheduled_date,old.location_method,old.meeting_method,auth.uid());
 end if;return new;
end $$;
revoke all on function portal_private.meeting_history() from public,anon,authenticated;
create trigger portal_history after update on public.one_on_ones for each row execute function portal_private.meeting_history();
-- Directors may restart a canceled requirement. Its canceled snapshot is retained.
do $$ declare d text; begin
 select pg_get_functiondef('portal_private.mutate(text,uuid,jsonb)'::regprocedure) into d;
 d:=replace(d, 'if row_data->>''status'' in (''completed'',''canceled'') then', 'if row_data->>''status''=''completed'' or (row_data->>''status''=''canceled'' and payload->>''status''<>''scheduled'') then');
 execute d;
end $$;
create policy historical_directors_read on public.directors for select to authenticated using
 (exists(select 1 from public.one_on_ones o where o.director_id=directors.id and portal_private.owns_member(o.member_id)));

create or replace function portal_private.directory() returns setof public.alumni_directory language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not (portal_private.member_cohort(null) or public.is_current_director() or portal_private.is_admin()) then raise exception 'Portal access required'; end if;
 return query select * from public.alumni_directory
 union all
 select m.id,m.first_name,m.last_name,m.preferred_name,m.graduation_year,m.major,m.alumni_company,m.alumni_role,
 case when m.show_linkedin then m.linkedin_url else null end,
 case when m.show_email then m.uf_email else null end,m.show_email,c.name,c.class_number
 from public.members m join public.cohorts c on c.id=m.cohort_id
 where m.program_status='archived' and m.show_in_alumni_directory;
end $$;
notify pgrst,'reload schema';
