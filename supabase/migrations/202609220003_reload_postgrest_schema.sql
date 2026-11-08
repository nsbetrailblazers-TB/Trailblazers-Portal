-- Run after the portal feature migrations to make new RPC functions immediately
-- visible to the Supabase REST API used by the browser.
notify pgrst, 'reload schema';
