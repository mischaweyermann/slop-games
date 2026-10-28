// Empfängt Nachrichten von Stripe. Nur Nachrichten mit gültiger Signatur werden verarbeitet.
// Bei bezahlter Checkout-Seite wird der Kauf gutgeschrieben (Spiel, Pass oder Juwelen),
// bei einer vollen Rückerstattung wieder entfernt.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stripe-Signatur: t=Zeitstempel, v1=HMAC-SHA256 über "t.body"
async function verify(body: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // höchstens 5 Minuten alt
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`)));
  return sigs.some((s) => safeEqual(s, expected));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return new Response('not configured', { status: 503 });

  const body = await req.text();
  if (!(await verify(body, req.headers.get('Stripe-Signature'), secret))) {
    return new Response('bad signature', { status: 400 });
  }

  const event = JSON.parse(body);
  const type: string = event.type;
  const s = event.data?.object;
  const paid =
    (type === 'checkout.session.completed' && s?.payment_status === 'paid') ||
    type === 'checkout.session.async_payment_succeeded';

  if (paid) {
    const userId = s.metadata?.user_id ?? s.client_reference_id;
    const product = s.metadata?.product;
    if (!userId || !product) {
      console.error('Checkout ohne Nutzer oder Produkt', s.id);
      return new Response('ok');
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin.rpc('grant_purchase', {
      p_session: s.id,
      p_user: userId,
      p_product: product,
      p_amount: s.amount_total ?? 0,
      p_currency: s.currency ?? 'chf',
      p_payment_intent: typeof s.payment_intent === 'string' ? s.payment_intent : null,
    });
    if (error) {
      console.error('Gutschrift fehlgeschlagen', s.id, error.message);
      return new Response('retry', { status: 500 }); // Stripe versucht es später nochmals
    }
    console.log('Kauf', s.id, product, data);
  }

  // Rückerstattung (nur ganz zurückerstattete Zahlungen): Freischaltung bzw. Juwelen wieder entfernen
  if (type === 'charge.refunded' && s?.refunded === true && typeof s.payment_intent === 'string') {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin.rpc('revoke_purchase', { p_payment_intent: s.payment_intent });
    if (error) {
      console.error('Rückerstattung fehlgeschlagen', s.payment_intent, error.message);
      return new Response('retry', { status: 500 });
    }
    console.log('Rückerstattung', s.payment_intent, data);
  } else if (type === 'charge.refunded') {
    console.log('Teilrückerstattung, Freischaltung bleibt', s?.payment_intent);
  }
  return new Response('ok');
});
