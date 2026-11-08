-- Synthetic identities, meetings, notifications and webhook work are rolled back.
begin;
select set_config('request.jwt.claim.sub','',true);
do $$
declare au uuid:=gen_random_uuid(); mu uuid:=gen_random_uuid(); pu uuid:=gen_random_uuid(); xu uuid:=gen_random_uuid(); du uuid:=gen_random_uuid();
 cid uuid; mid uuid; peer uuid; outsider uuid; did uuid; rid uuid; second uuid; legacy uuid; req uuid:=gen_random_uuid(); denied boolean; result uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values(au,'invite-admin@example.invalid',now()),(mu,'invite-member@example.invalid',now()),(pu,'invite-peer@example.invalid',now()),(xu,'invite-outsider@example.invalid',now()),(du,'invite-director@example.invalid',now());
 insert into public.portal_admins(user_id,active) values(au,true);
 insert into public.cohorts(name,class_number,status,point_requirement) values('__invitation_test',99149,'active',10) returning id into cid;
 insert into public.members(first_name,last_name,uf_email,cohort_id,program_status,auth_user_id) values('Invite','Member','invite-member@example.invalid',cid,'active',mu) returning id into mid;
 insert into public.members(first_name,last_name,uf_email,cohort_id,program_status,auth_user_id) values('Invite','Peer','invite-peer@example.invalid',cid,'active',pu) returning id into peer;
 insert into public.members(first_name,last_name,uf_email,cohort_id,program_status,auth_user_id) values('Invite','Outsider','invite-outsider@example.invalid',cid,'active',xu) returning id into outsider;
 insert into public.directors(first_name,last_name,email,active,auth_user_id) values('Invite','Director','invite-director@example.invalid',true,du) returning id into did;
 insert into public.director_assignments(director_id,cohort_id,title,capabilities) values(did,cid,'Test',array['meetings']);
 select id into legacy from public.one_on_ones where member_id=mid and director_id=did;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',mu,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 rid:=public.portal_create_meeting_invitation(req,array[mid,peer],did,now()+interval '3 days','Test room');
 if rid<>public.portal_create_meeting_invitation(req,array[mid,peer],did,now()+interval '3 days','Test room') then raise exception 'Retry duplicated invitation'; end if;
 if (select status from public.one_on_one_invitations where id=rid)<>'pending' then raise exception 'Invitation scheduled before acceptance'; end if;
 denied:=false;begin perform public.portal_create_meeting_invitation(gen_random_uuid(),array[mid,peer,outsider],did,now()+interval '3 days','Test');exception when others then denied:=true;end;
 if not denied then raise exception 'More than two Trailblazers allowed'; end if;
 denied:=false;begin perform public.portal_create_meeting_invitation(gen_random_uuid(),array[mid],null,now()+interval '3 days','Test');exception when others then denied:=true;end;
 if not denied then raise exception 'Single participant allowed'; end if;
 denied:=false;begin perform public.portal_create_meeting_invitation(gen_random_uuid(),array[peer,outsider],did,now()+interval '3 days','Test');exception when others then denied:=true;end;
 if not denied then raise exception 'Nonparticipant created meeting'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',xu,'role','authenticated')::text,true);
 if exists(select 1 from public.one_on_one_invitations where id=rid) then raise exception 'Outsider read invitation'; end if;
 denied:=false;begin perform public.portal_respond_meeting_invitation(rid,'accept');exception when others then denied:=true;end;
 if not denied then raise exception 'Outsider accepted invitation'; end if;
 denied:=false;begin perform public.portal_edit_past_meeting(legacy,jsonb_build_object('scheduled_date',now()-interval '1 day'));exception when others then denied:=true;end;
 if not denied then raise exception 'Outsider edited historical meeting'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pu,'role','authenticated')::text,true);
 perform public.portal_respond_meeting_invitation(rid,'accept');
 if (select status from public.one_on_one_invitations where id=rid)<>'pending' then raise exception 'Director acceptance not required'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',du,'role','authenticated')::text,true);
 perform public.portal_respond_meeting_invitation(rid,'accept');
 if (select status from public.one_on_one_invitations where id=rid)<>'scheduled' then raise exception 'Fully accepted meeting not scheduled'; end if;
 -- A second invitation and a legacy meeting cannot double-book the same time.
 second:=public.portal_create_meeting_invitation(gen_random_uuid(),array[mid],did,now()+interval '3 days','Conflict room');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',mu,'role','authenticated')::text,true);
 denied:=false;begin perform public.portal_respond_meeting_invitation(second,'accept');exception when others then denied:=true;end;
 if not denied then raise exception 'Invitation double-booking allowed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',du,'role','authenticated')::text,true);
 denied:=false;begin perform public.director_schedule_one_on_one(mid,now()+interval '3 days','in_person','Conflict');exception when others then denied:=true;end;
 if not denied then raise exception 'Legacy meeting double-booked invitation'; end if;
 -- Direct writes cannot bypass participant limits or acceptance.
 denied:=false;begin update public.one_on_one_invitations set status='completed' where id=rid;exception when others then denied:=true;end;
 if not denied then raise exception 'Direct invitation write allowed'; end if;
 denied:=false;begin perform public.portal_respond_meeting_invitation(rid,'complete');exception when others then denied:=true;end;
 if not denied then raise exception 'Future meeting counted'; end if;
 perform set_config('role','none',true);
 update public.one_on_one_invitations set scheduled_date=now()-interval '1 day' where id=rid;
 perform set_config('role','authenticated',true);
 perform public.portal_respond_meeting_invitation(rid,'complete');
 if (select status from public.one_on_ones where id=legacy)<>'completed' or not exists(select 1 from public.one_on_ones where member_id=peer and director_id=did and status='completed') then raise exception 'Group completion did not credit both Trailblazers'; end if;
 -- Older completed rows can be corrected without reopening them or losing history.
 perform public.portal_edit_past_meeting(legacy,jsonb_build_object('scheduled_date',now()-interval '1 year','completed_date',now()-interval '1 year','location_method','Corrected room','admin_note','Corrected historical date'));
 if (select status from public.one_on_ones where id=legacy)<>'completed' then raise exception 'Edit reopened completed meeting'; end if;
 if not exists(select 1 from public.one_on_one_history where one_on_one_id=legacy and completed_date>now()-interval '2 days') then raise exception 'Previous completion date not retained'; end if;
 -- Admin may manually enter a previous-semester meeting.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
 result:=public.portal_one_on_one_completion('record',null,jsonb_build_object('member_id',outsider,'director_id',did,'completed_at',now()-interval '1 year','location','Historical room'));
 if (select completed_date from public.one_on_ones where id=result)>now()-interval '6 months' then raise exception 'Historical manual entry failed'; end if;
 -- Old pending invitations can still be accepted in management.
 perform set_config('role','none',true);
 update public.one_on_ones set status='pending',scheduled_date=now()+interval '4 days' where id=legacy;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',du,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 perform public.portal_respond_legacy_meeting(legacy,'accept');
 if (select status from public.one_on_ones where id=legacy)<>'scheduled' then raise exception 'Legacy invitation response failed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',mu,'role','authenticated')::text,true);
 perform public.portal_respond_legacy_meeting(legacy,'accept');
 if (select member_accepted_at from public.one_on_ones where id=legacy) is null then raise exception 'Member attendance confirmation missing'; end if;
 -- Peer-only invitations, decline and organizer cancellation.
 second:=public.portal_create_meeting_invitation(gen_random_uuid(),array[mid,peer],null,now()+interval '7 days','Peer room');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pu,'role','authenticated')::text,true);
 perform public.portal_respond_meeting_invitation(second,'decline');
 if (select status from public.one_on_one_invitations where id=second)<>'declined' then raise exception 'Decline failed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',mu,'role','authenticated')::text,true);
 second:=public.portal_create_meeting_invitation(gen_random_uuid(),array[mid,peer],null,now()+interval '8 days','Peer room');
 perform public.portal_respond_meeting_invitation(second,'cancel');
 if (select status from public.one_on_one_invitations where id=second)<>'canceled' then raise exception 'Cancellation failed'; end if;
 perform set_config('request.jwt.claims','{}',true);
 perform set_config('role','anon',true);
 denied:=false;begin perform public.portal_meeting_directory();exception when others then denied:=true;end;
 if not denied then raise exception 'Anonymous directory access'; end if;
 perform set_config('role','none',true);
 raise notice 'PASS: participant limits, retry safety, privacy, acceptance, completion credit, historical edits/manual entry, legacy acceptance, decline and cancellation';
end $$;
select 'PASS: invitation limits, permissions, conflict prevention, acceptance, completion credit, historical edits/manual entry and legacy responses' as result;
rollback;
