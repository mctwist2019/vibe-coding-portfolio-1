/*
 * 세션(전송 계층)을 브로커 없이 시험한다: 메모리 안의 가짜 브로커(retained 보관 + 구독자에게 전달)에 createSession을 붙인다.
 * 실제 브로커가 필요한 시험은 sync.transport.test.js에 있다.
 *
 * 여기서 보는 것: 세션이 시작됐을 때 서버에 남아 있는 스냅샷이 '이 기기가 올린 것'인 경우.
 * 그 스냅샷이 지금의 라운드보다 옛것이면(공유를 멈춘 동안 넣은 값, 연결이 끊긴 채 넣고 앱을 닫은 값) 한 번 다시 올려야 한다.
 * 그러지 않으면 누군가 다음 값을 넣을 때까지 다른 기기가 그 값을 받지 못한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const G = require('../games.js');
const S = require('../sync.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

/** 가짜 브로커. retainDelay: 구독한 뒤 retained 메시지가 도착할 때까지의 시간(느린 연결) */
function broker(retainDelay) {
  const retained = new Map(), clients = new Set(), log = [];
  const mqtt = {
    connect(opts) {
      const c = new EventEmitter();
      c.options = opts; c.connected = false; c.subs = [];
      c.subscribe = (pattern, o, cb) => {
        const pre = pattern.replace(/\/#$/, '');
        c.subs.push(pre);
        // 실제 브로커처럼 구독한 순간에 보관돼 있던 것을 보낸다
        const stored = [...retained].filter(([t]) => t.startsWith(pre));
        setTimeout(() => { if (cb) cb(null); }, 5);
        setTimeout(() => { if (c.connected) stored.forEach(([t, p]) => c.emit('message', t, p, { retain: true })); }, 5 + (retainDelay || 0));
      };
      c.publish = (t, payload, o, cb) => {
        const s = String(payload);
        log.push({ t, by: opts.clientId, retain: !!(o && o.retain), text: s });
        if (o && o.retain) { if (s) retained.set(t, s); else retained.delete(t); }
        setTimeout(() => {
          for (const x of clients) if (x.connected && x.subs.some((pre) => t.startsWith(pre))) x.emit('message', t, s, { retain: false });
          if (cb) cb(null);
        }, 2);
      };
      c.end = (force, o, cb) => { c.connected = false; clients.delete(c); const f = typeof o === 'function' ? o : cb; if (f) f(); c.emit('close'); };
      c.reconnect = () => {};
      clients.add(c);
      setTimeout(() => { c.connected = true; c.emit('connect'); }, 5);
      return c;
    }
  };
  return { mqtt, retained, log };
}

function mkRound(code, by) {
  const r = {
    id: 'round-' + code, holes: 9, date: '2026-11-13', createdAt: Date.now() - 60000, name: 'X',
    pars: G.defaultPars(9), strokeIndex: G.defaultStrokeIndex(9),
    players: [{ id: 'p1', name: '가', hcp: 0, team: '' }, { id: 'p2', name: '나', hcp: 0, team: '' }],
    scores: { p1: new Array(9).fill(null), p2: new Array(9).fill(null) }, extras: {},
    games: { stroke: { enabled: true, net: false, unit: 0, cap: false, from: 1 }, skins: { enabled: true, net: false, mode: 'individual', unit: 1000, join: 80000 } },
    status: 'live', rev: {}, currentHole: 0, share: { code, host: by, active: true }
  };
  S.stampAll(r, r.createdAt, by);
  return r;
}
/** 서버에 스냅샷을 남겨 둔다 (from이 올린 것으로) */
async function store(B, code, from, r, patch) {
  const room = await S.deriveRoom(code), msg = { t: 'snap', rid: r.id, from, keys: S.exportKeys(r) };
  if (patch) patch(msg);
  B.retained.set(room.topic + '/s', await S.seal(room.key, msg));
  return room;
}
const session = (B, code, id, ref) => S.createSession({
  mqtt: B.mqtt, code, clientId: id, name: id, broker: 'ws://localhost:1/mqtt', getRound: () => ref.round,
  onError: (e) => { ref.errors = (ref.errors || []).concat(String((e && e.message) || e)); }
});
/** 방에 오간 자료 메시지(스냅샷 · 변경 · 요청)를 풀어서 */
async function dataOf(B, room, from) {
  const out = [];
  for (const e of B.log.slice(from || 0)) {
    if (e.t !== room.topic + '/s' && e.t !== room.topic + '/q') continue;
    if (!e.text) { out.push({ t: 'empty' }); continue; }
    const m = await S.open(room.key, e.text);
    out.push({ t: m.t, from: m.from, keys: m.keys || {} });
  }
  return out;
}
// 이 기기(devA)가 공유를 멈춘 동안 넣은 것: 라운드 이름과 1번홀 점수 둘
const clock = S.createClock();
const edit = (r) => { r.scores.p1[0] = 5; r.scores.p2[0] = 6; r.name = 'X-H'; S.stamp(r, ['score:p1:0', 'score:p2:0', 'name'], clock, 'devA'); };

/**
 * 한 경우: setup이 서버의 스냅샷과 기기의 라운드를 차려 놓으면 devA의 세션을 시작하고,
 * 처음 FIRST ms 동안 방에 나간 자료 메시지와 그 뒤 QUIET ms 동안 더 나간 수를 돌려준다
 */
const FIRST = 5500, QUIET = 3000; // 유예 2초 + 스냅샷 지연 2초(늦게 온 경우) + 여유
async function run(setup, retainDelay) {
  const code = S.randomCode(), B = broker(retainDelay), A = { round: mkRound(code, 'devA') };
  const ctx = await setup(B, code, A);
  const others = (ctx.others || []).map((ref, i) => ({ ref, s: session(B, code, 'dev' + 'BCD'[i], ref) }));
  for (const o of others) await o.s.start();
  await wait(300);
  const mark = B.log.length;
  const sA = session(B, code, 'devA', A);
  await sA.start();
  await wait(FIRST);
  const first = await dataOf(B, ctx.room, mark), n = B.log.length;
  await wait(QUIET);
  const later = (await dataOf(B, ctx.room, n)).length;
  const stored = await S.open(ctx.room.key, B.retained.get(ctx.room.topic + '/s'));
  sA.stop(); others.forEach((o) => o.s.stop());
  return { first, later, stored, A, others: others.map((o) => o.ref) };
}

// 경우들을 한꺼번에 돌려 두고(각자 자기 브로커) 시험마다 결과를 받아 본다: 기다리는 시간이 한 번으로 끝난다
const CASES = {
  ownOlder: run(async (B, code, A) => { const room = await store(B, code, 'devA', A.round); edit(A.round); return { room }; }),
  ownOlderPeer: run(async (B, code, A) => { const old = clone(A.round); const room = await store(B, code, 'devA', A.round); edit(A.round); return { room, others: [{ round: old }] }; }),
  ownEqual: run(async (B, code, A) => ({ room: await store(B, code, 'devA', A.round) })),
  ownNewer: run(async (B, code, A) => { const ahead = clone(A.round); edit(ahead); return { room: await store(B, code, 'devA', ahead) }; }),
  noRevision: run(async (B, code, A) => {
    delete A.round.rev['gm:skins:join']; A.round.games.skins.join = 0;
    return { room: await store(B, code, 'devA', A.round, (m) => { delete m.keys['gm:skins:join']; }) };
  }),
  otherRound: run(async (B, code, A) => { const room = await store(B, code, 'devA', A.round, (m) => { m.rid = 'round-other'; }); edit(A.round); return { room }; }),
  othersOlder: run(async (B, code, A) => { const room = await store(B, code, 'devB', A.round); edit(A.round); return { room }; }),
  ownOlderLate: run(async (B, code, A) => { const room = await store(B, code, 'devA', A.round); edit(A.round); return { room }; }, 2600)
};
const TIMEOUT = FIRST + QUIET + 8000;
const kinds = (list) => list.map((m) => m.t + ' ' + m.from).join(' | ');

test('hasNewerThan: a key changed after the snapshot or missing from it counts; a key without a revision does not', () => {
  const r = mkRound('ABCDEF', 'devA'), snap = S.exportKeys(r);
  assert.equal(S.hasNewerThan(r, snap), false, 'the same state');
  const later = clone(r); edit(later);
  assert.equal(S.hasNewerThan(later, snap), true, 'the round was edited after the snapshot');
  assert.equal(S.hasNewerThan(r, S.exportKeys(later)), false, 'the snapshot is ahead of the round');
  // 같은 시각이면 by가 큰 쪽이 새것 (merge와 같은 규칙)
  const tie = clone(r); tie.name = 'T'; tie.rev.name = { ts: snap.name.ts, by: 'devZ' };
  assert.equal(S.hasNewerThan(tie, snap), true);
  assert.equal(S.hasNewerThan(r, S.exportKeys(tie)), false);
  // 스냅샷에 없는 키: 수정 기록이 있으면 새것, 없으면(빈칸만 채워진 값) 아니다
  const missing = clone(snap); delete missing['gm:skins:join'];
  assert.equal(S.hasNewerThan(r, missing), true);
  const bare = clone(r); delete bare.rev['gm:skins:join'];
  assert.equal(S.hasNewerThan(bare, missing), false);
  // 스냅샷에만 있는 키와 meta는 세지 않는다. 망가진 항목은 '없는 것'으로 본다
  const extra = clone(snap); extra['score:p9:0'] = { v: 4, ts: Date.now(), by: 'devB' }; extra.meta = { v: {}, ts: 1, by: '' };
  assert.equal(S.hasNewerThan(r, extra), false);
  const broken = clone(snap); broken.name = null;
  assert.equal(S.hasNewerThan(r, broken), true);
  assert.equal(S.hasNewerThan(r, null), true);
  assert.equal(S.hasNewerThan(r, {}), true);
});

test('own stored snapshot older than the round: the session sends the round once, then stays quiet', { timeout: TIMEOUT }, async () => {
  const c = await CASES.ownOlder;
  assert.equal(kinds(c.first), 'snap devA');
  assert.equal(c.first[0].keys.name.v, 'X-H');
  assert.equal(c.first[0].keys['score:p1:0'].v, 5);
  assert.equal(c.first[0].keys['score:p2:0'].v, 6);
  assert.equal(c.later, 0, 'nothing more while nobody edits');
  assert.equal(c.stored.keys.name.v, 'X-H', 'the stored snapshot is the new one');
  assert.equal(c.A.errors, undefined);
});

test('own stored snapshot older than the round, another phone is in the room: it receives what was entered while the share was off', { timeout: TIMEOUT }, async () => {
  const c = await CASES.ownOlderPeer, peer = c.others[0].round;
  assert.equal(kinds(c.first), 'snap devA', 'one snapshot from the returning phone; the other phone has nothing to add');
  assert.equal(peer.name, 'X-H');
  assert.deepEqual([peer.scores.p1[0], peer.scores.p2[0]], [5, 6]);
  assert.deepEqual(S.exportKeys(peer), S.exportKeys(c.A.round), 'both phones hold the same values and revisions');
  assert.equal(c.later, 0);
});

test('own stored snapshot equal to the round: nothing is sent', { timeout: TIMEOUT }, async () => {
  const c = await CASES.ownEqual;
  assert.equal(kinds(c.first), '');
  assert.equal(c.later, 0);
});

test('own stored snapshot ahead of the round: nothing is sent and the round is left as it is', { timeout: TIMEOUT }, async () => {
  const c = await CASES.ownNewer;
  assert.equal(kinds(c.first), '');
  assert.equal(c.later, 0);
  assert.equal(c.A.round.name, 'X', 'own messages are never merged back');
  assert.equal(c.stored.keys.name.v, 'X-H', 'the stored snapshot is not overwritten with the older state');
});

test('own stored snapshot lacks a setting that has no revision on the device (filled in by an update): nothing is sent', { timeout: TIMEOUT }, async () => {
  const c = await CASES.noRevision;
  assert.equal(kinds(c.first), '');
  assert.equal(c.later, 0);
});

test('own stored snapshot of another round under the same code: nothing is sent', { timeout: TIMEOUT }, async () => {
  const c = await CASES.otherRound;
  assert.equal(kinds(c.first), '');
  assert.equal(c.later, 0);
  assert.equal(c.stored.rid, 'round-other');
});

test("another phone's stored snapshot older than the round: the session sends the round (the rule that was already there)", { timeout: TIMEOUT }, async () => {
  const c = await CASES.othersOlder;
  assert.equal(kinds(c.first), 'snap devA');
  assert.equal(c.first[0].keys.name.v, 'X-H');
  assert.equal(c.later, 0);
});

test('own stored snapshot older than the round and arriving late (after the grace period): the new values still go out and it settles', { timeout: TIMEOUT }, async () => {
  const c = await CASES.ownOlderLate;
  // 유예가 끝나 먼저 한 번 올리고, 늦게 온 내 옛 스냅샷을 보고 한 번 더 올릴 수 있다: 한두 번이고 그 뒤로는 조용하다
  assert.ok(c.first.length >= 1 && c.first.length <= 2, 'one or two snapshots: ' + kinds(c.first));
  assert.ok(c.first.every((m) => m.t === 'snap' && m.from === 'devA' && m.keys.name.v === 'X-H'));
  assert.equal(c.later, 0);
  assert.equal(c.stored.keys.name.v, 'X-H');
});
