#!/usr/bin/env node
// Manage Remi rooms in the Firebase Realtime Database (REST, no dependencies).
//
//   node scripts/rooms.mjs [list]
//   node scripts/rooms.mjs show <code>       (state + the room's recent-write log)
//   node scripts/rooms.mjs delete <code> [<code> ...]
//   node scripts/rooms.mjs delete-all [--yes]
//
// DB URL: --db <url>, else $REMI_DB_URL, else DEFAULT_DB_URL from js/state.js.

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

function takeFlag(name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function takeOption(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const val = args[i + 1];
  args.splice(i, 2);
  return val;
}

function defaultDbUrl() {
  const src = readFileSync(fileURLToPath(new URL('../js/state.js', import.meta.url)), 'utf8');
  const m = src.match(/DEFAULT_DB_URL\s*=\s*'([^']+)'/);
  if (!m) throw new Error('DEFAULT_DB_URL not found in js/state.js');
  return m[1];
}

const yes = takeFlag('--yes');
const dbUrl = (takeOption('--db') || process.env.REMI_DB_URL || defaultDbUrl()).replace(/\/+$/, '');
const [cmd = 'list', ...rest] = args;

async function api(path, init) {
  const res = await fetch(`${dbUrl}/${path}`, init);
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function roomCodes() {
  const keys = await api('rooms.json?shallow=true');
  return keys ? Object.keys(keys).sort() : [];
}

async function confirm(question) {
  if (yes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function describe(room) {
  if (!room) return '(empty)';
  const players = Array.isArray(room.players) ? room.players : Object.values(room.players || {});
  const names = players.map((p) => p?.name).filter(Boolean).join(', ') || 'no players';
  const started = room.createdAt || room.updatedAt;
  const when = typeof started === 'number' ? `  ${new Date(started).toISOString().slice(0, 16)}` : '';
  return `${String(room.phase ?? '?').padEnd(10)} ${names}${when}`;
}

async function list() {
  const codes = await roomCodes();
  if (!codes.length) return console.log('No rooms.');
  const rooms = await Promise.all(codes.map((c) => api(`rooms/${c}.json`).catch(() => null)));
  codes.forEach((c, i) => console.log(`${c.padEnd(10)} ${describe(rooms[i])}`));
  console.log(`\n${codes.length} room(s) in ${dbUrl}`);
}

// A room's writeLog (stamped by saveRoom / updateRoomAtomically in
// js/storage.js): who wrote, on which app version, what move, and whose turn
// it left - oldest first.
async function show([code]) {
  if (!code) throw new Error('usage: show <code>');
  const room = await api(`rooms/${encodeURIComponent(code)}.json`);
  if (!room) return console.log(`No room ${code}.`);
  const players = Array.isArray(room.players) ? room.players : Object.values(room.players || {});
  const nameOf = (id) => players.find((p) => p?.id === id)?.name || id || '?';
  console.log(`${code}  ${describe(room)}`);
  console.log(`round ${room.round ?? '?'}  turn: ${players[room.currentPlayerIndex]?.name ?? '-'} (${room.turnPhase ?? '-'})  writeId ${room.writeId ?? '-'}`);
  const log = Array.isArray(room.writeLog) ? room.writeLog : Object.values(room.writeLog || {});
  if (!log.length) return console.log('\nNo write log (room last written by a pre-v1.50 client).');
  console.log('');
  for (const w of log) {
    const d = new Date(w.at); // local time, to the millisecond
    const time = typeof w.at === 'number' ? `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}` : '?';
    const turn = w.phase === 'playing' ? `-> ${players[w.cur]?.name ?? w.cur} ${w.tp ?? ''}` : `-> ${w.phase ?? '?'}`;
    console.log(`${time}  ${String(w.v ?? '?').padEnd(6)} ${nameOf(w.by).padEnd(10)} ${String(w.action ?? '?').padEnd(18)} ${turn.padEnd(20)} ${w.writeId ?? ''}`);
  }
}

async function del(codes) {
  if (!codes.length) throw new Error('usage: delete <code> [<code> ...]');
  for (const code of codes) {
    await api(`rooms/${encodeURIComponent(code)}.json`, { method: 'DELETE' });
    console.log(`Deleted ${code}`);
  }
}

async function delAll() {
  const codes = await roomCodes();
  if (!codes.length) return console.log('No rooms.');
  if (!(await confirm(`Delete ALL ${codes.length} room(s) in ${dbUrl}?`))) return console.log('Aborted.');
  await del(codes);
}

const commands = {
  list,
  show: () => show(rest),
  codes: async () => console.log((await roomCodes()).join('\n')), // for shell completion
  delete: () => del(rest),
  'delete-all': delAll,
};

if (!commands[cmd]) {
  console.error('usage: rooms.mjs list | show <code> | delete <code> [...] | delete-all [--yes]   [--db <url>]');
  process.exit(1);
}
commands[cmd]().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
