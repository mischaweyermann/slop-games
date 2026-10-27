// Gemeinsame Verbindungs-Einstellungen für TV und Handy (PeerJS / WebRTC).
// Reihenfolge: direkter Weg (STUN) → eigenes TURN-Relay (Metered, Port 80/443,
// auch über TCP/TLS – kommt durch fast jede Firewall) → Gratis-Relay von PeerJS.
import { TURN_APP, TURN_KEY } from './config.js';

const BASE_ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:global.stun.twilio.com:3478' },
];
const PEERJS_TURN = { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' };

async function fetchTurn() {
  const params = new URLSearchParams(location.search);
  // ?turn=app:key erlaubt Testen ohne Code-Änderung
  const [app, key] = (params.get('turn') || `${TURN_APP}:${TURN_KEY}`).split(':');
  if (!app || !key) return [];
  const cacheKey = 'slope.turn.' + app;
  try {
    const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (c && Date.now() - c.at < 30 * 60 * 1000) return c.list;
  } catch {}
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, { signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) throw new Error('TURN ' + r.status);
    const list = (await r.json()).filter((s) => s && s.urls);
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), list })); } catch {}
    return list;
  } catch (e) {
    console.warn('[net] eigenes TURN nicht erreichbar, nutze Fallback', e);
    return [];
  }
}

const OWN_TURN = await fetchTurn();
export const HAS_RELAY = OWN_TURN.some((s) => String(s.urls).includes('turn'));
export const ICE_SERVERS = [...BASE_ICE, ...OWN_TURN, PEERJS_TURN];

// ?peer=host:port erlaubt einen eigenen PeerJS-Server (z. B. lokal zum Testen)
export function peerOptions(params) {
  const base = { debug: 1, config: { iceServers: ICE_SERVERS, sdpSemantics: 'unified-plan', iceCandidatePoolSize: 2 }, pingInterval: 4000 };
  const p = params.get('peer');
  if (!p) return base;
  const [host, port] = p.split(':');
  return { ...base, host, port: +port || 443, path: '/', secure: location.protocol === 'https:' };
}

// Stabile Kennung dieses Handys (bleibt beim Neuverbinden gleich)
export function deviceId() {
  try {
    let id = sessionStorage.getItem('slope.pid');
    if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); sessionStorage.setItem('slope.pid', id); }
    return id;
  } catch { return Math.random().toString(36).slice(2, 12); }
}
