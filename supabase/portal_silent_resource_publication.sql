begin;
-- Per-publication choice: reuse the existing resource validation and permissions.
create or replace function public.portal_save_resource(record_id uuid default null,payload jsonb default '{}')
returns uuid language plpgsql security invoker set search_path='' as $$
declare result_id uuid; previous_setting text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if payload ? 'notify_members' and jsonb_typeof(payload->'notify_members')<>'boolean' then raise exception 'Choose whether to notify members'; end if;
 previous_setting:=current_setting('portal.resource_notifications',true);
 perform set_config('portal.resource_notifications',case when payload->'notify_members'='false'::jsonb then 'off' else 'on' end,true);
 result_id:=public.portal_mutate('resource',record_id,payload-'notify_members');
 perform set_config('portal.resource_notifications',coalesce(previous_setting,''),true);
 return result_id;
exception when others then
 perform set_config('portal.resource_notifications',coalesce(previous_setting,''),true);
 raise;
end $$;
revoke all on function public.portal_save_resource(uuid,jsonb) from public,anon;
grant execute on function public.portal_save_resource(uuid,jsonb) to authenticated;

do $$ declare definition text; begin
 select pg_get_functiondef('public.enqueue_cohort_notifications()'::regprocedure) into definition;
 if position('elsif tg_table_name=''resources'' then' in definition)=0 then raise exception 'Unexpected resource notification function'; end if;
 definition:=replace(definition,'elsif tg_table_name=''resources'' then',
 'elsif tg_table_name=''resources'' then
   if current_setting(''portal.resource_notifications'',true)=''off'' then return new; end if;');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
