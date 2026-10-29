-- Admin: einzelnen Nutzern vollen Spielzugriff schenken (Freischaltung 'pass' mit Quelle 'admin').
-- Ein gekaufter Pass (Quelle 'kauf') wird dabei nie entfernt.
create or replace function public.admin_set_full_access(target uuid, grant_access boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if grant_access then
    insert into public.entitlements (user_id, item, source) values (target, 'pass', 'admin')
    on conflict (user_id, item) do nothing;
  else
    delete from public.entitlements where user_id = target and item = 'pass' and source = 'admin';
  end if;
end $$;
revoke execute on function public.admin_set_full_access(uuid, boolean) from public, anon;
grant execute on function public.admin_set_full_access(uuid, boolean) to authenticated;

-- Nutzerliste zusätzlich mit Pass-Quelle (null = kein Pass, 'admin' = geschenkt, sonst gekauft)
drop function if exists public.admin_users();
create function public.admin_users()
returns table(id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, confirmed boolean, banned boolean,
              nickname text, "character" jsonb, plays bigint, seconds bigint, last_played timestamptz, pass_source text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
           u.email_confirmed_at is not null,
           coalesce(u.banned_until > now(), false),
           p.nickname, p.character,
           count(x.id) filter (where not x.imported),
           coalesce(sum(x.seconds), 0)::bigint,
           max(x.played_at) filter (where not x.imported),
           (select e.source from public.entitlements e where e.user_id = u.id and e.item = 'pass')
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.plays x on x.user_id = u.id
    group by u.id, p.nickname, p.character
    order by u.created_at desc;
end $$;
revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;
