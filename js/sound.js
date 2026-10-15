// ===== Turn sound =====
// A soft "ocean breath" when the turn passes to you - lowpassed white noise
// swelling in and fading out, no notes - synthesized with Web Audio so
// there's no sound file to host. Browsers only let audio start after
// a user gesture, so the context is created/resumed on the first tap or click
// (joining a room always involves one) - before that, the chime is skipped.
// Muted by default; the toggle before Stanje in the bottom bar turns it on, remembered per browser.
import { state } from './state.js';
import { isMyTurn } from './actions.js';
import { el } from './cards.js';

const SOUND_KEY = 'remi-sound';
let soundOn = false;
try { soundOn = localStorage.getItem(SOUND_KEY) === 'on'; } catch (e) {}

let ctx = null;

function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
}
['pointerdown', 'keydown'].forEach(t => window.addEventListener(t, unlockAudio, { capture: true }));

const SWELL_IN = 0.6;   // seconds to fade in
const SWELL_OUT = 1.2;  // seconds to fade out
const SWELL_PEAK = 0.05;
const SWELL_LOWPASS_HZ = 600;

function playTurnChime() {
  if (!soundOn || !ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const len = Math.ceil((SWELL_IN + SWELL_OUT + 0.1) * ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  src.buffer = buf;
  filter.type = 'lowpass';
  filter.frequency.value = SWELL_LOWPASS_HZ;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(SWELL_PEAK, now + SWELL_IN);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + SWELL_IN + SWELL_OUT);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);
}

// Called on every render. Chimes once each time the turn becomes yours
// (keyed by round + current player, so a new round where you act first also
// counts), but not on the very first render after (re)joining.
export function checkTurnSound() {
  const r = state.room;
  const key = r && r.phase === 'playing' ? `${r.round}:${r.currentPlayerIndex}` : null;
  const prev = state.lastTurnKey;
  state.lastTurnKey = key;
  if (key && key !== prev && prev !== undefined && isMyTurn()) playTurnChime();
}

export function soundToggleEl() {
  const btn = el('button', 'btn btn-outline-gold sound-toggle', soundOn ? '🔔' : '🔕');
  btn.title = soundOn ? 'Zvuk ukljucen' : 'Zvuk iskljucen';
  btn.setAttribute('aria-label', btn.title);
  btn.onclick = () => {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (e) {}
    btn.textContent = soundOn ? '🔔' : '🔕';
    btn.title = soundOn ? 'Zvuk ukljucen' : 'Zvuk iskljucen';
    btn.setAttribute('aria-label', btn.title);
    // A preview, so turning it on is audibly confirmed. On the very first
    // click the context is still resuming, hence waiting on resume().
    if (soundOn && ctx) ctx.resume().then(playTurnChime);
  };
  return btn;
}
