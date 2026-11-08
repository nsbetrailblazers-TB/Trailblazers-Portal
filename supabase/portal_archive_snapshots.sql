alter table public.members add column if not exists completion_snapshot jsonb;
create function portal_private.archive_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare required integer; completed integer; points integer; strikes integer; target integer;
begin
 if new.program_status='archived' and old.program_status<>'archived' then
  select count(*),count(*) filter(where exists(select 1 from public.one_on_ones o where o.member_id=new.id and o.director_id=a.director_id and o.status='completed')) into required,completed
   from public.director_assignments a join public.directors d on d.id=a.director_id where a.cohort_id=new.cohort_id and a.active and d.active and (a.start_date is null or a.start_date<=current_date) and (a.end_date is null or a.end_date>=current_date);
  select coalesce(sum(points_awarded),0) into points from public.point_submissions where member_id=new.id and status='approved';
  select count(*) into strikes from public.strikes where member_id=new.id and status='active';
  select point_requirement into target from public.cohorts where id=new.cohort_id;
  new.completion_snapshot:=jsonb_build_object('approved',points,'pending',0,'strikes',strikes,'completed',completed,'required',required,'point_requirement',target,'pointsMet',points>=target,'meetingsMet',required>0 and completed=required,'archived_at',now());
 end if;
 return new;
end $$;
create trigger portal_archive_snapshot before update on public.members for each row execute function portal_private.archive_snapshot();
revoke all on function portal_private.archive_snapshot() from public,anon,authenticated;
notify pgrst,'reload schema';
