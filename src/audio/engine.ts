/**
 * Procedural audio — no asset files. A soft generative soundscape:
 * low filtered noise for water, airy noise for leaves, occasional droplets,
 * and warm chimes for discoveries. Suspends fully while hidden (0% CPU).
 */

interface AmbientProfile {
  /** 0..1 — how watery the world is */
  readonly waterAmount: number;
  /** 0..1 — how leafy the world is */
  readonly landAmount: number;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambientNodes: AudioNode[] = [];
let dropletTimer: ReturnType<typeof setTimeout> | undefined;
let muted = false;

const MASTER_VOLUME = 0.16;
const MUTE_KEY = "vivaria-muted";

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
    return ctx;
  } catch {
    return null; // audio is a garnish — never break the game over it
  }
}

let cachedNoise: AudioBuffer | null = null;

/** white noise buffer — generated once, shared by all ambient layers */
function noiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  if (cachedNoise && cachedNoise.sampleRate === context.sampleRate) {
    return cachedNoise;
  }
  const buffer = context.createBuffer(
    1,
    Math.floor(context.sampleRate * seconds),
    context.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  cachedNoise = buffer;
  return buffer;
}

function makeNoiseLayer(
  context: AudioContext,
  destination: AudioNode,
  type: BiquadFilterType,
  frequency: number,
  gainValue: number,
  lfoRate: number,
  lfoDepth: number,
): AudioNode[] {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context, 4);
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = 0.8;

  const gain = context.createGain();
  gain.gain.value = gainValue;

  // slow breathing of the layer
  const lfo = context.createOscillator();
  lfo.frequency.value = lfoRate;
  const lfoGain = context.createGain();
  lfoGain.gain.value = gainValue * lfoDepth;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start();
  lfo.start();
  return [source, filter, gain, lfo, lfoGain];
}

function scheduleDroplet(profile: AmbientProfile): void {
  if (!ctx || !master || profile.waterAmount <= 0.05) return;
  const delay = 4000 + Math.random() * 14000;
  dropletTimer = setTimeout(() => {
    playDroplet();
    scheduleDroplet(profile);
  }, delay);
}

function playDroplet(): void {
  if (!ctx || !master || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  const base = 900 + Math.random() * 700;
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 0.45, t + 0.09);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.5, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + 0.5);
}

/** Begin (or rebuild) the ambient bed. Call from a user gesture. */
export function startAmbient(profile: AmbientProfile): void {
  const context = ensureContext();
  if (!context || !master) return;
  void context.resume();
  stopAmbientNodes();

  if (profile.waterAmount > 0.05) {
    ambientNodes.push(
      ...makeNoiseLayer(
        context,
        master,
        "lowpass",
        320,
        0.5 * profile.waterAmount,
        0.07,
        0.35,
      ),
    );
  }
  if (profile.landAmount > 0.05) {
    ambientNodes.push(
      ...makeNoiseLayer(
        context,
        master,
        "bandpass",
        1900,
        0.16 * profile.landAmount,
        0.05,
        0.5,
      ),
    );
  }
  clearTimeout(dropletTimer);
  scheduleDroplet(profile);
}

function stopAmbientNodes(): void {
  for (const node of ambientNodes) {
    try {
      if (node instanceof AudioBufferSourceNode || node instanceof OscillatorNode) {
        node.stop();
      }
      node.disconnect();
    } catch {
      // already stopped
    }
  }
  ambientNodes = [];
  clearTimeout(dropletTimer);
}

export function stopAmbient(): void {
  stopAmbientNodes();
}

/** Warm two-partial chime — discoveries and milestones. */
export function playChime(big = false): void {
  if (muted) return;
  const context = ensureContext();
  if (!context || !master || context.state !== "running") return;
  const t = context.currentTime;
  const notes = big ? [392, 523.25, 659.25] : [523.25, 783.99];
  notes.forEach((freq, i) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const start = t + i * 0.09;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(big ? 0.5 : 0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.6);
    osc.connect(gain);
    gain.connect(master!);
    osc.start(start);
    osc.stop(start + 1.7);
  });
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // private mode — fine
  }
  if (master) {
    master.gain.value = value ? 0 : MASTER_VOLUME;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function loadMutePreference(): void {
  try {
    muted = window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    muted = false;
  }
}

/** Hidden = silence and zero processing; visible = breathe again. */
export function bindAudioVisibility(): void {
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.visibilityState === "hidden") {
      void ctx.suspend();
    } else {
      void ctx.resume();
    }
  });
}
