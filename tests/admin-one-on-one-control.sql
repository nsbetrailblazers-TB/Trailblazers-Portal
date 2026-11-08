-- Rolled-back identities, points, notifications, meetings and audit records.
begin;
select set_config('request.jwt.claim.sub','',true);
do $$
declare au uuid:=gen_random_uuid(); mu uuid:=gen_random_uuid(); du uuid:=gen_random_uuid();
 cid uuid; mid uuid; did uuid; rid uuid; oid uuid; pid uuid; denied boolean; payload jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values
 (au,'__admin_meeting_admin@example.invalid',now()),(mu,'__admin_meeting_member@example.invalid',now()),(du,'__admin_meeting_director@example.invalid',now());
 insert into public.portal_admins(user_id,active) values(au,true);
 insert into public.cohorts(name,class_number,status,point_requirement) values('__admin_meeting_test',99291,'active',10) returning id into cid;
 insert into public.members(first_name,last_name,uf_email,cohort_id,program_status,auth_user_id)
 values('Test','Member','__admin_meeting_member@example.invalid',cid,'active',mu) returning id into mid;
 -- Inactive and unassigned: admins must still be able to record their past meeting.
 insert into public.directors(first_name,last_name,email,active,auth_user_id)
 values('Former','Director','__admin_meeting_director@example.invalid',false,du) returning id into did;
 insert into public.point_rules(name,category,cohort_id,is_required,required_count,completion_source)
 values('__admin_meeting_rule','Required',cid,true,4,'director_meetings') returning id into rid;
 payload:=jsonb_build_object('member_id',mid,'director_id',did,'completed_at',now()-interval '1 year','location','Historical room');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 oid:=public.portal_one_on_one_completion('record',null,payload);
 if (select status from public.one_on_ones where id=oid)<>'completed' then raise exception 'Admin could not record unassigned historical meeting'; end if;
 perform public.portal_one_on_one_completion('record',oid,payload||jsonb_build_object('completed_at',now()-interval '1 day'));
 if (select completed_date from public.one_on_ones where id=oid)<now()-interval '2 days' then raise exception 'Admin could not correct completion date'; end if;
 perform public.portal_one_on_one_completion('reopen',oid,'{"note":"Incorrect completion"}');
 if (select status from public.one_on_ones where id=oid)<>'reschedule_needed' or (select completed_date from public.one_on_ones where id=oid) is not null then raise exception 'Undo completion failed'; end if;
 if not exists(select 1 from public.one_on_one_history where one_on_one_id=oid and previous_status='completed') then raise exception 'Completion history missing'; end if;
 payload:=jsonb_build_object('request_id',gen_random_uuid(),'member_id',mid,'point_rule_id',rid,'activity_date',current_date,'occurrence_count',4);
 pid:=public.portal_record_activity(payload);
 if public.portal_record_activity(payload)<>pid then raise exception 'Retry duplicated manual credit'; end if;
 perform set_config('role','none',true);
 if (portal_private.activity_progress(mid)->>'requiredComplete')::integer<>1 then raise exception 'Manual credit did not complete checklist'; end if;
 perform set_config('role','none',true);
 update public.directors set active=true where id=did;
 insert into public.director_assignments(director_id,cohort_id,title,capabilities) values(did,cid,'Test',array['points','meetings']);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',du,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 denied:=false;begin perform public.portal_record_activity(payload||jsonb_build_object('request_id',gen_random_uuid()));exception when others then denied:=true;end;
 if not denied then raise exception 'Director awarded admin-only one-on-one credit'; end if;
 denied:=false;begin perform public.portal_one_on_one_completion('reopen',oid,'{"note":"Unauthorized"}');exception when others then denied:=true;end;
 if not denied then raise exception 'Director used admin correction'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',mu,'role','authenticated')::text,true);
 denied:=false;begin perform public.portal_record_activity(payload||jsonb_build_object('request_id',gen_random_uuid()));exception when others then denied:=true;end;
 if not denied then raise exception 'Member awarded own point'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
 perform public.portal_edit_points(pid,jsonb_build_object('operation','remove','reason','Test correction',
 'expected',(select jsonb_build_object('status',status,'points_awarded',points_awarded,'activity_name',activity_name,'activity_date',activity_date,'category',category,'director_note',director_note,'reviewed_at',reviewed_at,'removed_at',removed_at) from public.point_submissions where id=pid)));
 perform set_config('role','none',true);
 if (portal_private.activity_progress(mid)->>'requiredComplete')::integer<>0 then raise exception 'Removed manual credit still counts'; end if;
 perform set_config('role','none',true);
 perform set_config('request.jwt.claims','{}',true);
end $$;
rollback;
