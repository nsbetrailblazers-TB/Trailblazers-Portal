create or replace function public.enqueue_one_on_one_notification()
returns trigger language plpgsql security definer set search_path=public as $function$
declare member_name text; meeting_time text;
begin
  if new.status='pending' then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page)
    values(new.member_id,'one_on_one','One-on-one request sent','Your request is waiting for your director to approve it.','oneonones');
  elsif new.status='scheduled' then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page)
    values(new.member_id,'one_on_one',case when tg_op='INSERT' then 'New one-on-one scheduled' else 'One-on-one approved or updated' end,
      'Your one-on-one is scheduled for '||to_char(new.scheduled_date at time zone 'America/New_York','Mon FMDD at FMHH12:MI AM')||'.','oneonones');
  elsif new.status='denied' and (tg_op='INSERT' or old.status is distinct from new.status) then
    insert into public.member_notifications(member_id,notification_type,title,body,target_page)
    values(new.member_id,'one_on_one','One-on-one request not approved','Your director could not approve this time. Choose another time and send a new request.','oneonones');
  elsif new.status='canceled' and (tg_op='INSERT' or old.status is distinct from new.status) then
    meeting_time := case when new.scheduled_date is null then 'the scheduled one-on-one'
      else 'the one-on-one scheduled for '||to_char(new.scheduled_date at time zone 'America/New_York','Mon FMDD at FMHH12:MI AM') end;
    select coalesce(preferred_name,first_name)||' '||last_name into member_name
      from public.members where id=new.member_id;
    insert into public.member_notifications(member_id,notification_type,title,body,target_page)
    values(new.member_id,'one_on_one','One-on-one canceled',
      'Your one-on-one was canceled. You can request another time from the portal.','oneonones');
    insert into public.director_notifications(director_id,title,body,dedupe_key)
    values(new.director_id,'One-on-one canceled',
      meeting_time||' with '||coalesce(member_name,'a Trailblazer')||' was canceled. Contact them to arrange another time.',
      'one-on-one-canceled:'||new.id||':'||coalesce(new.updated_at,now())::text);
  end if;
  return new;
end;
$function$;
