import { createYinDetector } from './pitch.js';
import { A4_DEFAULT, midiToFreq, freqToMidi, centsBetween, noteName } from './instruments.js';
import * as i18n from './i18n.js';

const $ = id => document.getElementById(id);
const els = {
  readout: $('readout'),
  noteName: $('noteName'), freq: $('freq'), cents: $('cents'), bar: $('bar'), wave: $('wave'), spectrum: $('spectrum'),
  hint: $('hint'),
  settings: $('settings'), a4: $('a4'), a4Out: $('a4Out'), naming: $('naming'), input: $('input'), lang: $('lang'),
  toast: $('toast'),
};

const FFT_SIZE = 8192;
const GATE_DB = -52;
const IN_TUNE = 5; // cents
const HOLD_MS = 700;
const SEGMENTS = 101; // one per cent, -50..+50

// ------------------------------------------------------------------ state

const load = () => { try { return JSON.parse(localStorage.getItem('tuneitup') || '{}'); } catch { return {}; } };
const saved = load();
const state = {
  a4: Number(saved.a4) || A4_DEFAULT,
  lang: saved.lang || 'auto',
  naming: saved.naming || null,
  input: saved.input || '', // audio input deviceId, '' = browser default
};
const save = () => { try { localStorage.setItem('tuneitup', JSON.stringify(state)); } catch { /* private mode */ } };

i18n.use(state.lang);
const useH = () => (state.naming ? state.naming === 'H' : i18n.defaultH());
const name = midi => noteName(midi, useH());

let audio = null;
let rafId = 0;
let lastTick = 0;
let recent = [];
let lastHit = 0;
let wakeLock = null;

// ------------------------------------------------------------------ settings

els.lang.replaceChildren(new Option(i18n.t('auto-lang'), 'auto'), ...Object.entries(i18n.LANGS).map(([c, n]) => new Option(n, c)));
// Labels are only exposed once the microphone has been allowed, so the list is rebuilt after it starts.
let fillSeq = 0;
async function fillInputs() {
  const seq = ++fillSeq;
  let devices = [];
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch { /* insecure context */ }
  if (seq !== fillSeq) return; // a newer refresh is already running
  // Before the microphone is allowed the browser hides ids and labels; Chrome adds virtual 'default' and 'communications' twins
  const real = devices.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  els.input.replaceChildren(new Option(i18n.t('input.default'), ''),
    ...real.map((d, i) => new Option(d.label || i18n.t('input.n', { n: i + 1 }), d.deviceId)));
  els.input.value = [...els.input.options].some(o => o.value === state.input) ? state.input : '';
}
els.input.addEventListener('change', () => {
  state.input = els.input.value;
  save();
  if (audio) { stop(); start(); }
});
navigator.mediaDevices?.addEventListener?.('devicechange', fillInputs);
fillInputs();
const syncSettings = () => {
  els.a4.value = state.a4;
  els.a4Out.textContent = state.a4;
  els.a4.style.setProperty('--pct', ((state.a4 - 415) / 51) * 100 + '%');
  els.naming.value = useH() ? 'H' : 'B';
  els.lang.value = state.lang;
};
$('settingsBtn').addEventListener('click', () => { syncSettings(); fillInputs(); els.settings.showModal(); });
els.a4.addEventListener('input', () => { state.a4 = Number(els.a4.value); syncSettings(); save(); });
els.naming.addEventListener('change', () => { state.naming = els.naming.value; save(); });
els.lang.addEventListener('change', () => {
  state.lang = els.lang.value;
  i18n.use(state.lang);
  els.lang.options[0].textContent = i18n.t('auto-lang');
  i18n.apply();
  fillInputs();
  save();
  setHint(audio ? 'hint.listening' : 'hint.idle');
});

// ------------------------------------------------------------------ audio in

function updateDetector() {
  if (!audio) return;
  audio.detect = createYinDetector({
    sampleRate: audio.ctx.sampleRate,
    bufferSize: FFT_SIZE,
    minFreq: midiToFreq(28, state.a4),
    maxFreq: midiToFreq(100, state.a4),
  });
}

