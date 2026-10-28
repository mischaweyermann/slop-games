// Kleine Sound-Engine: alle Klänge werden live mit WebAudio erzeugt (keine Dateien nötig).
export function createAudio() {
  let ctx = null, master = null, sfx = null, musicBus = null, noiseBuf = null;
  let muted = false, musicTimer = null, step = 0, nextTime = 0;

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const PENTA = [0, 2, 4, 7, 9];
  const scaleNote = (i) => 72 + PENTA[i % 5] + 12 * Math.floor(i / 5);

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      comp.connect(ctx.destination);
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.85; master.connect(comp);
      sfx = ctx.createGain(); sfx.connect(master);
      musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ f, at, dur = 0.2, type = 'sine', vol = 0.2, to = null, attack = 0.006, dest }) {
    const t0 = at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest || sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise({ at, dur = 0.1, vol = 0.3, type = 'bandpass', freq = 1500, to = null, q = 0.9 }) {
    const t0 = at ?? ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(freq, t0);
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(fl).connect(g).connect(sfx);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }

  const play = (fn) => { if (ensure()) fn(ctx.currentTime); };

  function scheduleMusic() {
    const BEAT = 60 / 104 / 2;
    const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    while (nextTime < ctx.currentTime + 0.15) {
      const s = step % 32;
      const chord = chords[Math.floor(s / 8)];
      if (s % 8 === 0) tone({ f: midi(chord[0] - 12), at: nextTime, dur: 1.1, vol: 0.16, dest: musicBus });
      if (s % 8 === 4) tone({ f: midi(chord[2] - 12), at: nextTime, dur: 0.6, vol: 0.09, dest: musicBus });
      if (s % 2 === 0 || Math.random() < 0.3) {
        const n = chord[Math.floor(Math.random() * 3)] + 12 + (Math.random() < 0.25 ? 12 : 0);
        tone({ f: midi(n), at: nextTime, dur: 0.32, type: 'triangle', vol: 0.06, dest: musicBus });
      }
      nextTime += BEAT; step++;
    }
  }

  return {
    unlock: () => ensure(),
    get ready() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.05); },

    pop(level = 0) {
      play((t) => {
        noise({ at: t, dur: 0.07, vol: 0.5, freq: 2400 });
        const f = midi(scaleNote(Math.min(level, 12)));
        tone({ f, at: t, dur: 0.24, type: 'triangle', vol: 0.22 });
        tone({ f: f * 2, at: t + 0.015, dur: 0.12, vol: 0.07 });
      });
    },
    gold() {
      play((t) => {
        [0, 4, 7, 12].forEach((s, i) => tone({ f: midi(84 + s), at: t + i * 0.055, dur: 0.35, type: 'triangle', vol: 0.15 }));
        noise({ at: t, dur: 0.25, vol: 0.12, type: 'highpass', freq: 6000 });
      });
    },
    bad() {
      play((t) => {
        noise({ at: t, dur: 0.7, vol: 0.6, type: 'lowpass', freq: 700, to: 90, q: 0.5 });
        tone({ f: 220, to: 70, at: t, dur: 0.5, type: 'sawtooth', vol: 0.1 });
      });
    },
    combo(level) {
      play((t) => [0, 4, 7, 12, 16].slice(0, 2 + level).forEach((s, i) =>
        tone({ f: midi(79 + s), at: t + i * 0.05, dur: 0.25, type: 'square', vol: 0.05 })));
    },
    tick() { play((t) => tone({ f: 880, at: t, dur: 0.14, vol: 0.2 })); },
    go() { play((t) => { tone({ f: 1046, at: t, dur: 0.4, type: 'triangle', vol: 0.22 }); tone({ f: 1568, at: t + 0.06, dur: 0.35, vol: 0.1 }); }); },
    whoosh() { play((t) => noise({ at: t, dur: 0.45, vol: 0.18, freq: 400, to: 3000, q: 1.5 })); },
    end() { play((t) => [72, 76, 79, 84, 88].forEach((n, i) => tone({ f: midi(n), at: t + i * 0.11, dur: 0.5, type: 'triangle', vol: 0.16 }))); },

    // Motorgeräusch fürs Rennspiel: zwei verstimmte Sägezähne durch einen Tiefpass
    engine(on) {
      if (!on) {
        if (this._eng) { const e = this._eng; e.g.gain.setTargetAtTime(0, ctx.currentTime, 0.15); setTimeout(() => { e.o1.stop(); e.o2.stop(); }, 600); this._eng = null; }
        return;
      }
      if (this._eng || !ensure()) return;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'square';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 2;
      const g = ctx.createGain(); g.gain.value = 0;
      o1.connect(lp); o2.connect(lp); lp.connect(g).connect(sfx);
      o1.start(); o2.start();
      g.gain.setTargetAtTime(0.07, ctx.currentTime, 0.3);
      this._eng = { o1, o2, lp, g };
    },
    engineSet(speed01, boost = false) {
      const e = this._eng; if (!e) return;
      const t = ctx.currentTime;
      // «Gänge»: Drehzahl steigt in Stufen an
      const gear = Math.min(3, Math.floor(speed01 * 4));
      const rpm = 0.25 + ((speed01 * 4 - gear) * 0.75) + gear * 0.06;
      const f = 48 + rpm * 70 + (boost ? 25 : 0);
      e.o1.frequency.setTargetAtTime(f, t, 0.05);
      e.o2.frequency.setTargetAtTime(f * 0.5 + 1.5, t, 0.05);
      e.lp.frequency.setTargetAtTime(380 + speed01 * 900 + (boost ? 500 : 0), t, 0.08);
      e.g.gain.setTargetAtTime(0.045 + speed01 * 0.045, t, 0.1);
    },
    // Fahrtwind (Ski): Rauschen, das mit dem Tempo lauter und heller wird
    wind(on) {
      if (!on) {
        if (this._wind) { const w = this._wind; w.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3); setTimeout(() => w.src.stop(), 1200); this._wind = null; }
        return;
      }
      if (this._wind || !ensure()) return;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(sfx); src.start();
      this._wind = { src, bp, g };
    },
    windSet(speed01) {
      const w = this._wind; if (!w) return;
      const t = ctx.currentTime;
      w.bp.frequency.setTargetAtTime(350 + speed01 * 1600, t, 0.1);
      w.g.gain.setTargetAtTime(0.02 + speed01 * 0.16, t, 0.15);
    },
    skid(amount) {
      if (!ensure() || amount < 0.1) return;
      noise({ dur: 0.12, vol: 0.06 * amount, type: 'bandpass', freq: 2600, q: 3 });
    },

    music(on) {
      if (!on && !ctx) return;
      if (!ensure()) return;
      if (on && !musicTimer) {
        nextTime = ctx.currentTime + 0.05; step = 0;
        musicTimer = setInterval(scheduleMusic, 40);
        musicBus.gain.setTargetAtTime(0.55, ctx.currentTime, 0.4);
      } else if (!on && musicTimer) {
        musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        const id = musicTimer; musicTimer = null;
        setTimeout(() => clearInterval(id), 900);
      }
    },
  };
}
