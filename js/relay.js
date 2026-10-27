// Ausweich-Verbindung über einen öffentlichen MQTT-Server (WebSocket über das normale Internet).
// Damit klappt es in jedem Netz – auch wenn sich zwei Geräte in verschiedenen WLANs
// oder im Mobilfunk nicht direkt (WebRTC) erreichen. Es werden nur Spieldaten übertragen
// (Körperpunkte, Positionen), nie ein Kamerabild.
//
// Die Verbindungen verhalten sich wie PeerJS-DataConnections: open, metadata, send(), close(),
// on('open' | 'data' | 'close' | 'error').
const MQTT_URL = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.esm.js';
const params = new URLSearchParams(location.search);
const BROKERS = params.get('mqtt') ? [params.get('mqtt')] : [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const NS = 'slopgames/v1/';
// ?relay=only erzwingt den Umweg (zum Testen), ?relay=off schaltet ihn ab
export const RELAY_MODE = params.get('relay') || 'auto';
const RELAY_DELAY = 4000; // so lange bekommt die direkte Verbindung einen Vorsprung

const rid = () => Math.random().toString(36).slice(2, 10);
const inbox = (id) => NS + 'in/' + id.replace(/[^\w-]/g, '_');

/* ---------- Verbindung zum Broker (einmal pro Seite) ---------- */
let clientP = null;
const handlers = new Map(); // eigene Inbox-ID -> Funktion
function client() {
  if (clientP) return clientP;
  clientP = (async () => {
    const mod = (await import(MQTT_URL)).default;
    const connect = mod.connect || (mod.default && mod.default.connect);
    for (const url of BROKERS) {
      try {
        const c = await new Promise((res, rej) => {
          const cl = connect(url, { clientId: 'slop_' + rid() + rid(), clean: true, connectTimeout: 6000, reconnectPeriod: 2000, keepalive: 30 });
          const to = setTimeout(() => { cl.end(true); rej(new Error('timeout')); }, 7000);
          cl.once('connect', () => { clearTimeout(to); res(cl); });
          cl.once('error', (e) => { clearTimeout(to); cl.end(true); rej(e); });
        });
        c.on('message', (topic, buf) => {
          let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
          for (const [id, fn] of handlers) if (inbox(id) === topic) fn(msg);
        });
        // nach einem Neuverbinden die Abos erneuern
        c.on('connect', () => { for (const id of handlers.keys()) c.subscribe(inbox(id), { qos: 0 }); });
        console.info('[relay] verbunden mit', url);
        return c;
      } catch (e) { console.warn('[relay] Broker nicht erreichbar', url, e && e.message); }
    }
    clientP = null;
    throw new Error('kein Relay-Server erreichbar');
  })();
  return clientP;
}
async function listenInbox(id, fn) {
  const c = await client();
  handlers.set(id, fn);
  await new Promise((res) => c.subscribe(inbox(id), { qos: 0 }, () => res()));
}
function publish(c, to, msg) { try { c.publish(inbox(to), JSON.stringify(msg), { qos: 0 }); } catch { /* */ } }

/* ---------- Eine Verbindung über das Relay ---------- */
class RelayConn {
  constructor(me, peer, id, metadata) {
    Object.assign(this, { me, peer, connectionId: id, metadata, open: false, via: 'relay', h: {}, lastIn: Date.now(), closed: false });
  }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { for (const fn of this.h[ev] || []) { try { fn(...a); } catch (e) { console.error(e); } } }
  send(data) { if (!this.open || !this.c) return; publish(this.c, this.peer, { t: 'd', c: this.connectionId, f: this.me, d: data }); }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.c) publish(this.c, this.peer, { t: 'x', c: this.connectionId, f: this.me });
    this.end();
  }
  end() {
    clearInterval(this.pingT); clearInterval(this.knockT);
    conns.delete(this.connectionId);
    const was = this.open; this.open = false; this.closed = true;
    if (was) this.emit('close');
  }
  startPing() {
    this.pingT = setInterval(() => {
      if (Date.now() - this.lastIn > 12000) { this.end(); return; }
      publish(this.c, this.peer, { t: 'p', c: this.connectionId, f: this.me });
    }, 3000);
  }
}
const conns = new Map(); // connectionId -> RelayConn
function route(msg) {
  const c = conns.get(msg.c);
  if (!c) return false;
  c.lastIn = Date.now();
  if (msg.t === 'd') c.emit('data', msg.d);
  else if (msg.t === 'x') c.end();
  else if (msg.t === 'ok' && !c.open && !c.closed) { c.open = true; clearInterval(c.knockT); c.startPing(); c.emit('open'); }
  return true;
}

