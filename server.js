#!/usr/bin/env node
'use strict';
/* ═══════════════════════════════════════════════════════════════════
   КОД-РУЛЕТКА · C# на скорость и выживание · мультиплеер на 2–6
   Локально:  node server.js                  (порт 3000)
   Туннель:   cloudflared tunnel --url http://localhost:3000
   Облако:    PORT выдаёт хостинг; PUBLIC_URL — свой адрес (необязательно)
   Зависимостей нет. Нужен Node.js 16+. Рядом должен лежать index.html.
   ═══════════════════════════════════════════════════════════════════ */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const argPort = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 0;
const PORT = Number(process.env.PORT) || argPort || 3000;
const PUBLIC_URL = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
let learnedOrigin = ''; // публичный адрес, узнанный из заголовков прокси/туннеля

const MAX_SEATS = 6;
const SPIN_MS = 3400;      // длительность вращения барабана
const COUNT_MS = 3200;     // отсчёт перед раундом
const GRACE_MS = 12000;    // grace-период на переподключение
const INTER_MS = 10000;    // пауза между раундами

const COLORS = ['#A78BFA', '#38BDF8', '#4ADE80', '#FBBF24', '#F472B6', '#FB7185'];
const AVATARS = ['🦈', '🐺', '🦊', '🐸', '🦉', '🐙', '👾', '🤖'];

/* ── Пул сниппетов C#: tier 0 — разминка, 1 — боевой, 2 — хардкор ── */
const SNIPS = [
  { title: 'Первый выстрел', tier: 0, code: [
    'Console.WriteLine("Hello, C#!");',
    'int group = 42;',
    'Console.WriteLine($"Group {group}");'].join('\n') },
  { title: 'Квадраты', tier: 0, code: [
    'for (int i = 0; i < 5; i++)',
    '{',
    '    Console.WriteLine(i * i);',
    '}'].join('\n') },
  { title: 'Чёт или нечет', tier: 0, code: [
    'int n = 17;',
    'if (n % 2 == 0)',
    '{',
    '    Console.WriteLine("even");',
    '}',
    'else',
    '{',
    '    Console.WriteLine("odd");',
    '}'].join('\n') },
  { title: 'Сортировка', tier: 0, code: [
    'int[] nums = { 3, 1, 4, 1, 5 };',
    'Array.Sort(nums);',
    'Console.WriteLine(nums[0]);'].join('\n') },
  { title: 'Кортеж удачи', tier: 0, code: [
    '(int, string) pair = (7, "luck");',
    'var (num, word) = pair;',
    'Console.WriteLine($"{num}: {word}");'].join('\n') },
  { title: 'Список имён', tier: 1, code: [
    'var names = new List<string> { "Ana", "Ivan" };',
    'foreach (var name in names)',
    '{',
    '    Console.WriteLine(name.ToUpper());',
    '}'].join('\n') },
  { title: 'Свой метод', tier: 1, code: [
    'static int Sum(int a, int b)',
    '{',
    '    return a + b;',
    '}',
    'Console.WriteLine(Sum(2, 3));'].join('\n') },
  { title: 'LINQ-фильтр', tier: 1, code: [
    'var nums = new[] { 1, 2, 3, 4, 6 };',
    'var even = nums.Where(x => x % 2 == 0);',
    'Console.WriteLine(even.Count());'].join('\n') },
  { title: 'Словарь', tier: 1, code: [
    'var ages = new Dictionary<string, int>();',
    'ages["Mila"] = 20;',
    'ages["Oleg"] = 21;',
    'Console.WriteLine(ages["Mila"]);'].join('\n') },
  { title: 'Класс студента', tier: 1, code: [
    'class Student',
    '{',
    '    public string Name { get; set; }',
    '    public int Score = 0;',
    '}',
    'var s = new Student { Name = "Kim" };'].join('\n') },
  { title: 'Try / Catch', tier: 1, code: [
    'try',
    '{',
    '    int x = int.Parse("42");',
    '    Console.WriteLine(x);',
    '}',
    'catch (FormatException)',
    '{',
    '    Console.WriteLine("bad input");',
    '}'].join('\n') },
  { title: 'Async / Await', tier: 2, code: [
    'static async Task<string> LoadAsync()',
    '{',
    '    await Task.Delay(100);',
    '    return "done";',
    '}',
    'var text = await LoadAsync();',
    'Console.WriteLine(text);'].join('\n') },
  { title: 'Switch-оценка', tier: 2, code: [
    'static string Grade(int score) => score switch',
    '{',
    '    >= 90 => "A",',
    '    >= 75 => "B",',
    '    >= 60 => "C",',
    '    _ => "F"',
    '};',
    'Console.WriteLine(Grade(88));'].join('\n') },
  { title: 'Record и with', tier: 2, code: [
    'record Point(int X, int Y);',
    'var p = new Point(3, 4);',
    'var q = p with { X = 10 };',
    'Console.WriteLine(q);'].join('\n') },
  { title: 'Обратный отсчёт', tier: 2, code: [
    'static IEnumerable<int> Countdown()',
    '{',
    '    for (int i = 5; i > 0; i--)',
    '    {',
    '        yield return i;',
    '    }',
    '}'].join('\n') },
  { title: 'Сигнализация', tier: 2, code: [
    'class Alarm',
    '{',
    '    public event Action? OnRing;',
    '    public void Ring()',
    '    {',
    '        OnRing?.Invoke();',
    '    }',
    '}'].join('\n') },
  { title: 'StringBuilder', tier: 2, code: [
    'var sb = new StringBuilder();',
    'for (int i = 0; i < 3; i++)',
    '{',
    '    sb.Append(i).Append(",");',
    '}',
    'Console.WriteLine(sb.ToString());'].join('\n') },
  { title: 'Интерфейс стрелка', tier: 2, code: [
    'interface IShooter',
    '{',
    '    void Shoot();',
    '}',
    'class Bot : IShooter',
    '{',
    '    public void Shoot() => Console.WriteLine("bang");',
    '}'].join('\n') },
];

