// Procedural audio with the WebAudio API: no asset files. One shared context, one master gain,
// and short synthesized voices for shots, impacts, reloads, hits, the bomb and round stingers.
let ctx = null;
let master = null;

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return true;
}

function noiseBuffer(seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// A filtered noise burst: the body of a gunshot or an impact.
function burst({ seconds = 0.12, gain = 0.6, type = 'lowpass', frequency = 2200, q = 0.8, pitch = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(seconds);
  src.playbackRate.value = pitch;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, ctx.currentTime);
  env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
  src.connect(filter).connect(env).connect(master);
  src.start();
  src.stop(ctx.currentTime + seconds);
}

// A pitched blip: clicks, beeps, stingers.
function tone({ frequency = 440, seconds = 0.1, gain = 0.25, type = 'square', slide = 1 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * slide), ctx.currentTime + seconds);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, ctx.currentTime);
  env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
  osc.connect(env).connect(master);
  osc.start();
  osc.stop(ctx.currentTime + seconds);
}

export const audio = {
  resume() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  },
  shot(kind, distance = 0) {
    if (!ensure()) return;
    const far = Math.min(1, distance / 34);
    if (kind === 'pistol') burst({ seconds: 0.09, gain: 0.5 * (1 - far * 0.7), frequency: 2600, pitch: 1.1 });
    else if (kind === 'smg') burst({ seconds: 0.07, gain: 0.42 * (1 - far * 0.7), frequency: 3200, pitch: 1.2 });
    else if (kind === 'dmr') burst({ seconds: 0.22, gain: 0.8 * (1 - far * 0.7), frequency: 1500, q: 1.4, pitch: 0.8 });
    else burst({ seconds: 0.14, gain: 0.65 * (1 - far * 0.7), frequency: 2000 });
    tone({ frequency: 150, seconds: 0.07, gain: 0.28 * (1 - far), type: 'sawtooth', slide: 0.4 });
  },
  impact() {
    if (!ensure()) return;
    burst({ seconds: 0.05, gain: 0.3, type: 'highpass', frequency: 3800 });
  },
  flesh() {
    if (!ensure()) return;
    burst({ seconds: 0.08, gain: 0.4, frequency: 700, q: 1.6, pitch: 0.7 });
  },
  reload() {
    if (!ensure()) return;
    tone({ frequency: 320, seconds: 0.05, gain: 0.2, type: 'square', slide: 0.6 });
    setTimeout(() => ensure() && tone({ frequency: 210, seconds: 0.07, gain: 0.22, type: 'square', slide: 1.4 }), 260);
    setTimeout(() => ensure() && tone({ frequency: 480, seconds: 0.05, gain: 0.2, type: 'square', slide: 0.7 }), 700);
  },
  hitConfirm() {
    if (!ensure()) return;
    tone({ frequency: 900, seconds: 0.06, gain: 0.18, type: 'sine', slide: 1.3 });
  },
  killConfirm() {
    if (!ensure()) return;
    tone({ frequency: 660, seconds: 0.09, gain: 0.22, type: 'sine', slide: 1.5 });
    setTimeout(() => ensure() && tone({ frequency: 990, seconds: 0.1, gain: 0.2, type: 'sine', slide: 1.2 }), 70);
  },
  hurt() {
    if (!ensure()) return;
    burst({ seconds: 0.12, gain: 0.4, frequency: 500, q: 2, pitch: 0.5 });
  },
  beep(high = false) {
    if (!ensure()) return;
    tone({ frequency: high ? 1760 : 1180, seconds: 0.08, gain: 0.22, type: 'sine' });
  },
  explode() {
    if (!ensure()) return;
    burst({ seconds: 0.9, gain: 1.0, frequency: 420, q: 0.4, pitch: 0.5 });
    tone({ frequency: 90, seconds: 0.8, gain: 0.5, type: 'sawtooth', slide: 0.3 });
  },
  stinger(win) {
    if (!ensure()) return;
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => setTimeout(() => ensure() && tone({ frequency: f, seconds: 0.24, gain: 0.22, type: 'triangle' }), i * 130));
  },
  empty() {
    if (!ensure()) return;
    tone({ frequency: 1400, seconds: 0.03, gain: 0.15, type: 'square', slide: 0.7 });
  },
};
