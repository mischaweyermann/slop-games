-- Garderobe: kaufbare Teile für die Figur
create table public.skins (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  slot text not null check (slot in ('hat', 'glasses', 'top', 'back')),
  value text not null,
  name text not null,
  price_coins integer check (price_coins is null or price_coins > 0), -- null = nur mit Juwelen
  price_gems integer not null check (price_gems > 0),
  active boolean not null default true,
  sort smallint not null default 0,
  unique (slot, value)
);
alter table public.skins enable row level security;
create policy "Skins lesen" on public.skins for select to anon, authenticated using (true);
insert into public.skins (id, slot, value, name, price_coins, price_gems, sort) values
  ('hat-cat', 'hat', 'cat', 'Katzenohren', 150, 50, 1),
  ('glasses-heart', 'glasses', 'heart', 'Herzbrille', 200, 60, 2),
  ('glasses-star', 'glasses', 'star', 'Sternbrille', 200, 60, 3),
  ('hat-cowboy', 'hat', 'cowboy', 'Cowboyhut', 250, 80, 4),
  ('top-tracksuit', 'top', 'tracksuit', 'Trainingsjacke', 300, 100, 5),
  ('hat-viking', 'hat', 'viking', 'Wikingerhelm', 400, 120, 6),
  ('back-cape', 'back', 'cape', 'Umhang', 500, 150, 7),
  ('hat-astro', 'hat', 'astro', 'Astronautenhelm', null, 250, 8),
  ('back-wings', 'back', 'wings', 'Flügel', null, 300, 9);

create table public.owned_skins (
  user_id uuid not null references auth.users(id) on delete cascade,
  skin_id text not null references public.skins(id),
  currency text not null check (currency in ('coins', 'gems', 'gift')),
  created_at timestamptz not null default now(),
  primary key (user_id, skin_id)
);
alter table public.owned_skins enable row level security;
create policy "Eigene Skins lesen" on public.owned_skins for select to authenticated using (user_id = (select auth.uid()));

-- Kaufen mit Münzen oder Juwelen (alles in einer Transaktion)
create or replace function public.buy_skin(p_skin text, p_currency text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  s public.skins;
  price integer;
  w public.wallets;
begin
  if uid is null then raise exception 'login'; end if;
  select * into s from public.skins where id = p_skin and active;
  if not found then raise exception 'unknown_skin'; end if;
  if exists (select 1 from public.owned_skins o where o.user_id = uid and o.skin_id = p_skin) then raise exception 'owned'; end if;
  if p_currency = 'coins' then price := s.price_coins;
  elsif p_currency = 'gems' then price := s.price_gems;
  else raise exception 'currency'; end if;
  if price is null then raise exception 'gems_only'; end if;

  if p_currency = 'coins' then
    update public.wallets set coins = coins - price, updated_at = now() where user_id = uid and coins >= price returning * into w;
  else
    update public.wallets set gems = gems - price, updated_at = now() where user_id = uid and gems >= price returning * into w;
  end if;
  if not found then raise exception 'not_enough'; end if;

  insert into public.owned_skins (user_id, skin_id, currency) values (uid, p_skin, p_currency);
  insert into public.wallet_log (user_id, currency, amount, reason) values (uid, p_currency, -price, 'skin:' || p_skin);
  return json_build_object('coins', w.coins, 'gems', w.gems);
end $$;
revoke execute on function public.buy_skin(text, text) from public, anon;
grant execute on function public.buy_skin(text, text) to authenticated;

-- Nicht gekaufte Teile im Profil durch die Grundausstattung ersetzen
create or replace function public.strip_unowned_skins()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s record;
begin
  if new.character is null then return new; end if;
  for s in select k.id, k.slot, k.value from public.skins k
           where new.character ->> k.slot = k.value
             and not exists (select 1 from public.owned_skins o where o.user_id = new.id and o.skin_id = k.id)
  loop
    new.character := jsonb_set(new.character, array[s.slot], to_jsonb(case when s.slot = 'top' then 'tshirt' else 'none' end));
  end loop;
  return new;
end $$;
revoke execute on function public.strip_unowned_skins() from public, anon, authenticated;
create trigger profiles_strip_unowned_skins before insert or update of character on public.profiles
  for each row execute function public.strip_unowned_skins();