/* ── Состояние стола ── */
let phase = 'lobby'; // lobby | countdown | round | timeout | summary | over
let round = 0, current = null, limitSec = 0, goTs = 0, endsAt = 0;
let hostId = null, winnerId = null, nextId = 1, hardcore = false;
let ide = true; // IDE-режим: автозакрытие скобок и кавычек (клиентская удобность)
let lastSummary = null, interEndsAt = 0;
let roundTimer = null, spinTimer = null, interTimer = null, countTimer = null;
let queue = [], spinning = null;
let stats = { shots: 0, clicks: 0 };
const used = new Set();
const players = new Map(); // id -> player
const conns = new Set();   // все ws-соединения (включая посетителей)

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', vio: '\x1b[35m', cyn: '\x1b[36m', bold: '\x1b[1m', rst: '\x1b[0m' };
function log(msg) { console.log(`${C.dim}[${new Date().toLocaleTimeString('ru-RU')}]${C.rst} ${msg}`); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = n => crypto.randomInt(n);
const alivePlayers = () => [...players.values()].filter(p => !p.spectator && !p.dead);
const seated = () => [...players.values()].filter(p => !p.spectator);
const bulletsFor = r => hardcore ? (r >= 8 ? 3 : r >= 4 ? 2 : 1) : (r >= 9 ? 3 : r >= 6 ? 2 : 1);

function clearGameTimers() {
  clearTimeout(roundTimer); clearTimeout(spinTimer); clearTimeout(interTimer); clearTimeout(countTimer);
  roundTimer = spinTimer = interTimer = countTimer = null;
}

/* ── Адреса: LAN, туннель или облако ── */
function isPrivateHost(h) {
  const host = String(h || '').split(':')[0].toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host === '::1' || host.endsWith('.local') || host.indexOf('.') === -1) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}
function lanUrls() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of (ifs[name] || [])) {
      if (it.family === 'IPv4' && !it.internal) out.push(`http://${it.address}:${PORT}`);
    }
  }
  return out;
}
const URLS = lanUrls();
function publicUrls() {
  if (PUBLIC_URL) return [PUBLIC_URL];
  if (learnedOrigin) return [learnedOrigin];
  return URLS;
}
function learnOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host || isPrivateHost(host)) return;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'https';
  const origin = proto + '://' + host;
  if (origin !== learnedOrigin) {
    learnedOrigin = origin;
    log(`${C.grn}Публичный адрес стола: ${C.bold}${origin}${C.rst}`);
    bcastState();
  }
}

