-- Avoid PL/pgSQL record-variable/table-alias collisions in the scheduled worker.
do $$declare d text;begin
 select pg_get_functiondef('portal_private.scheduled_reminders()'::regprocedure) into d;
 d:=replace(d,'select m.*,c.point_requirement from public.members m join public.cohorts c on c.id=m.cohort_id where m.program_status=''active'' and c.status=''active''','select roster.*,cohort_row.point_requirement from public.members roster join public.cohorts cohort_row on cohort_row.id=roster.cohort_id where roster.program_status=''active'' and cohort_row.status=''active''');
 d:=replace(d,'select distinct d.id from public.directors d join public.director_assignments a on a.director_id=d.id where d.active and a.active and a.cohort_id=m.cohort_id and (a.start_date is null or a.start_date<=today) and (a.end_date is null or a.end_date>=today)','select distinct director_row.id from public.directors director_row join public.director_assignments assignment_row on assignment_row.director_id=director_row.id where director_row.active and assignment_row.active and assignment_row.cohort_id=m.cohort_id and (assignment_row.start_date is null or assignment_row.start_date<=today) and (assignment_row.end_date is null or assignment_row.end_date>=today)');
 execute d;
end $$;
