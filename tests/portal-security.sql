-- Run as the database owner. Every fixture and change is rolled back.
begin;
do $$
declare admin_uid uuid:=gen_random_uuid(); director_uid uuid:=gen_random_uuid(); member_uid uuid:=gen_random_uuid(); outsider_uid uuid:=gen_random_uuid();
 c1 uuid; c2 uuid; d1 uuid; m1 uuid; m2 uuid; p1 uuid; p2 uuid; meeting uuid; strike uuid; event_id uuid; resume_id uuid; denied boolean; result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values
 (admin_uid,'portal-test-admin@example.invalid',now()),(director_uid,'portal-test-director@example.invalid',now()),
 (member_uid,'portal-test-member@example.invalid',now()),(outsider_uid,'portal-test-outsider@example.invalid',now());
 insert into portal_private.pending_admins(email) values('portal-test-admin@example.invalid');
 insert into storage.objects(bucket_id,name,metadata) values
 ('trailblazers-private',member_uid||'/test.png','{"mimetype":"image/png"}'),
 ('trailblazers-private',outsider_uid||'/test.png','{"mimetype":"image/png"}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 result:=public.portal_initialize();
 if not (result->>'is_admin')::boolean then raise exception 'FAIL: verified admin bootstrap'; end if;
 c1:=public.portal_mutate('cohort',null,'{"name":"__portal_test_A","class_number":900001,"point_requirement":30}');
 c2:=public.portal_mutate('cohort',null,'{"name":"__portal_test_B","class_number":900002,"point_requirement":30}');
 d1:=public.portal_mutate('director',null,'{"first_name":"Test","last_name":"Director","email":"portal-test-director@example.invalid"}');
 m1:=public.portal_mutate('member',null,jsonb_build_object('first_name','Test','last_name','Member','uf_email','portal-test-member@example.invalid','cohort_id',c1));
 m2:=public.portal_mutate('member',null,jsonb_build_object('first_name','Other','last_name','Member','uf_email','portal-test-outsider@example.invalid','cohort_id',c2));
 perform public.portal_mutate('assignment',null,jsonb_build_object('director_id',d1,'cohort_id',c1,'title','Reviewer','capabilities',jsonb_build_array('points','strikes','meetings','resumes','content','events')));
 -- A member can connect only their verified matching identity.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member_uid,'role','authenticated')::text,true);
 result:=public.portal_initialize();
 if (select count(*) from public.members)<>1 then raise exception 'FAIL: member read scope'; end if;
 if (select auth_user_id from public.members where id=m1)<>member_uid then raise exception 'FAIL: identity linking'; end if;
 denied:=false;begin perform public.portal_mutate('cohort',null,'{"name":"forbidden"}'); exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: member administered cohort'; end if;
 p1:=public.portal_submit_file('points',member_uid||'/test.png','test.png',jsonb_build_object('activity_name','Test activity','activity_date',current_date,'points_requested',5,'request_id',gen_random_uuid()));
 denied:=false;begin perform public.portal_mutate('points_review',p1,'{"status":"approved","points_awarded":5}');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: member approved own points'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_uid,'role','authenticated')::text,true);
 perform public.portal_initialize();
 p2:=public.portal_submit_file('points',outsider_uid||'/test.png','test.png',jsonb_build_object('activity_name','Other activity','activity_date',current_date,'points_requested',5,'request_id',gen_random_uuid()));
 -- Director sees only their assigned cohort and cannot change the roster.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',director_uid,'role','authenticated')::text,true);
 result:=public.portal_initialize();
 if (select count(*) from public.members)<>1 or exists(select 1 from public.members where id=m2) then raise exception 'FAIL: director read scope'; end if;
 denied:=false;begin perform public.portal_mutate('points_review',p2,'{"status":"approved","points_awarded":5}');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: cross-cohort approval'; end if;
 denied:=false;begin perform public.portal_mutate('member',null,jsonb_build_object('first_name','Bad','last_name','Write','uf_email','bad@example.invalid','cohort_id',c1));exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: director roster write'; end if;
 perform public.portal_mutate('points_review',p1,'{"status":"needs_review","director_note":"Add detail"}');
 if (select status from public.point_submissions where id=p1)<>'needs_review' then raise exception 'FAIL: needs review'; end if;
 perform public.portal_mutate('points_review',p1,'{"status":"approved","points_awarded":5}');
 denied:=false;begin perform public.portal_mutate('points_review',p1,'{"status":"denied"}');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: duplicate review'; end if;
 if (select points_awarded from public.point_submissions where id=p1)<>5 then raise exception 'FAIL: point award'; end if;
 if (select reviewed_by_user_id from public.point_submissions where id=p1) is distinct from director_uid then raise exception 'FAIL: review identity'; end if;
 select id into meeting from public.one_on_ones where member_id=m1 and director_id=d1;
 if meeting is null then raise exception 'FAIL: requirements not seeded'; end if;
 perform public.director_schedule_one_on_one(m1,now()+interval '2 days','virtual','Test room');
 perform public.portal_mutate('one_on_one',meeting,jsonb_build_object('status','scheduled','scheduled_date',now()+interval '3 days','meeting_method','phone'));
 perform public.portal_mutate('one_on_one',meeting,'{"status":"canceled"}');
 if (select status from public.one_on_ones where id=meeting)<>'canceled' then raise exception 'FAIL: cancellation'; end if;
 perform public.portal_mutate('one_on_one',meeting,jsonb_build_object('status','scheduled','scheduled_date',now()+interval '4 days','meeting_method','phone'));
 if (select meeting_method from public.one_on_ones where id=meeting)<>'in_person' then raise exception 'FAIL: in-person enforcement'; end if;
 if not exists(select 1 from public.one_on_one_history where one_on_one_id=meeting and previous_status='canceled') then raise exception 'FAIL: canceled history lost'; end if;
 strike:=public.portal_mutate('strike',null,jsonb_build_object('member_id',m1,'reason','Test reason'));
 perform public.portal_mutate('strike',strike,'{"resolution_note":"Correction"}');
 if (select status from public.strikes where id=strike)<>'removed' then raise exception 'FAIL: strike history'; end if;
 -- The legacy event RPC must not bypass the new cohort guard.
 denied:=false;begin perform public.create_calendar_event('Bad event','tb_event',now()+interval '1 day',p_cohort_id=>c2);exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: legacy cross-cohort event'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'role','authenticated')::text,true);
 if not exists(select 1 from public.activity_log where entity_id=p1 and action='update') then raise exception 'FAIL: missing audit'; end if;
 event_id:=public.portal_save_event(null,jsonb_build_object('title','Test global event','event_category','tb_event','all_day',true,'all_day_start','2026-12-01','all_day_end','2026-12-03'));
 if (select all_day_start from public.meetings where id=event_id)<>'2026-12-01'::date then raise exception 'FAIL: all-day dates'; end if;
 -- Fixtures can insert a resume record without an actual storage upload; the
 -- review authorization/transition is tested here, upload policy separately.
 perform set_config('role','postgres',true);
 perform set_config('request.jwt.claims','{}',true);
 insert into public.resume_submissions(member_id,file_path,file_name) values(m1,member_uid::text||'/test.pdf','test.pdf') returning id into resume_id;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',director_uid,'role','authenticated')::text,true);
 perform public.portal_mutate('resume_review',resume_id,'{"status":"under_review"}');
 perform public.portal_mutate('resume_review',resume_id,'{"status":"reviewed","feedback":"Test feedback"}');
 denied:=false;begin perform public.portal_mutate('resume_review',resume_id,'{"status":"reviewed","feedback":"Again"}');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: repeated resume review'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_uid,'role','authenticated')::text,true);
 if exists(select 1 from public.resume_submissions where id=resume_id) then raise exception 'FAIL: private resume scope'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'role','authenticated')::text,true);
 -- Inventory additions: atomic profiles, sensitive access, content, and settings.
 perform public.portal_workspace('profile',m1,'{"major":"Engineering","minor":"Math","graduation_year":2030,"pronouns":"they/them","favorite_color":"Purple","birthday_month":2,"birthday_day":29,"show_in_alumni_directory":true,"show_email":false}');
 perform public.portal_workspace('care',m1,'{"food_allergies":"Test allergy","accommodations":"Test accommodation"}');
 if (select food_allergies from public.members where id=m1) is not null then raise exception 'FAIL: care leaked through roster'; end if;
 result:=public.portal_workspace('profile_read',m1);
 if result->>'food_allergies'<>'Test allergy' or result->>'minor'<>'Math' then raise exception 'FAIL: full profile projection'; end if;
 perform public.portal_workspace('hub',null,jsonb_build_object('cohort_id',c1,'title','Test Hub','body','Test content'));
 perform public.portal_workspace('rule',null,'{"name":"Test activity rule","default_points":3,"category":"Academic","active":true}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',director_uid,'role','authenticated')::text,true);
 denied:=false;begin perform public.portal_workspace('care_read',m1);exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: care accessible without explicit capability'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member_uid,'role','authenticated')::text,true);
 result:=public.portal_workspace('care_read');
 if result->>'food_allergies'<>'Test allergy' then raise exception 'FAIL: own care inaccessible'; end if;
 denied:=false;begin perform public.portal_workspace('profile',null,'{"program_status":"archived"}');exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: profile changed protected field'; end if;
 denied:=false;begin perform public.submit_my_points('No evidence',current_date,'Test',5);exception when others then denied:=true;end;
 if not denied then raise exception 'FAIL: legacy submission bypassed picture evidence'; end if;
 perform public.portal_workspace('preferences',null,'{"email_enabled":false}');
 if (select email_enabled from public.member_notification_preferences where member_id=m1) then raise exception 'FAIL: preferences not saved'; end if;
 if not exists(select 1 from public.member_notifications where member_id=m1 and dedupe_key='point-received:'||p1) then raise exception 'FAIL: receipt template not queued'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'role','authenticated')::text,true);
 perform public.portal_mutate('cohort',c1,jsonb_build_object('name','__portal_test_A','status','archived','point_requirement',30));
 if (select program_status from public.members where id=m1)<>'archived' then raise exception 'FAIL: archive roster'; end if;
 if (select completion_snapshot->>'required' from public.members where id=m1)<>'1' then raise exception 'FAIL: archive requirement snapshot'; end if;
 if not exists(select 1 from public.portal_alumni_extended() where id=m1 and minor='Math' and contact_email is null) then raise exception 'FAIL: alumni privacy projection'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',director_uid,'role','authenticated')::text,true);
 if exists(select 1 from public.members where id=m1) then raise exception 'FAIL: archived director access'; end if;
 perform set_config('role','postgres',true);
end $$;
rollback;
select 'PASS: role scopes, verified admin/identity onboarding, duplicate decisions, legacy RPC protection, scheduling/history, strike history, resume review/privacy, global/all-day events, audit, archive (all fixtures rolled back)' as result;