/* ── Публичные снимки ── */
function pubP(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar, color: p.color, seat: p.seat,
    spectator: p.spectator, dead: p.dead, deadReason: p.deadReason, deathRound: p.deathRound,
    finished: p.finished, finishMs: p.finishMs, mistakes: p.mistakes, pos: p.pos,
    cpm: p.cpm, acc: p.acc, score: p.score, survived: p.survived,
    connected: p.connected, isHost: p.id === hostId,
    locked: p.locked, spinning: !!(spinning && spinning.id === p.id),
  };
}
function publicState() {
  return {
    phase, round, hostId, hardcore, ide, winnerId, stats,
    loaded: bulletsFor(Math.max(1, round)),
    limit: limitSec,
    remainingMs: phase === 'round' ? Math.max(0, endsAt - Date.now()) : 0,
    snippet: (phase === 'countdown' || phase === 'round' || phase === 'timeout') && current
      ? { title: current.title, tier: current.tier, code: current.code } : null,
    spinning: spinning ? { id: spinning.id, reason: spinning.reason, chamber: spinning.chamber, loaded: spinning.loaded, elapsedMs: Date.now() - spinning.startedAt } : null,
    summary: phase === 'summary' && lastSummary ? { rows: lastSummary, nextMs: Math.max(0, interEndsAt - Date.now()), round } : null,
    players: [...players.values()].map(pubP),
  };
}

/* ── WebSocket без зависимостей (RFC 6455) ── */
function frame(op, payload) {
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.from([0x80 | op, len]); }
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
function sendRaw(socket, op, payload) {
  try { if (socket && !socket.destroyed && socket.writable) socket.write(frame(op, payload)); } catch (e) {}
}
function send(conn, obj) { if (conn) sendRaw(conn.socket, 1, Buffer.from(JSON.stringify(obj))); }
function bcast(obj) { const buf = frame(1, Buffer.from(JSON.stringify(obj))); for (const c of conns) { try { if (!c.socket.destroyed && c.socket.writable) c.socket.write(buf); } catch (e) {} } }
function bcastState() { bcast({ t: 'state', state: publicState() }); }
function feed(icon, text, tone) { bcast({ t: 'feed', icon, text, tone: tone || 'info' }); }

