-- These functions are only called by server code (api/review.js, api/set-institution-email.js)
-- with the service role key. The public anon key and signed-in users can no longer run them.
revoke execute on function public.kudos_publish_award(uuid) from public, anon, authenticated;
revoke execute on function public.set_institution_contact_email(uuid, text) from public, anon, authenticated;
grant execute on function public.kudos_publish_award(uuid) to service_role;
grant execute on function public.set_institution_contact_email(uuid, text) to service_role;
