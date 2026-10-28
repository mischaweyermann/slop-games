-- Bezahlung, Freischaltungen, Münzen und Juwelen

-- Schalter: solange aus, sind alle Spiele frei (Admins können trotzdem testen)
create table public.app_settings (
  id boolean primary key default true check (id),
  payments_enabled boolean not null default false
);
insert into public.app_settings default values;
alter table public.app_settings enable row level security;
create policy "Einstellungen lesen" on public.app_settings for select to anon, authenticated using (true);

-- Gratis-Spiele
alter table public.games add column free boolean not null default false;
update public.games set free = true where id = 'kurvenflitzer';

-- Produkte (Preise in Rappen)
create table public.products (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  kind text not null check (kind in ('game', 'pass', 'gems')),
  name text not null,
  description text,
  game_id text references public.games(id),
  price_rappen integer not null check (price_rappen > 0),
  gems integer not null default 0 check (gems >= 0),
  active boolean not null default true,
  sort smallint not null default 0,
  check ((kind = 'game') = (game_id is not null))
);
alter table public.products enable row level security;
create policy "Produkte lesen" on public.products for select to anon, authenticated using (true);
insert into public.products (id, kind, name, description, game_id, price_rappen, gems, sort) values
  ('boxring', 'game', 'Boxring', 'Ganzes Spiel mit Boxen und Kickboxen, inklusive aller späteren Inhalte', 'boxring', 200, 0, 1),
  ('skicross', 'game', 'Skicross', 'Ganzes Spiel mit allen Pisten, inklusive aller späteren Inhalte', 'skicross', 200, 0, 2),
  ('pass', 'pass', 'Early-Supporter-Pass', 'Alle Spiele, auch alle künftigen, plus 300 Bonus-Juwelen', null, 900, 300, 0),
  ('juwelen-500', 'gems', '500 Juwelen', 'Für Skins deiner Figur', null, 500, 500, 10),
  ('juwelen-1100', 'gems', '1100 Juwelen', 'Für Skins deiner Figur, 100 Juwelen extra', null, 1000, 1100, 11);

-- Käufe (Buchhaltung: bleiben auch nach Kontolöschung, ohne Personenbezug)
create table public.purchases (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  product_id text not null references public.products(id),
  amount_rappen integer not null,
  currency text not null default 'chf',
  stripe_session_id text not null unique,
  stripe_payment_intent text,
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  created_at timestamptz not null default now()
);
create index purchases_user_idx on public.purchases (user_id);
alter table public.purchases enable row level security;
create policy "Eigene Käufe lesen" on public.purchases for select to authenticated using (user_id = (select auth.uid()));

-- Freischaltungen: Spiel-ID oder 'pass'
create table public.entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null,
  source text not null default 'kauf',
  created_at timestamptz not null default now(),
  primary key (user_id, item)
);
alter table public.entitlements enable row level security;
create policy "Eigene Freischaltungen lesen" on public.entitlements for select to authenticated using (user_id = (select auth.uid()));

-- Münzen (erspielt) und Juwelen (gekauft)
create table public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coins integer not null default 0 check (coins >= 0),
  gems integer not null default 0 check (gems >= 0),
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
create policy "Eigenes Guthaben lesen" on public.wallets for select to authenticated using (user_id = (select auth.uid()));

create table public.wallet_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency in ('coins', 'gems')),
  amount integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index wallet_log_user_idx on public.wallet_log (user_id, created_at desc);
alter table public.wallet_log enable row level security;
create policy "Eigene Buchungen lesen" on public.wallet_log for select to authenticated using (user_id = (select auth.uid()));

-- Darf der angemeldete Nutzer dieses Spiel spielen?
create or replace function public.has_access(game text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select g.free from public.games g where g.id = game), true)
      or not (select s.payments_enabled from public.app_settings s)
      or exists (select 1 from public.entitlements e where e.user_id = (select auth.uid()) and e.item in (game, 'pass'))
      or public.is_admin();
$$;
revoke execute on function public.has_access(text) from public, anon;
grant execute on function public.has_access(text) to authenticated;

-- Münzen pro gespielter Runde (max. 20 + Bonus pro Runde, max. 200 pro Tag)
create or replace function public.award_coins()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  earned integer;
  today integer;
begin
  if new.imported or new.seconds < 30 then return new; end if;
  earned := least(20, new.seconds / 30)
          + case when new.won or new.place = 1 then 10 when new.place <= 3 then 5 else 0 end;
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
create trigger plays_award_coins after insert on public.plays for each row execute function public.award_coins();

-- Kauf gutschreiben: nur vom Stripe-Webhook (Service-Rolle). Mehrfach-Aufrufe sind harmlos.
create or replace function public.grant_purchase(p_session text, p_user uuid, p_product text, p_amount integer, p_currency text, p_payment_intent text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  prod public.products;
  new_id bigint;
begin
  select * into prod from public.products where id = p_product;
  if not found then return 'unknown_product'; end if;
  if lower(p_currency) <> 'chf' then return 'wrong_currency'; end if;
  insert into public.purchases (user_id, product_id, amount_rappen, currency, stripe_session_id, stripe_payment_intent)
    values (p_user, p_product, p_amount, lower(p_currency), p_session, p_payment_intent)
    on conflict (stripe_session_id) do nothing
    returning id into new_id;
  if new_id is null then return 'duplicate'; end if;
  if prod.kind = 'game' then
    insert into public.entitlements (user_id, item) values (p_user, prod.game_id) on conflict do nothing;
  elsif prod.kind = 'pass' then
    insert into public.entitlements (user_id, item) values (p_user, 'pass') on conflict do nothing;
  end if;
  if prod.gems > 0 then
    insert into public.wallets (user_id, gems) values (p_user, prod.gems)
      on conflict (user_id) do update set gems = public.wallets.gems + excluded.gems, updated_at = now();
    insert into public.wallet_log (user_id, currency, amount, reason) values (p_user, 'gems', prod.gems, 'kauf:' || p_product);
  end if;
  return 'ok';
end $$;
revoke execute on function public.grant_purchase(text, uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.grant_purchase(text, uuid, text, integer, text, text) to service_role;