function closeConn(conn) {
  try { sendRaw(conn.socket, 8, Buffer.alloc(0)); } catch (e) {}
  try { conn.socket.destroy(); } catch (e) {}
  dropConn(conn);
}
function parseFrames(conn) {
  let b = conn.buf;
  while (true) {
    if (b.length < 2) break;
    const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) break; const big = b.readBigUInt64BE(2); if (big > 1048576n) { conn.buf = b; closeConn(conn); return; } len = Number(big); off = 10; }
    if (len > 1048576 || !masked) { conn.buf = b; closeConn(conn); return; }
    if (b.length < off + 4 + len) break;
    const mask = b.slice(off, off + 4);
    const pay = Buffer.from(b.slice(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) pay[i] ^= mask[i & 3];
    b = b.slice(off + 4 + len);
    if (op === 0x8) { conn.buf = b; closeConn(conn); return; }
    else if (op === 0x9) { sendRaw(conn.socket, 0xA, pay); }
    else if (op === 0xA) { conn.alive = true; }
    else if (op === 0x1 || op === 0x0) {
      if (op === 0x1) conn.frag = [pay]; else conn.frag.push(pay);
      if (fin) {
        const full = Buffer.concat(conn.frag); conn.frag = [];
        try { handle(conn, JSON.parse(full.toString('utf8'))); } catch (e) { log(`${C.red}Ошибка обработки сообщения: ${e.message}${C.rst}`); }
      }
    }
  }
  conn.buf = b;
}
function dropConn(conn) {
  if (!conns.has(conn)) return;
  conns.delete(conn);
  const p = conn.player;
  if (!p || p.conn !== conn) return;
  p.conn = null; p.connected = false;
  clearTimeout(p.dcTimer);
  feed('📡', `${p.name}: связь потеряна… (${GRACE_MS / 1000}с на возвращение)`, 'warn');
  bcastState();
  p.dcTimer = setTimeout(() => {
    if (p.connected) return;
    if (phase === 'lobby') { removePlayer(p, 'вышел'); return; }
    if (phase === 'over') { bcastState(); return; }
    if (!p.spectator && !p.dead) {
      p.dead = true; p.deadReason = 'left'; p.deathRound = round;
      feed('🏳', `${p.name} сбежал из-за стола — засчитано поражение`, 'warn');
      log(`${C.yel}🏳 ${p.name} отключился и выбыл${C.rst}`);
      if (hostId === p.id) reassignHost();
      bcastState();
      if (!checkOver()) {
        if (phase === 'timeout' && !spinning && queue.length === 0) endRound();
        else maybeEndRound();
      }
    } else if (p.spectator) {
      players.delete(p.id);
      bcastState();
    }
  }, GRACE_MS);
}
function reassignHost() {
  const cand = seated().sort((a, b) => (b.connected - a.connected))[0];
  hostId = cand ? cand.id : null;
  if (cand) feed('👑', `${cand.name} теперь хост стола`, 'info');
}
function removePlayer(p, why) {
  clearTimeout(p.dcTimer);
  players.delete(p.id);
  if (hostId === p.id) reassignHost();
  feed('🚪', `${p.name} покинул стол (${why})`, 'info');
  log(`${C.dim}${p.name} покинул стол (${why})${C.rst}`);
  if (players.size === 0) resetToLobby(true);
  else bcastState();
}