/* ---------- Auf eingehende Relay-Verbindungen hören (TV) ---------- */
export async function relayListen(myId, onConnection) {
  if (RELAY_MODE === 'off') return;
  try {
    const c = await client();
    await listenInbox(myId, (msg) => {
      if (route(msg)) return;
      if (msg.t !== 'hi' || !msg.c || !msg.f) return;
      const rc = new RelayConn(myId, msg.f, msg.c, msg.m || {});
      rc.c = c; conns.set(rc.connectionId, rc);
      onConnection(rc);
      publish(c, rc.peer, { t: 'ok', c: rc.connectionId, f: myId });
      rc.open = true; rc.startPing();
      setTimeout(() => !rc.closed && rc.emit('open'), 0);
    });
  } catch (e) { console.warn('[relay] kein Empfang möglich', e && e.message); }
}

/* ---------- Verbinden: erst direkt (WebRTC), nach kurzer Zeit zusätzlich übers Relay ---------- */
export function dial(peer, target, opts = {}) {
  const meta = opts.metadata || {};
  const d = {
    open: false, metadata: meta, via: '', h: {}, cur: null, closed: false, failed: 0,
    on(ev, fn) { (this.h[ev] ||= []).push(fn); return this; },
    emit(ev, ...a) { for (const fn of this.h[ev] || []) { try { fn(...a); } catch (e) { console.error(e); } } },
    send(m) { if (this.cur && this.cur.open) this.cur.send(m); },
    close() { this.closed = true; clearTimeout(this.relayT); for (const c of this.all) { try { c.close(); } catch { /* */ } } if (this.open) { this.open = false; this.emit('close'); } },
    get peerConnection() { return this.rtc && this.rtc.peerConnection; },
    all: [],
  };
  const attach = (c, via) => {
    d.all.push(c);
    c.on('open', () => {
      if (d.closed) { try { c.close(); } catch { /* */ } return; }
      if (d.cur) { if (c !== d.cur) { try { c.close(); } catch { /* */ } } return; }
      d.cur = c; d.via = via; d.open = true; clearTimeout(d.relayT);
      for (const o of d.all) if (o !== c) { try { o.close(); } catch { /* */ } }
      console.info('[net] verbunden über', via === 'relay' ? 'Relay' : 'direkt');
      d.emit('open');
    });
    c.on('data', (m) => { if (c === d.cur) d.emit('data', m); });
    c.on('close', () => { if (c === d.cur) { d.open = false; d.emit('close'); } });
    c.on('error', (e) => { if (!d.cur && ++d.failed >= d.all.length && (via === 'relay' || RELAY_MODE === 'off')) d.emit('error', e); });
  };
  if (RELAY_MODE !== 'only') { d.rtc = peer.connect(target, opts); attach(d.rtc, 'rtc'); }
  const startRelay = async () => {
    if (d.cur || d.closed || RELAY_MODE === 'off') return;
    try {
      const c = await client();
      if (d.cur || d.closed) return;
      const me = 'dial-' + rid() + rid();
      const rc = new RelayConn(me, target, rid() + rid(), meta);
      rc.c = c; conns.set(rc.connectionId, rc);
      await listenInbox(me, (msg) => route(msg));
      attach(rc, 'relay');
      const knock = () => publish(c, target, { t: 'hi', c: rc.connectionId, f: me, m: meta });
      knock(); rc.knockT = setInterval(knock, 1500);
      setTimeout(() => { if (!rc.open && !rc.closed) { rc.end(); rc.emit('error', new Error('relay timeout')); } }, 20000);
    } catch (e) { d.failed++; if (!d.cur && (RELAY_MODE === 'only' || d.failed >= 2)) d.emit('error', e); }
  };
  d.relayT = setTimeout(startRelay, RELAY_MODE === 'only' ? 0 : RELAY_DELAY);
  return d;
}

// Früh verbinden, damit der Umweg sofort bereit ist
export function warmRelay() { if (RELAY_MODE !== 'off') client().catch(() => {}); }
