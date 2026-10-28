-- Rückerstattung: nur vom Stripe-Webhook (Service-Rolle). Mehrfach-Aufrufe sind harmlos.
create or replace function public.revoke_purchase(p_payment_intent text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  pu public.purchases;
  prod public.products;
  v_item text;
begin
  update public.purchases set status = 'refunded'
   where stripe_payment_intent = p_payment_intent and status = 'paid'
   returning * into pu;
  if not found then return 'not_found_or_done'; end if;
  select * into prod from public.products where id = pu.product_id;
  if pu.user_id is null then return 'ok_no_user'; end if;

  -- Freischaltung entfernen, ausser es gibt noch einen anderen bezahlten Kauf dafür
  v_item := case prod.kind when 'game' then prod.game_id when 'pass' then 'pass' else null end;
  if v_item is not null and not exists (
    select 1 from public.purchases p2 join public.products pr2 on pr2.id = p2.product_id
     where p2.user_id = pu.user_id and p2.status = 'paid'
       and (case pr2.kind when 'game' then pr2.game_id when 'pass' then 'pass' end) = v_item) then
    delete from public.entitlements e where e.user_id = pu.user_id and e.item = v_item;
  end if;

  -- Juwelen aus dem Kauf wieder abziehen (nicht unter 0)
  if prod.gems > 0 then
    update public.wallets set gems = greatest(0, gems - prod.gems), updated_at = now() where user_id = pu.user_id;
    insert into public.wallet_log (user_id, currency, amount, reason) values (pu.user_id, 'gems', -prod.gems, 'rueckerstattung:' || pu.product_id);
  end if;
  return 'ok';
end $$;
revoke execute on function public.revoke_purchase(text) from public, anon, authenticated;
grant execute on function public.revoke_purchase(text) to service_role;