/* ── Игровая логика ── */
function resetPlayerForGame(p) {
  p.dead = false; p.deadReason = null; p.deathRound = 0;
  p.finished = false; p.finishMs = 0; p.mistakes = 0; p.pos = 0;
  p.cpm = 0; p.acc = 100; p.score = 0; p.survived = 0;
  p.roundPts = 0; p.roundFate = []; p.locked = false;
}
function resetRoundFields(p) {
  p.finished = false; p.finishMs = 0; p.mistakes = 0; p.pos = 0;
  p.cpm = 0; p.acc = 100; p.roundPts = 0; p.roundFate = []; p.locked = false;
}
function startGame() {
  stats = { shots: 0, clicks: 0 }; used.clear(); round = 0; winnerId = null;
  for (const p of players.values()) if (!p.spectator) resetPlayerForGame(p);
  feed('🎲', 'Игра началась. Печатай или крути барабан.', 'info');
  log(`${C.bold}${C.vio}Игра началась · игроков: ${seated().length}${hardcore ? ' · ХАРДКОР' : ''}${ide ? ' · IDE-скобки' : ''}${C.rst}`);
  startRound();
}
function pickSnippet() {
  const tier = round <= 3 ? 0 : round <= 7 ? 1 : 2;
  let pool = SNIPS.map((s, i) => ({ ...s, i })).filter(s => s.tier === tier && !used.has(s.i));
  if (!pool.length) pool = SNIPS.map((s, i) => ({ ...s, i })).filter(s => s.tier === tier);
  const s = pool[rnd(pool.length)];
  used.add(s.i);
  return s;
}
function startRound() {
  clearGameTimers();
  queue = []; spinning = null;
  round++;
  current = pickSnippet();
  const len = current.code.length;
  const cps = Math.max(2.2, (hardcore ? 3.1 : 3.6) - round * 0.12);
  // +30с к каждому раунду обоих режимов: код печатать тяжелее обычного текста
  limitSec = clamp(Math.ceil(len / cps) + Math.max(3, (hardcore ? 9 : 12) - round) + 30, 55, 150);
  for (const p of alivePlayers()) resetRoundFields(p);
  phase = 'countdown';
  bcast({ t: 'intro', state: publicState() });
  const loaded = bulletsFor(round);
  feed('🎯', `Раунд ${round}: «${current.title}» · ${len} симв · ${limitSec}с · патронов: ${loaded}`, 'info');
  log(`${C.cyn}Раунд ${round} — «${current.title}» (${len} симв, ${limitSec}с, ${loaded} патрон.)${C.rst}`);
  countTimer = setTimeout(() => {
    if (phase !== 'countdown') return;
    phase = 'round'; goTs = Date.now(); endsAt = goTs + limitSec * 1000;
    bcast({ t: 'go', durationMs: limitSec * 1000 });
    roundTimer = setTimeout(onTimeout, limitSec * 1000);
  }, COUNT_MS);
}
function onTimeout() {
  if (phase !== 'round') return;
  phase = 'timeout';
  bcast({ t: 'timeout' });
  feed('⏱', 'Время вышло! Кто не дописал — крутит барабан.', 'warn');
  log(`${C.yel}⏱ Время раунда ${round} истекло${C.rst}`);
  for (const p of alivePlayers()) {
    if (!p.finished && !p.locked && p.connected) enqueueSpin(p, 'time');
  }
  if (!spinning && queue.length === 0) endRound();
}
function enqueueSpin(p, reason) {
  if (!p || p.dead || p.finished || p.locked || p.spectator || !p.connected) return;
  p.locked = true;
  queue.push({ id: p.id, reason });
  bcast({ t: 'queued', id: p.id, reason });
  pump();
}
function pump() {
  if (spinning || phase === 'over' || phase === 'lobby') return;
  while (queue.length) {
    const item = queue.shift();
    const p = players.get(item.id);
    if (!p || p.dead || p.finished || p.spectator || !p.connected) { if (p) p.locked = false; continue; }
    const loaded = bulletsFor(round);
    const chamber = rnd(6);
    const bulletSet = new Set();
    while (bulletSet.size < loaded) bulletSet.add(rnd(6));
    const dead = bulletSet.has(chamber);
    spinning = { id: p.id, reason: item.reason, chamber, loaded, startedAt: Date.now() };
    bcast({ t: 'spin', id: p.id, reason: item.reason, loaded, chamber });
    log(`${C.yel}🎰 ${p.name} крутит барабан (${item.reason === 'errors' ? '3 ошибки' : 'время'}, ${loaded}/6)…${C.rst}`);
    spinTimer = setTimeout(() => resolveSpin(p, dead, chamber, loaded), SPIN_MS);
    return;
  }
  if (phase === 'timeout' && !spinning) endRound();
}
function resolveSpin(p, dead, chamber, loaded) {
  if (phase === 'over') { spinning = null; return; }
  p.mistakes = 0; p.locked = false;
  if (dead) {
    stats.shots++;
    p.dead = true; p.deadReason = 'bang'; p.deathRound = round; p.roundFate.push('bang');
  } else {
    stats.clicks++;
    p.survived++; p.score += 150; p.roundPts += 150; p.roundFate.push('click');
  }
  bcast({ t: 'spinResult', id: p.id, dead, chamber, loaded });
  if (dead) { feed('💥', `БАХ! ${p.name} выбывает — пуля нашла его`, 'danger'); log(`${C.red}💥 БАХ! ${p.name} выбыл (камора ${chamber + 1})${C.rst}`); }
  else { feed('😮‍💨', `Щёлк… осечка! ${p.name} живёт (+150)`, 'success'); log(`${C.grn}😮‍💨 Щёлк — ${p.name} выжил (камора ${chamber + 1})${C.rst}`); }
  spinning = null;
  if (checkOver()) return;
  if (!p.dead && phase === 'timeout' && !p.finished && p.connected) enqueueSpin(p, 'time');
  else maybeEndRound();
  pump();
}
function maybeEndRound() {
  if (phase !== 'round' && phase !== 'timeout') return;
  const act = alivePlayers();
  if (!act.length) return;
  if (act.every(p => p.finished) && !spinning && queue.length === 0) {
    clearTimeout(roundTimer);
    endRound();
  }
}
function endRound() {
  if (phase !== 'round' && phase !== 'timeout') return;
  clearGameTimers();
  phase = 'summary';
  lastSummary = seated().map(p => ({
    id: p.id, name: p.name, avatar: p.avatar, color: p.color,
    dead: p.dead, deadReason: p.deadReason, finished: p.finished, finishMs: p.finishMs,
    cpm: p.cpm, acc: p.acc, pts: p.roundPts, fate: [...p.roundFate], score: p.score, connected: p.connected,
  }));
  interEndsAt = Date.now() + INTER_MS;
  bcast({ t: 'summary', rows: lastSummary, nextMs: INTER_MS, round });
  feed('📋', `Итоги раунда ${round}. Следующий блок через ${INTER_MS / 1000}с`, 'info');
  interTimer = setTimeout(() => { if (phase === 'summary') startRound(); }, INTER_MS);
}
function checkOver() {
  if (phase === 'lobby' || phase === 'over') return false;
  const act = alivePlayers();
  if (act.length <= 1) { gameOver(act[0] || null); return true; }
  return false;
}
function gameOver(w) {
  clearGameTimers();
  queue = []; spinning = null;
  phase = 'over';
  winnerId = w ? w.id : null;
  if (w) w.score += 500;
  const rows = seated().map(p => ({
    id: p.id, name: p.name, avatar: p.avatar, color: p.color, score: p.score,
    dead: p.dead, deadReason: p.deadReason, deathRound: p.deathRound, survived: p.survived,
  })).sort((a, b) => b.score - a.score);
  bcast({ t: 'over', winnerId, round, stats, rows });
  if (w) { feed('🏆', `${w.name} — последний выживший! (+500)`, 'success'); log(`${C.bold}${C.grn}🏆 Победа: ${w.name} · очков ${w.score}${C.rst}`); }
  else { feed('☠️', 'Никто не выжил. Стол пуст.', 'danger'); log(`${C.bold}${C.red}☠️ Никто не выжил${C.rst}`); }
}
function resetToLobby(silent) {
  clearGameTimers();
  phase = 'lobby'; round = 0; current = null; winnerId = null;
  lastSummary = null; queue = []; spinning = null;
  stats = { shots: 0, clicks: 0 }; used.clear();
  for (const p of [...players.values()]) {
    if (!p.connected) { clearTimeout(p.dcTimer); players.delete(p.id); continue; }
    const wasSpect = p.spectator;
    resetPlayerForGame(p);
    if (wasSpect && seated().length < MAX_SEATS) { p.spectator = false; p.seat = freeSeat(); p.color = COLORS[p.seat % COLORS.length]; }
  }
  if (!hostId || !players.has(hostId)) reassignHost();
  if (!silent) feed('🔄', 'Новый набор за столом. Хост запускает игру.', 'info');
  bcastState();
}
function freeSeat() {
  const taken = new Set(seated().map(p => p.seat));
  for (let i = 0; i < MAX_SEATS; i++) if (!taken.has(i)) return i;
  return 0;
}