function openStream() {
  return navigator.mediaDevices.getUserMedia({
    // processing meant for calls distorts pitch
    audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      ...(state.input && { deviceId: { exact: state.input } }),
    },
  }).catch(err => {
    // the saved device was unplugged: fall back to the default one
    if (state.input && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      state.input = ''; save();
      return openStream();
    }
    throw err;
  });
}

let starting = false;
async function start() {
  if (!navigator.mediaDevices?.getUserMedia) { setHint(null, i18n.t('err.secure'), true); return; }
  if (starting) return;
  starting = true;
  try {
    const stream = await openStream();
    const ctx = getCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    audio = { ctx, stream, source, analyser, buf: new Float32Array(FFT_SIZE), detect: null };
    updateDetector();
    recent = [];
    setHint('hint.listening');
    fillInputs();
    rafId = requestAnimationFrame(tick);
    keepAwake();
  } catch (err) {
    stop();
    setHint(null, err.name === 'NotAllowedError' ? i18n.t('err.denied') : i18n.t('err.other', { msg: err.message || err.name }), true);
  } finally {
    starting = false;
  }
}

function stop() {
  cancelAnimationFrame(rafId);
  if (audio) {
    audio.stream.getTracks().forEach(tr => tr.stop());
    audio.source.disconnect();
    audio = null;
  }
  drawWave(null);
  drawSpectrum(null);
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  showIdle();
  setHint('hint.idle');
}

// Listening starts by itself; a context created before any gesture stays suspended until the first one.
const wake = () => { if (audio) audio.ctx.resume(); else start(); };
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, wake));
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
start();

async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => { if (audio && document.visibilityState === 'visible') keepAwake(); });

// ------------------------------------------------------------------ detection loop

function tick(now) {
  rafId = requestAnimationFrame(tick);
  if (now - lastTick < 40) return; // ~25 detections a second is plenty
  lastTick = now;

  const { analyser, buf, detect } = audio;
  analyser.getFloatTimeDomainData(buf);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  const db = 20 * Math.log10(Math.sqrt(sumSq / buf.length) || 1e-10);
  drawWave(buf);
  drawSpectrum();

  let freq = null;
  if (db >= GATE_DB) {
    const r = detect(buf);
    if (r && r.clarity > 0.85) freq = r.frequency;
  }

  // median of the last five: kills one-frame octave jumps
  recent.push(freq);
  if (recent.length > 5) recent.shift();
  const ok = recent.filter(v => v != null);
  if (ok.length >= 3) {
    const sorted = [...ok].sort((a, b) => a - b);
    lastHit = now;
    show(sorted[sorted.length >> 1]);
  } else if (now - lastHit > HOLD_MS) {
    showIdle();
    setHint('hint.listening');
  }
}

function show(freq) {
  const midi = Math.round(freqToMidi(freq, state.a4));
  const cents = centsBetween(freq, midiToFreq(midi, state.a4));
  const inTune = Math.abs(cents) <= IN_TUNE;
  waveHue = Math.round(120 * (1 - Math.min(Math.abs(cents), 50) / 50));
  els.readout.classList.remove('idle');
  els.readout.classList.toggle('ok', inTune);
  // green when in tune, through yellow and orange to red at half a semitone off
  els.readout.style.setProperty('--note-hue', Math.round(120 * (1 - Math.min(Math.abs(cents), 50) / 50)));
  els.noteName.textContent = name(midi);
  const c = Math.round(cents);
  els.freq.textContent = freq.toFixed(1) + ' Hz';
  els.cents.textContent = `${c > 0 ? '+' : ''}${c} ¢`;
  drawBar(cents, inTune);
  setHint(inTune ? 'hint.ok' : cents < 0 ? 'hint.low' : 'hint.high');
  els.bar.setAttribute('aria-valuenow', String(Math.max(-50, Math.min(50, c))));
}

function showIdle() {
  waveHue = null;
  els.readout.classList.add('idle');
  els.readout.classList.remove('ok');
  els.noteName.textContent = '';
  els.freq.textContent = '0.0 Hz';
  els.cents.textContent = '0 ¢';
  drawBar(null, false);
}

// ------------------------------------------------------------------ display

// Incoming audio as a scope trace, started at a rising zero crossing so it holds still.
const WAVE_SAMPLES = 1024;
let waveHue = null;
// Match the canvas bitmap to its CSS size and return the cleared 2d context.
function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, w, h);
  return { c, w, h, dpr };
}

