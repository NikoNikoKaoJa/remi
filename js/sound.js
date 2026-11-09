// ===== Turn sound =====
// A soft "ocean breath" when the turn passes to you - lowpassed white noise
// swelling in and fading out, no notes - synthesized with Web Audio so
// there's no sound file to host. Browsers only let audio start after
// a user gesture, so the context is created/resumed on the first tap or click
// (joining a room always involves one) - before that, the chime is skipped.
// Muted by default; the toggle (lobby panel's top-right corner, and before Stanje in the
// game's bottom bar) turns it - and the lobby's join chime - on, remembered per browser.
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
const SWELL_PEAK = 0.4;
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

// A short two-note "ding-dong" (sine, E6 then C6) for a player joining the
// lobby. Follows the same toggle as the turn sound (shown in the lobby too).
function playJoinChime() {
  if (!soundOn || !ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [[1318.5, 0], [1046.5, 0.18]].forEach(([freq, at]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.25, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.65);
  });
}

// Called on every render. Chimes when the lobby gains a player you hadn't
// seen yet - not for yourself, and not on the first render after (re)joining.
export function checkJoinSound() {
  const r = state.room;
  const ids = r && r.phase === 'lobby' ? (r.players || []).map(p => p.id) : null;
  const prev = state.lastLobbyPlayerIds;
  state.lastLobbyPlayerIds = ids;
  if (!ids || !prev) return;
  if (ids.some(id => id !== state.session.playerId && !prev.includes(id))) playJoinChime();
}

// A rising four-note arpeggio (triangle, C5-E5-G5-C6) when another player
// goes out and the round ends. Same toggle as the other sounds.
function playFinishChime() {
  if (!soundOn || !ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36]].forEach(([freq, at]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.3, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + (at === 0.36 ? 0.9 : 0.35));
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.95);
  });
}

// Called on every render. Plays once when the round ends with someone else
// as the winner (keyed by round + winner) - not when you went out yourself,
// and not on the first render after (re)joining onto a finished round.
export function checkFinishSound() {
  const r = state.room;
  const key = r && r.phase === 'round_end' && r.roundWinner ? `${r.round}:${r.roundWinner}` : null;
  const prev = state.lastFinishKey;
  state.lastFinishKey = key;
  if (key && key !== prev && prev !== undefined && r.roundWinner !== state.session.playerId) playFinishChime();
}

// Switching it on plays a preview: the join chime in the lobby (`lobby`),
// the turn sound at the table.
export function soundToggleEl({ lobby = false } = {}) {
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
    if (soundOn && ctx) ctx.resume().then(lobby ? playJoinChime : playTurnChime);
  };
  return btn;
}