/* ── Обработка сообщений ── */
function handle(conn, m) {
  if (!m || typeof m.t !== 'string') return;
  const p = conn.player;
  switch (m.t) {
    case 'hello': {
      const token = String(m.token || '').slice(0, 64);
      let found = null;
      if (token) for (const pl of players.values()) if (pl.token === token) { found = pl; break; }
      if (found) {
        if (found.conn && found.conn !== conn) { send(found.conn, { t: 'kicked', reason: 'Сессия открыта в другой вкладке' }); const old = found.conn; old.player = null; closeConn(old); }
        const wasDown = !found.connected;
        found.conn = conn; conn.player = found; found.connected = true;
        clearTimeout(found.dcTimer);
        if (wasDown && phase !== 'lobby') feed('🔌', `${found.name} снова за столом`, 'success');
        send(conn, { t: 'welcome', you: pubP(found), urls: publicUrls(), state: publicState() });
        bcastState();
      } else {
        send(conn, { t: 'welcome', you: null, urls: publicUrls(), state: publicState() });
      }
      break;
    }
    case 'join': {
      if (conn.player) return;
      const name = String(m.name || '').replace(/[\u0000-\u001f<>{}]/g, '').trim().slice(0, 16) || `Игрок ${players.size + 1}`;
      const avatar = AVATARS.includes(m.avatar) ? m.avatar : '👾';
      const token = String(m.token || crypto.randomBytes(16).toString('hex')).slice(0, 64);
      const spect = phase !== 'lobby' || seated().length >= MAX_SEATS;
      const seat = spect ? -1 : freeSeat();
      const pl = {
        id: 'p' + (nextId++), token, name, avatar, seat,
        color: spect ? '#93A1BC' : COLORS[seat % COLORS.length],
        spectator: spect, conn, connected: true, dcTimer: null,
        dead: false, deadReason: null, deathRound: 0, finished: false, finishMs: 0,
        mistakes: 0, pos: 0, cpm: 0, acc: 100, score: 0, survived: 0,
        roundPts: 0, roundFate: [], locked: false,
      };
      conn.player = pl;
      players.set(pl.id, pl);
      if (!spect && !hostId) hostId = pl.id;
      send(conn, { t: 'welcome', you: pubP(pl), urls: publicUrls(), state: publicState() });
      feed(avatar, spect ? `${name} наблюдает со стороны` : `${name} садится за стол (место ${seat + 1})`, 'info');
      log(`${C.grn}+ ${name} ${spect ? '(наблюдатель)' : `· место ${seat + 1}`}${C.rst}`);
      bcastState();
      break;
    }
    case 'leave': {
      if (p && phase === 'lobby') { conn.player = null; removePlayer(p, 'вышел сам'); send(conn, { t: 'welcome', you: null, urls: publicUrls(), state: publicState() }); }
      break;
    }
    case 'kick': {
      if (!p || p.id !== hostId || phase !== 'lobby') return;
      const t = players.get(String(m.id));
      if (t && t.id !== hostId) { send(t.conn, { t: 'kicked', reason: 'Хост убрал тебя со стола' }); const tc = t.conn; if (tc) tc.player = null; removePlayer(t, 'убрал хост'); if (tc) closeConn(tc); }
      break;
    }
    case 'mode': {
      if (p && p.id === hostId && phase === 'lobby') { hardcore = !!m.hardcore; feed(hardcore ? '🔥' : '🎓', hardcore ? 'Режим ХАРДКОР: меньше времени, раньше второй патрон' : 'Обычный режим', hardcore ? 'danger' : 'info'); bcastState(); }
      break;
    }
    case 'ide': {
      if (p && p.id === hostId && phase === 'lobby') {
        ide = !!m.on;
        feed(ide ? '⌨️' : '🧱', ide ? 'IDE-скобки включены: ( ) [ ] { } " " закрываются сами' : 'IDE-скобки выключены: всё печатаем руками', ide ? 'success' : 'warn');
        bcastState();
      }
      break;
    }
    case 'start': {
      if (p && p.id === hostId && phase === 'lobby' && seated().length >= 1) startGame();
      break;
    }
    case 'progress': {
      if (!p || phase !== 'round' || p.spectator || p.dead || p.finished || p.locked || !current) return;
      p.pos = clamp(Math.round(Number(m.pos) || 0), 0, current.code.length);
      p.cpm = clamp(Math.round(Number(m.cpm) || 0), 0, 1500);
      p.acc = clamp(Math.round(Number(m.acc) || 0), 0, 100);
      bcast({ t: 'prog', id: p.id, pos: p.pos, cpm: p.cpm, acc: p.acc });
      break;
    }
    case 'miss': {
      if (!p || phase !== 'round' || p.spectator || p.dead || p.finished || p.locked) return;
      p.mistakes++;
      bcast({ t: 'miss', id: p.id, mistakes: p.mistakes });
      if (p.mistakes >= 3) enqueueSpin(p, 'errors');
      break;
    }
    case 'finish': {
      if (!p || phase !== 'round' || p.spectator || p.dead || p.finished || p.locked || !current) return;
      const elapsed = Date.now() - goTs;
      if (elapsed < current.code.length / 22 * 1000) return; // быстрее 22 зн/с — не человек
      p.finished = true; p.finishMs = elapsed; p.pos = current.code.length;
      p.acc = clamp(Math.round(Number(m.acc) || 100), 0, 100);
      p.cpm = clamp(Math.round(Number(m.cpm) || 0), 0, 1500);
      const order = seated().filter(x => x.finished).length;
      const bonus = [150, 100, 60, 40, 20, 10][order - 1] || 0;
      const pts = 100 + Math.max(0, Math.round((limitSec * 1000 - elapsed) / 1000 * 3)) + p.acc + bonus;
      p.score += pts; p.roundPts += pts; p.roundFate.push('finish');
      bcast({ t: 'finish', id: p.id, ms: elapsed, cpm: p.cpm, acc: p.acc, pts });
      feed('✅', `${p.name} дописал за ${(elapsed / 1000).toFixed(1)}с (+${pts})`, 'success');
      log(`${C.grn}✓ ${p.name} финиш ${(elapsed / 1000).toFixed(1)}с · ${p.cpm} зн/мин · +${pts}${C.rst}`);
      maybeEndRound();
      break;
    }
    case 'next': {
      if (p && p.id === hostId && phase === 'summary') { clearTimeout(interTimer); startRound(); }
      break;
    }
    case 'restart': {
      if (p && p.id === hostId && phase === 'over') resetToLobby(false);
      break;
    }
  }
}

