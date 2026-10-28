// Startet einen Kauf: erstellt eine Stripe-Checkout-Seite (Karte, TWINT usw.) und gibt deren Adresse zurück.
// Gutgeschrieben wird erst durch den Webhook, wenn Stripe die Zahlung bestätigt.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SITE = Deno.env.get('SITE_URL') ?? 'https://slopgames.ch';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return json({ error: 'not_configured' }, 503);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'login' }, 401);

  let productId = '';
  try { productId = String((await req.json()).product ?? ''); } catch { /* */ }
  if (!/^[a-z0-9-]{2,40}$/.test(productId)) return json({ error: 'product' }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Solange die Bezahlung ausgeschaltet ist, dürfen nur Admins testen
  const { data: settings } = await admin.from('app_settings').select('payments_enabled').single();
  if (!settings?.payments_enabled) {
    const { data: isAdmin } = await userClient.rpc('is_admin');
    if (!isAdmin) return json({ error: 'payments_off' }, 403);
  }

  const { data: product } = await admin.from('products')
    .select('id, kind, name, description, game_id, price_rappen, active').eq('id', productId).maybeSingle();
  if (!product || !product.active) return json({ error: 'product' }, 404);

  // Schon gekauft? (Juwelen kann man mehrmals kaufen)
  if (product.kind !== 'gems') {
    const items = product.kind === 'pass' ? ['pass'] : [product.game_id, 'pass'];
    const { data: owned } = await admin.from('entitlements').select('item').eq('user_id', user.id).in('item', items);
    if (owned && owned.length) return json({ error: 'owned' }, 409);
  }

  const back = `${SITE}/kaufen.html?p=${encodeURIComponent(product.id)}`;
  const form = new URLSearchParams({
    mode: 'payment',
    locale: 'de',
    success_url: `${back}&ok=1`,
    cancel_url: back,
    client_reference_id: user.id,
    'metadata[user_id]': user.id,
    'metadata[product]': product.id,
    'payment_intent_data[metadata][user_id]': user.id,
    'payment_intent_data[metadata][product]': product.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'chf',
    'line_items[0][price_data][unit_amount]': String(product.price_rappen),
    'line_items[0][price_data][product_data][name]': `Slop Games – ${product.name}`,
  });
  if (product.description) form.set('line_items[0][price_data][product_data][description]', product.description);
  if (user.email) form.set('customer_email', user.email);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const session = await res.json();
  if (!res.ok) {
    console.error('Stripe-Fehler', session?.error?.message);
    return json({ error: 'stripe' }, 502);
  }
  return json({ url: session.url });
});
