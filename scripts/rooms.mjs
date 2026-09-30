#!/usr/bin/env node
// Manage Remi rooms in the Firebase Realtime Database (REST, no dependencies).
//
//   node scripts/rooms.mjs [list]
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
  codes: async () => console.log((await roomCodes()).join('\n')), // for shell completion
  delete: () => del(rest),
  'delete-all': delAll,
};

if (!commands[cmd]) {
  console.error('usage: rooms.mjs list | delete <code> [...] | delete-all [--yes]   [--db <url>]');
  process.exit(1);
}
commands[cmd]().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
