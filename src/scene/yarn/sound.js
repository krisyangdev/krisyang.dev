// Sound for the poke interactions. Plain Web Audio: recordings from public/sfx, plus one tiny synth (tick).
// Every play function is a silent no-op until unlockAudio() has produced a running context
// and the sample it needs has finished decoding.

// Cue feel: variant files, base playbackRate, gain, random rate jitter (+-fraction).
const CUES = {
  pop: { files: ["pop-1", "pop-2", "pop-3"], rate: 1, gain: 0.5, jitter: 0.04 },
  whoosh: { files: ["whoosh"], rate: 1, gain: 0.5, jitter: 0.06 },
  elastic: { files: ["elastic"], rate: 1, gain: 0.5, jitter: 0.03 },
  bubble: { files: ["bubble"], rate: 1, gain: 0.5, jitter: 0.05 },
  plink: { files: ["plink-1", "plink-2", "plink-3", "plink-4"], rate: 1.1, gain: 0.16, jitter: 0.04 },
  creak: { files: ["creak-1", "creak-2"], rate: 1, gain: 0.5, jitter: 0.04 },
  chime: { files: ["chime-1", "chime-2"], rate: 1, gain: 0.32, jitter: 0.03 },
  windchime: { files: ["windchime"], rate: 1, gain: 0.35, jitter: 0.05 },
};

const MAX_VOICES = 4; // overlapping voices per cue
const STEAL_FADE = 0.02; // seconds, fade of a voice cut by the cap
const START_LEAD = 0.005; // seconds, scheduling margin

const MASTER_GAIN = 0.9;
const MUTE_RAMP = 0.15; // seconds
const MUTE_KEY = "krisyang.muted";

let ctx = null;
let master = null;
let sfxBus = null;
let loading = false;
let muted = readMuted();

const buffers = new Map();

// Per-cue runtime state: last variant played and live voices, oldest first.
const state = {};
for (const name of Object.keys(CUES)) state[name] = { last: -1, voices: [] };

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(value) {
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // storage is optional
  }
}

// Fetch and decode every sample once the context exists.
function loadSamples() {
  if (loading) return;
  loading = true;
  const names = new Set();
  for (const cue of Object.values(CUES)) for (const file of cue.files) names.add(file);
  for (const name of names) {
    fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3`)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => buffers.set(name, buffer))
      .catch(() => {
        // a missing sample just stays silent
      });
  }
}

// Create or resume the shared context; call from any user gesture.
export function unlockAudio() {
  try {
    if (!ctx) {
      if (!window.AudioContext) return;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_GAIN;
      sfxBus = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      sfxBus.connect(master);
      master.connect(comp);
      comp.connect(ctx.destination);
      loadSamples();
    }
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    // audio is optional
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  writeMuted(muted);
  if (!ctx || !master) return;
  try {
    const now = ctx.currentTime;
    const gain = master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, now + MUTE_RAMP);
  } catch {
    // audio is optional
  }
}

// Fade a voice out quickly and stop it.
function steal(voice, now) {
  const gain = voice.gain.gain;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(0, now + STEAL_FADE);
  voice.source.stop(now + STEAL_FADE + 0.005);
}

// Play one random variant of a cue (never the same twice in a row).
function playCue(name, pitch = 1) {
  if (!ctx || ctx.state !== "running") return;
  try {
    const cue = CUES[name];
    const st = state[name];
    const count = cue.files.length;
    let index = Math.floor(Math.random() * count);
    if (count > 1 && index === st.last) index = (index + 1 + Math.floor(Math.random() * (count - 1))) % count;
    const buffer = buffers.get(cue.files[index]);
    if (!buffer) return;
    st.last = index;

    const now = ctx.currentTime;
    const voices = st.voices;
    while (voices.length >= MAX_VOICES) steal(voices.shift(), now);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = cue.rate * pitch * (1 + (Math.random() * 2 - 1) * cue.jitter);
    const gain = ctx.createGain();
    gain.gain.value = cue.gain;
    source.connect(gain);
    gain.connect(sfxBus);

    const voice = { source, gain };
    voices.push(voice);
    source.onended = () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
      gain.disconnect();
    };
    source.start(now + START_LEAD);
  } catch {
    // audio is optional
  }
}

export function playPop({ pitch = 1 } = {}) {
  playCue("pop", pitch);
}

export function playWhoosh({ pitch = 1 } = {}) {
  playCue("whoosh", pitch);
}

export function playElastic({ pitch = 1 } = {}) {
  playCue("elastic", pitch);
}

export function playBubble({ pitch = 1 } = {}) {
  playCue("bubble", pitch);
}

export function playWindchime({ pitch = 1 } = {}) {
  playCue("windchime", pitch);
}

export function playPlink({ pitch = 1 } = {}) {
  playCue("plink", pitch);
}

export function playChime({ pitch = 1 } = {}) {
  playCue("chime", pitch);
}

export function playCreak({ pitch = 1 } = {}) {
  playCue("creak", pitch);
}

// A small wooden tick: a falling sine blip plus a short band of noise.
const TICK_GAIN = 0.35;
let tickNoise = null;

export function playTick({ pitch = 1 } = {}) {
  if (!ctx || ctx.state !== "running") return;
  try {
    if (!tickNoise) {
      tickNoise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = tickNoise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + START_LEAD;
    const f = 1150 * pitch * (1 + (Math.random() * 2 - 1) * 0.04);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(f * 1.2, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.8, t + 0.035);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.4 * TICK_GAIN, t + 0.001);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(og).connect(sfxBus);
    osc.start(t);
    osc.stop(t + 0.06);

    const src = ctx.createBufferSource();
    src.buffer = tickNoise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2200;
    band.Q.value = 4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.18 * TICK_GAIN, t + 0.001);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.021);
    src.connect(band).connect(ng).connect(sfxBus);
    src.start(t);
    src.stop(t + 0.03);
  } catch {
    // audio is optional
  }
}