/* ── HTTP + Upgrade ── */
let INDEX = '';
try { INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); }
catch (e) {
  console.error(`${C.red}${C.bold}Не найден index.html рядом с server.js!${C.rst}\nПоложи оба файла в одну папку и запусти снова.`);
  process.exit(1);
}
const server = http.createServer((req, res) => {
  learnOrigin(req);
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(INDEX);
  } else if (url === '/favicon.ico') { res.writeHead(204); res.end(); }
  else if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); }
  else { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 — здесь только стол с рулеткой'); }
});
server.on('upgrade', (req, socket) => {
  learnOrigin(req);
  if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true); socket.setTimeout(0);
  const conn = { socket, buf: Buffer.alloc(0), frag: [], player: null, alive: true };
  conns.add(conn);
  socket.on('data', d => { conn.buf = Buffer.concat([conn.buf, d]); parseFrames(conn); });
  socket.on('close', () => dropConn(conn));
  socket.on('error', () => dropConn(conn));
});
/* пинг каждые 25с — заодно не даёт прокси/туннелю закрыть простаивающий WebSocket */
setInterval(() => {
  for (const c of conns) {
    if (!c.alive) { closeConn(c); continue; }
    c.alive = false;
    sendRaw(c.socket, 0x9, Buffer.alloc(0));
  }
}, 25000);
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`${C.red}Порт ${PORT} занят. Запусти: PORT=${PORT + 1} node server.js${C.rst}`);
    process.exit(1);
  }
  console.error(e); process.exit(1);
});
server.listen(PORT, () => {
  console.log('');
  console.log(`${C.vio}${C.bold}  ╔══════════════════════════════════════════════╗${C.rst}`);
  console.log(`${C.vio}${C.bold}  ║   КОД-РУЛЕТКА · C# на скорость и выживание   ║${C.rst}`);
  console.log(`${C.vio}${C.bold}  ╚══════════════════════════════════════════════╝${C.rst}`);
  console.log(`  ${C.dim}Локально:${C.rst}        ${C.cyn}http://localhost:${PORT}${C.rst}`);
  if (PUBLIC_URL) console.log(`  ${C.dim}Публичный адрес:${C.rst} ${C.yel}${C.bold}${PUBLIC_URL}${C.rst}`);
  else for (const u of URLS) console.log(`  ${C.dim}В локальной сети:${C.rst} ${C.yel}${u}${C.rst}`);
  if (!PUBLIC_URL) {
    console.log(`  ${C.dim}Университетская сеть? Выстави наружу:${C.rst}`);
    console.log(`  ${C.cyn}cloudflared tunnel --url http://localhost:${PORT}${C.rst} ${C.dim}→ получишь https-ссылку${C.rst}`);
  }
  console.log(`  ${C.dim}2–6 игроков (соло тоже работает). IDE-скобки: ВКЛ. Остановить: Ctrl+C${C.rst}`);
  console.log('');
});
process.on('SIGINT', () => { console.log(`\n${C.vio}Стол закрыт. До связи!${C.rst}`); process.exit(0); });