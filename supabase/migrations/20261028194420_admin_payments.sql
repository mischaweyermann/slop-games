-- Admin: Schalter «Kaufen» und Verkaufszahlen
create or replace function public.admin_set_payments(enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.app_settings set payments_enabled = enabled where id;
end $$;
revoke execute on function public.admin_set_payments(boolean) from public, anon;
grant execute on function public.admin_set_payments(boolean) to authenticated;

create or replace function public.admin_sales()
returns json language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return json_build_object(
    'count', (select count(*) from public.purchases where status = 'paid'),
    'rappen', (select coalesce(sum(amount_rappen), 0) from public.purchases where status = 'paid'),
    'count_30d', (select count(*) from public.purchases where status = 'paid' and created_at > now() - interval '30 days'),
    'rappen_30d', (select coalesce(sum(amount_rappen), 0) from public.purchases where status = 'paid' and created_at > now() - interval '30 days'),
    'per_product', (select coalesce(json_agg(x order by x.rappen desc), '[]'::json) from (
      select p.product_id as id, count(*) as n, sum(p.amount_rappen) as rappen from public.purchases p where p.status = 'paid' group by p.product_id) x)
  );
end $$;
revoke execute on function public.admin_sales() from public, anon;
grant execute on function public.admin_sales() to authenticated;
