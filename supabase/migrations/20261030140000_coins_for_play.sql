-- Münzen fürs Spielen: Runden werden jetzt vom TV gespeichert (record_play),
-- dazu ein Bonus aus dem Spiel (z. B. eingesammelte Münzen im Rennen, Grand-Prix-Pokal).

alter table public.plays add column if not exists bonus smallint not null default 0 check (bonus between 0 and 50);

-- Münzen pro Runde: 1 pro 30 s (max. 20) + Platzbonus + Spielbonus; höchstens 200 pro Tag
create or replace function public.award_coins()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  earned integer;
  today integer;
begin
  if new.imported or new.seconds < 30 then return new; end if;
  earned := least(20, new.seconds / 30)
          + case when new.won or new.place = 1 then 10 when new.place <= 3 then 5 else 0 end
          + least(50, greatest(0, new.bonus));
  select coalesce(sum(l.amount), 0) into today from public.wallet_log l
   where l.user_id = new.user_id and l.currency = 'coins' and l.reason = 'spiel'
     and l.created_at >= (date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich');
  earned := greatest(0, least(earned, 200 - today));
  if earned > 0 then
    insert into public.wallets (user_id, coins) values (new.user_id, earned)
      on conflict (user_id) do update set coins = public.wallets.coins + excluded.coins, updated_at = now();
    insert into public.wallet_log (user_id, currency, amount, reason) values (new.user_id, 'coins', earned, 'spiel');
  end if;
  return new;
end $$;
revoke execute on function public.award_coins() from public, anon, authenticated;

-- Runde speichern und sagen, wie viele Münzen es gab (läuft mit den Rechten der Person, RLS gilt)
create or replace function public.record_play(
  p_game text, p_seconds integer, p_place integer default null, p_players integer default null,
  p_finish_time double precision default null, p_won boolean default null, p_bonus integer default 0)
returns json language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  got integer;
  bal integer;
  today integer;
begin
  if uid is null then raise exception 'login'; end if;
  insert into public.plays (user_id, game, seconds, place, players, finish_time, won, bonus)
  values (uid, p_game,
          greatest(0, least(7200, coalesce(p_seconds, 0))),
          case when p_place between 1 and 8 then p_place end,
          case when p_players between 1 and 8 then p_players end,
          case when p_finish_time > 0 and p_finish_time < 3600 then p_finish_time end,
          p_won,
          greatest(0, least(50, coalesce(p_bonus, 0))));
  select coalesce(sum(l.amount), 0) into got from public.wallet_log l
   where l.user_id = uid and l.currency = 'coins' and l.reason = 'spiel' and l.created_at = now();
  select coalesce(sum(l.amount), 0) into today from public.wallet_log l
   where l.user_id = uid and l.currency = 'coins' and l.reason = 'spiel'
     and l.created_at >= (date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich');
  select coalesce(w.coins, 0) into bal from public.wallets w where w.user_id = uid;
  return json_build_object('earned', got, 'coins', coalesce(bal, 0), 'today', today, 'limit', 200);
end $$;
revoke execute on function public.record_play(text, integer, integer, integer, double precision, boolean, integer) from public, anon;
grant execute on function public.record_play(text, integer, integer, integer, double precision, boolean, integer) to authenticated;
