// Gemeinsame Verbindungs-Einstellungen für TV und Handy (PeerJS / WebRTC).
// Mehrere STUN-Server helfen, den direkten Weg zwischen Geräten zu finden;
// die TURN-Server von PeerJS leiten weiter, wenn kein direkter Weg möglich ist
// (z. B. Handy im Mobilfunknetz und TV im WLAN, oder zwei TVs an verschiedenen Orten).
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

// ?peer=host:port erlaubt einen eigenen PeerJS-Server (z. B. lokal zum Testen)
export function peerOptions(params) {
  const base = { debug: 1, config: { iceServers: ICE_SERVERS, sdpSemantics: 'unified-plan' }, pingInterval: 4000 };
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
