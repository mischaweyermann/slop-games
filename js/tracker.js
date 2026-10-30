// Mehrere Personen in einem Kamerabild auseinanderhalten.
// MediaPipe liefert pro Bild bis zu 4 Körper, aber ohne feste Reihenfolge. Der Tracker ordnet
// sie über die Schulterposition von Bild zu Bild derselben Person zu (feste ID pro Person).

// One-Euro-Filter: glättet Zittern bei langsamen Bewegungen, reagiert sofort bei schnellen
export class OneEuro {
  constructor(minCutoff = 1.4, beta = 7, dCutoff = 1.2) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 }); }
  static a(cutoff, dt) { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max((t - this.t) / 1000, 1e-3); this.t = t;
    this.dx += OneEuro.a(this.dCutoff, dt) * ((v - this.x) / dt - this.dx);
    this.x += OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

// Diese Punkte werden übertragen: Nase, Schultern, Ellbogen, Handgelenke, Zeigefinger, Hüften, Knie, Knöchel
export const IDX = [0, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28];

export class MultiTracker {
  constructor(max = 4, { stableMs = 900, lostMs = 1500, reviveMs = 12000 } = {}) {
    Object.assign(this, { max, stableMs, lostMs, reviveMs, tracks: [], lost: [], nextId: 1 });
  }
  // lms: Liste von Landmark-Arrays (33 Punkte, 0..1). Gibt die Personen zurück, die gerade im Bild und schon stabil erkannt sind.
  update(lms, t) {
    const dets = (lms || []).map((lm) => {
      const a = lm[11], b = lm[12];
      // Schultern etwas grosszügiger annehmen: bei schlechtem Licht oder verdeckten Armen sinkt die Sichtbarkeit schnell
      return { lm, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, sw: Math.hypot(a.x - b.x, a.y - b.y), ok: (a.visibility ?? 1) > 0.3 && (b.visibility ?? 1) > 0.3 };
    }).filter((d) => d.ok && d.sw > 0.035); // zu kleine (weit hinten stehende) Personen ignorieren
    // nächstgelegene Paare zuerst zuordnen
    const pairs = [];
    this.tracks.forEach((tr, ti) => dets.forEach((d, di) => pairs.push([Math.hypot(tr.cx - d.cx, (tr.cy - d.cy) * 0.6), ti, di])));
    pairs.sort((x, y) => x[0] - y[0]);
    const usedT = new Set(), usedD = new Set();
    for (const [dist, ti, di] of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      const tr = this.tracks[ti];
      if (dist > Math.max(0.12, tr.sw * 1.5)) continue;
      usedT.add(ti); usedD.add(di);
      Object.assign(tr, { cx: dets[di].cx, cy: dets[di].cy, sw: dets[di].sw, seen: t, lm: dets[di].lm });
    }
    // Kurz verlorene Personen: kommt jemand an fast derselben Stelle wieder ins Bild, bekommt er seine alte ID zurück.
    // So verliert niemand mitten im Spiel die Steuerung, nur weil die Kamera ihn einen Moment nicht gesehen hat.
    this.lost = this.lost.filter((tr) => t - tr.seen < this.reviveMs);
    dets.forEach((d, di) => {
      if (usedD.has(di) || this.tracks.length >= this.max) return;
      let best = -1, bd = Infinity;
      this.lost.forEach((tr, li) => {
        const dist = Math.hypot(tr.cx - d.cx, (tr.cy - d.cy) * 0.6);
        if (dist < Math.max(0.3, tr.sw * 3) && dist < bd) { bd = dist; best = li; }
      });
      if (best >= 0) {
        const tr = this.lost.splice(best, 1)[0];
        tr.filters.forEach((f) => f.forEach((x) => x.reset()));
        Object.assign(tr, { cx: d.cx, cy: d.cy, sw: d.sw, seen: t, lm: d.lm, first: Math.min(tr.first, t - this.stableMs) });
        this.tracks.push(tr);
        return;
      }
      this.tracks.push({ id: this.nextId++, cx: d.cx, cy: d.cy, sw: d.sw, first: t, seen: t, lm: d.lm, filters: IDX.map(() => [new OneEuro(), new OneEuro(), new OneEuro(1, 4)]) });
    });
    // wer zu lange fehlt, kommt auf die Warteliste (siehe oben) und nach reviveMs ganz weg
    for (const tr of this.tracks) if (t - tr.seen >= this.lostMs) this.lost.push(tr);
    this.tracks = this.tracks.filter((tr) => t - tr.seen < this.lostMs);
    return this.tracks.filter((tr) => tr.seen === t && t - tr.first >= this.stableMs);
  }
  // Tiefe (MediaPipe-z, kleiner = näher an der Kamera) – fürs Boxen: Schläge und Tritte zur Kamera hin
  depth(tr, t) {
    return IDX.map((i, n) => Math.round(tr.filters[n][2].filter(tr.lm[i].z ?? 0, t) * 1000) / 1000);
  }
  // Geglättete, gespiegelte Körperpunkte [x, y, sichtbar, …] für eine Person
  points(tr, t, mirror = true) {
    const k = [];
    IDX.forEach((i, n) => {
      const p = tr.lm[i];
      const x = tr.filters[n][0].filter(p.x, t), y = tr.filters[n][1].filter(p.y, t);
      k.push(Math.round((mirror ? 1 - x : x) * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round((p.visibility ?? 1) * 100) / 100);
    });
    return k;
  }
}
