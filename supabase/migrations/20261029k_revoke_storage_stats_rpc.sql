-- Oct 29, 2026 — security advisor: storage_usage() and photo_storage_stats()
-- (SECURITY DEFINER, bucket sizes) were executable by anon / authenticated via
-- /rest/v1/rpc. Only the service role calls them (admin home, storage-report
-- cron, /api/admin/storage). APPLIED.
set local lock_timeout = '5s';
revoke execute on function public.storage_usage() from public, anon, authenticated;
revoke execute on function public.photo_storage_stats() from public, anon, authenticated;
grant execute on function public.storage_usage() to service_role;
grant execute on function public.photo_storage_stats() to service_role;
