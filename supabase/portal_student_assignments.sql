begin;
create table public.student_assignments (
 id uuid primary key default gen_random_uuid(), cohort_id uuid not null references public.cohorts(id),
 title text not null check(length(trim(title)) between 1 and 200), description text not null default '',
 deadline timestamptz, active boolean not null default true, targeted boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.assignment_recipients (
 assignment_id uuid references public.student_assignments(id) on delete cascade,
 member_id uuid references public.members(id), primary key(assignment_id,member_id)
);
create table public.assignment_submissions (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.student_assignments(id) on delete cascade,
 member_id uuid not null references public.members(id), method text not null check(method in ('file','link','text')),
 content text, file_path text, file_name text, status text not null default 'pending' check(status in ('pending','completed','denied')),
 feedback text not null default '', submitted_at timestamptz not null default clock_timestamp(), reviewed_at timestamptz,
 reviewer_id uuid references auth.users(id), unique(assignment_id,member_id),
 check((method='file' and file_path is not null) or (method in ('link','text') and length(trim(content))>0)),
 check(method<>'link' or content ~ '^https?://')
);
create index on public.student_assignments(cohort_id);
create index on public.assignment_recipients(member_id);
create index on public.assignment_submissions(member_id);
alter table public.student_assignments enable row level security;
alter table public.assignment_recipients enable row level security;
alter table public.assignment_submissions enable row level security;

create function portal_private.assignment_visible(aid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.student_assignments a where a.id=aid and
 (portal_private.can_manage(a.cohort_id,'content') or (a.active and exists(select 1 from public.members m
 where m.auth_user_id=auth.uid() and m.program_status='active' and m.cohort_id=a.cohort_id
 and (not a.targeted or exists(select 1 from public.assignment_recipients r where r.assignment_id=a.id and r.member_id=m.id))))));
$$;
revoke all on function portal_private.assignment_visible(uuid) from public,anon;
grant execute on function portal_private.assignment_visible(uuid) to authenticated;
grant select on public.student_assignments,public.assignment_recipients,public.assignment_submissions to authenticated;
create policy assignments_read on public.student_assignments for select to authenticated using(portal_private.assignment_visible(id));
create policy recipients_read on public.assignment_recipients for select to authenticated using(
 exists(select 1 from public.student_assignments a where a.id=assignment_recipients.assignment_id and portal_private.can_manage(a.cohort_id,'content'))
 or exists(select 1 from public.members m where m.id=assignment_recipients.member_id and m.auth_user_id=auth.uid()));
create policy submissions_read on public.assignment_submissions for select to authenticated using(
 exists(select 1 from public.student_assignments a where a.id=assignment_submissions.assignment_id and portal_private.can_manage(a.cohort_id,'content'))
 or (portal_private.assignment_visible(assignment_id) and exists(select 1 from public.members m where m.id=assignment_submissions.member_id and m.auth_user_id=auth.uid())));

create function portal_private.assignment_action(operation text,record_id uuid,payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.student_assignments; s public.assignment_submissions; m public.members; result_id uuid; cid uuid; recipient uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if operation='save' then
  if record_id is not null then
   select * into a from public.student_assignments where id=record_id for update;
   if not found then raise exception 'Assignment not found'; end if;
   cid:=a.cohort_id;
  else cid:=(payload->>'cohort_id')::uuid; end if;
  if not portal_private.can_manage(cid,'content') then raise exception 'Assignment management access required'; end if;
  if not exists(select 1 from public.cohorts where id=cid and status='active') then raise exception 'Choose an active cohort'; end if;
  if coalesce((payload->>'targeted')::boolean,false) and jsonb_array_length(coalesce(payload->'recipients','[]'))=0 then raise exception 'Choose at least one Trailblazer'; end if;
  if record_id is null then
   insert into public.student_assignments(cohort_id,title,description,deadline,active,targeted) values(cid,payload->>'title',coalesce(payload->>'description',''),(payload->>'deadline')::timestamptz,coalesce((payload->>'active')::boolean,true),coalesce((payload->>'targeted')::boolean,false)) returning id into result_id;
  else
   update public.student_assignments set title=payload->>'title',description=coalesce(payload->>'description',''),deadline=(payload->>'deadline')::timestamptz,active=coalesce((payload->>'active')::boolean,true),targeted=coalesce((payload->>'targeted')::boolean,false),updated_at=clock_timestamp() where id=record_id returning id into result_id;
  end if;
  delete from public.assignment_recipients where assignment_id=result_id;
  if coalesce((payload->>'targeted')::boolean,false) then
   for recipient in select distinct value::uuid from jsonb_array_elements_text(payload->'recipients') loop
    if not exists(select 1 from public.members where id=recipient and cohort_id=cid and program_status='active') then raise exception 'Recipient must be an active member of this cohort'; end if;
    insert into public.assignment_recipients values(result_id,recipient);
   end loop;
  end if;
  return result_id;
 elsif operation='remove' then
  select * into a from public.student_assignments where id=record_id for update;
  if not found or not portal_private.can_manage(a.cohort_id,'content') then raise exception 'Assignment management access required'; end if;
  delete from public.student_assignments where id=record_id; return record_id;
 elsif operation='submit' then
  select * into a from public.student_assignments where id=record_id for update;
  select * into m from public.members where auth_user_id=auth.uid() and program_status='active' and cohort_id=a.cohort_id;
  if m.id is null or not a.active or not portal_private.assignment_visible(record_id) then raise exception 'Assignment unavailable'; end if;
  if payload->>'method'='file' and (split_part(payload->>'file_path','/',1)<>auth.uid()::text or split_part(payload->>'file_path','/',2)<>record_id::text or not exists(select 1 from storage.objects where bucket_id='trailblazers-assignments' and name=payload->>'file_path')) then raise exception 'Upload a file for this assignment first'; end if;
  insert into public.assignment_submissions(assignment_id,member_id,method,content,file_path,file_name) values(record_id,m.id,payload->>'method',payload->>'content',case when payload->>'method'='file' then payload->>'file_path' end,case when payload->>'method'='file' then payload->>'file_name' end)
  on conflict(assignment_id,member_id) do update set method=excluded.method,content=excluded.content,file_path=excluded.file_path,file_name=excluded.file_name,status='pending',feedback='',submitted_at=clock_timestamp(),reviewed_at=null,reviewer_id=null returning id into result_id;
  return result_id;
 elsif operation='review' then
  select a0.* into a from public.student_assignments a0 join public.assignment_submissions s0 on s0.assignment_id=a0.id where s0.id=record_id for share of a0;
  select * into s from public.assignment_submissions where id=record_id for update;
  if s.id is null or not portal_private.can_manage(a.cohort_id,'content') then raise exception 'Assignment review access required'; end if;
  if s.submitted_at is distinct from (payload->>'expected_submitted_at')::timestamptz then raise exception 'The student resubmitted. Refresh before reviewing.'; end if;
  if payload->>'status' not in ('pending','completed','denied') then raise exception 'Invalid review status'; end if;
  update public.assignment_submissions set status=payload->>'status',feedback=coalesce(payload->>'feedback',''),reviewed_at=clock_timestamp(),reviewer_id=auth.uid() where id=record_id;
  return record_id;
 end if;
 raise exception 'Unknown assignment operation';
end $$;
revoke all on function portal_private.assignment_action(text,uuid,jsonb) from public,anon;
grant execute on function portal_private.assignment_action(text,uuid,jsonb) to authenticated;
create function public.portal_assignment(operation text,record_id uuid default null,payload jsonb default '{}') returns uuid
language sql security invoker set search_path='' as $$ select portal_private.assignment_action(operation,record_id,payload); $$;
revoke all on function public.portal_assignment(text,uuid,jsonb) from public,anon;
grant execute on function public.portal_assignment(text,uuid,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit) values('trailblazers-assignments','trailblazers-assignments',false,52428800) on conflict(id) do nothing;
create policy assignment_file_upload on storage.objects for insert to authenticated with check(bucket_id='trailblazers-assignments' and split_part(name,'/',1)=auth.uid()::text and exists(select 1 from public.student_assignments a join public.members m on m.cohort_id=a.cohort_id where a.id::text=split_part(name,'/',2) and a.active and m.auth_user_id=auth.uid() and m.program_status='active' and portal_private.assignment_visible(a.id)));
create policy assignment_file_read on storage.objects for select to authenticated using(bucket_id='trailblazers-assignments' and (split_part(name,'/',1)=auth.uid()::text or exists(select 1 from public.assignment_submissions s join public.student_assignments a on a.id=s.assignment_id where s.file_path=name and portal_private.can_manage(a.cohort_id,'content'))));
create policy assignment_file_cleanup on storage.objects for delete to authenticated using(bucket_id='trailblazers-assignments' and split_part(name,'/',1)=auth.uid()::text and not exists(select 1 from public.assignment_submissions s where s.file_path=name));
notify pgrst,'reload schema';
commit;
