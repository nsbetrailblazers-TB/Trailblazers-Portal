-- Synthetic accounts and every notification/audit row are rolled back.
begin;
select set_config('request.jwt.claim.sub','',true);
do $$
declare au uuid:=gen_random_uuid(); mu uuid:=gen_random_uuid(); du uuid:=gen_random_uuid(); ou uuid:=gen_random_uuid();
 cid uuid; mid uuid; did uuid; other_did uuid; meeting_id uuid; rule_id uuid; gbm uuid; group_rule uuid; p uuid; result uuid; denied boolean; summary jsonb; key uuid; i integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values(au,'activity-admin@example.invalid',now()),(mu,'activity-member@example.invalid',now()),(du,'activity-director@example.invalid',now()),(ou,'activity-other@example.invalid',now());
 insert into public.portal_admins(user_id,active) values(au,true);
 insert into public.cohorts(name,class_number,status,point_requirement) values('__activity_test',99145,'active',10) returning id into cid;
 insert into public.members(first_name,last_name,uf_email,cohort_id,program_status,auth_user_id) values('Activity','Member','activity-member@example.invalid',cid,'active',mu) returning id into mid;
 insert into public.directors(first_name,last_name,email,active,auth_user_id) values('Activity','Director','activity-director@example.invalid',true,du) returning id into did;
 insert into public.directors(first_name,last_name,email,active,auth_user_id) values('Other','Director','activity-other@example.invalid',true,ou) returning id into other_did;
 insert into public.director_assignments(director_id,cohort_id,title,capabilities) values(did,cid,'Test',array['points','meetings']),(other_did,cid,'Test',array['points','meetings']);
 insert into public.point_rules(name,category,cohort_id,is_required,required_count,completion_source) values('__test_directors','Required',cid,true,4,'director_meetings') returning id into group_rule;
 insert into public.point_rules(name,category,cohort_id,is_required,required_count) values('__test_gbms','Required',cid,true,3) returning id into gbm;
 insert into public.point_rules(name,category,cohort_id,is_required,required_count) values('__test_peer','Required',cid,true,1),('__test_events','Required',cid,true,2);
 insert into public.point_rules(name,category,cohort_id,is_required) select '__test_elective_'||series.n,'Elective',cid,false from generate_series(1,6)series(n);
 insert into storage.objects(bucket_id,name,metadata) values('trailblazers-private',mu||'/activity.png','{"mimetype":"image/png"}');
 select id into meeting_id from public.one_on_ones where member_id=mid and director_id=did;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',mu,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 result:=public.portal_one_on_one_completion('request',meeting_id,jsonb_build_object('completed_at',now()-interval '1 day'));
 if (select status from public.one_on_ones where id=result)<>'completion_pending' or (select completed_date from public.one_on_ones where id=result) is not null then raise exception 'Request counted before approval'; end if;
 denied:=false;begin perform public.portal_one_on_one_completion('approve',meeting_id);exception when others then denied:=true;end;
 if not denied then raise exception 'Member approved own meeting'; end if;
 p:=public.portal_submit_file('points',mu||'/activity.png','activity.png',jsonb_build_object('activity_name','__test_gbms','activity_date',current_date,'points_requested',1,'point_rule_id',gbm,'occurrence_count',2,'request_id',gen_random_uuid()));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',ou,'role','authenticated')::text,true);
 denied:=false;begin perform public.portal_one_on_one_completion('approve',meeting_id);exception when others then denied:=true;end;
 if not denied then raise exception 'Another director approved a meeting they did not attend'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',du,'role','authenticated')::text,true);
 perform public.portal_one_on_one_completion('approve',meeting_id);
 if (select status from public.one_on_ones where id=meeting_id)<>'completed' or (select completion_reviewed_by from public.one_on_ones where id=meeting_id)<>du then raise exception 'Director approval failed'; end if;
 denied:=false;begin perform public.portal_one_on_one_completion('record',null,jsonb_build_object('member_id',mid,'director_id',did,'completed_at',now()+interval '1 day'));exception when others then denied:=true;end;
 if not denied then raise exception 'Future meeting counted'; end if;
 perform public.portal_review_activity(p,jsonb_build_object('status','approved','point_rule_id',gbm,'occurrence_count',2));
 if (select occurrence_count from public.point_submissions where id=p)<>2 then raise exception 'GBM event count lost'; end if;
 key:=gen_random_uuid();
 result:=public.portal_record_activity(jsonb_build_object('member_id',mid,'point_rule_id',gbm,'activity_date',current_date-1,'occurrence_count',1,'request_id',key));
 if result is distinct from public.portal_record_activity(jsonb_build_object('member_id',mid,'point_rule_id',gbm,'activity_date',current_date-1,'occurrence_count',1,'request_id',key)) then raise exception 'Retry duplicated activity'; end if;
 perform set_config('role','none',true);
 summary:=portal_private.activity_progress(mid);
 if (summary->>'requiredComplete')::integer<>1 then raise exception 'Three GBMs should earn exactly one required point: %',summary; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
 for rule_id in select id from public.point_rules where cohort_id=cid and completion_source='submission' and id<>gbm loop
  perform public.portal_record_activity(jsonb_build_object('member_id',mid,'point_rule_id',rule_id,'activity_date',current_date,'occurrence_count',(select required_count from public.point_rules where id=rule_id),'request_id',gen_random_uuid()));
 end loop;
 summary:=portal_private.activity_progress(mid);
 if (summary->>'pointsMet')::boolean then raise exception 'Electives hid missing director requirement'; end if;
 for did in select id from public.directors where id=other_did loop
  perform public.portal_one_on_one_completion('record',null,jsonb_build_object('member_id',mid,'director_id',did,'completed_at',now()-interval '2 days'));
 end loop;
 -- Two additional assigned directors take the group to four distinct approvals.
 for i in 1..2 loop
  insert into public.directors(first_name,last_name,email,active) values('Extra',i::text,'activity-extra-'||i||'@example.invalid',true) returning id into did;
  insert into public.director_assignments(director_id,cohort_id,title,capabilities) values(did,cid,'Test',array['meetings']);
  perform public.portal_one_on_one_completion('record',null,jsonb_build_object('member_id',mid,'director_id',did,'completed_at',now()-interval '3 days'));
 end loop;
 summary:=portal_private.activity_progress(mid);
 if not (summary->>'pointsMet')::boolean or (summary->>'approved')::integer<>10 then raise exception 'Full checklist did not complete: %',summary; end if;
 update public.members set program_status='archived' where id=mid;
 if not (select (completion_snapshot->>'pointsMet')::boolean from public.members where id=mid) then raise exception 'Archive lost activity completion'; end if;
 if pg_get_functiondef('portal_private.scheduled_reminders()'::regprocedure) like '%queue_template(m.id,''low_points''%' then raise exception 'Weekly point reminder still enabled'; end if;
 if not exists(select 1 from public.one_on_one_history where one_on_one_id=meeting_id) then raise exception 'Meeting history lost'; end if;
 raise notice 'PASS: requests, director permissions, future-date rejection, GBM counts, retry safety, missing requirements, reminders and history';
end $$;
rollback;