const traceColor = (a = 0.9) => (waveHue == null ? `rgba(255, 255, 255, ${a * 0.4})` : `hsla(${waveHue}, 100%, 62%, ${a})`);

function drawWave(buf) {
  const { c: waveCtx, w, h, dpr } = prepare(els.wave);
  if (!buf) return;
  let start = 0;
  for (let i = 1; i < buf.length - WAVE_SAMPLES; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break; }
  let peak = 0.05; // floor, so room noise isn't blown up to full height
  for (let i = 0; i < WAVE_SAMPLES; i++) peak = Math.max(peak, Math.abs(buf[start + i]));
  waveCtx.lineWidth = 2 * dpr;
  waveCtx.lineJoin = 'round';
  waveCtx.strokeStyle = traceColor();
  waveCtx.beginPath();
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    const x = (i / (WAVE_SAMPLES - 1)) * w;
    const y = h / 2 - (buf[start + i] / peak) * h * 0.4;
    i ? waveCtx.lineTo(x, y) : waveCtx.moveTo(x, y);
  }
  waveCtx.stroke();
}

const segs = Array.from({ length: SEGMENTS }, (_, i) => {
  const s = document.createElement('i');
  if (i === (SEGMENTS - 1) / 2) s.className = 'mid';
  else if ((i - (SEGMENTS - 1) / 2) % 10 === 0) s.className = 'major';
  els.bar.append(s);
  return s;
});

function drawBar(cents, inTune) {
  const mid = (SEGMENTS - 1) / 2;
  const at = cents == null ? null : Math.round(Math.max(-50, Math.min(50, cents))) + mid;
  segs.forEach((s, i) => {
    s.classList.toggle('on', at != null && i === at);
    s.classList.toggle('near', at != null && Math.abs(i - at) === 1);
    s.classList.toggle('ok', inTune && i === mid);
  });
  els.bar.classList.toggle('ok', inTune);
}

function setHint(key, text, error = false) {
  els.hint.textContent = text ?? i18n.t(key);
  els.hint.classList.toggle('error', error);
}

// Spectrum on a log frequency axis (50 Hz - 5 kHz), one bar per pixel column pair.
// the floor sits above mic and room rumble, which otherwise keeps the low end lit
const SPEC_LO = 50, SPEC_HI = 5000, SPEC_DB_LO = -80, SPEC_DB_HI = -30;
let specBins = null;
function drawSpectrum(on = true) {
  const { c, w, h, dpr } = prepare(els.spectrum);
  if (!on || !audio) return;
  const { analyser, ctx } = audio;
  if (!specBins || specBins.length !== analyser.frequencyBinCount) specBins = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(specBins);
  const hzPerBin = ctx.sampleRate / analyser.fftSize;
  const barW = 3 * dpr, cols = Math.floor(w / barW);
  c.fillStyle = traceColor(0.85);
  for (let i = 0; i < cols; i++) {
    const f0 = SPEC_LO * (SPEC_HI / SPEC_LO) ** (i / cols), f1 = SPEC_LO * (SPEC_HI / SPEC_LO) ** ((i + 1) / cols);
    const b0 = Math.floor(f0 / hzPerBin), b1 = Math.max(b0, Math.ceil(f1 / hzPerBin));
    let db = SPEC_DB_LO;
    for (let b = b0; b <= b1; b++) db = Math.max(db, specBins[b]);
    const v = Math.max(0, Math.min(1, (db - SPEC_DB_LO) / (SPEC_DB_HI - SPEC_DB_LO)));
    if (v === 0) continue;
    const bh = Math.max(dpr, v * (h - 8 * dpr));
    c.fillRect(i * barW, h - bh, barW - dpr, bh);
  }
}

let ctx = null;
function getCtx() { return (ctx ||= new AudioContext()); }

// ------------------------------------------------------------------ PWA

function toast(msg, actionLabel, action) {
  els.toast.replaceChildren(msg + ' ');
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: actionLabel });
  b.addEventListener('click', action);
  els.toast.append(b);
  els.toast.hidden = false;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = worker => toast(i18n.t('update'), i18n.t('reload'), () => worker.postMessage('skip-waiting'));
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

// ------------------------------------------------------------------ boot

i18n.apply();
setHint('hint.idle');
