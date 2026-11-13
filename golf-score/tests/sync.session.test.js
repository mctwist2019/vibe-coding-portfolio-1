/*
 * 세션(전송 계층)을 브로커 없이 시험한다: 메모리 안의 가짜 브로커(retained 보관 + 구독자에게 전달)에 createSession을 붙인다.
 * 실제 브로커가 필요한 시험은 sync.transport.test.js에 있다.
 *
 * 여기서 보는 것: 세션이 시작됐을 때 서버에 남아 있는 스냅샷이 '이 기기가 올린 것'인 경우.
 * 그 스냅샷이 지금의 라운드보다 옛것이면(공유를 멈춘 동안 넣은 값, 연결이 끊긴 채 넣고 앱을 닫은 값) 한 번 다시 올려야 한다.
 * 그러지 않으면 누군가 다음 값을 넣을 때까지 다른 기기가 그 값을 받지 못한다.
 * 견주는 것은 세션마다 한 번, 서버에 남아 있던(retained) 스냅샷에만 한다: 다시 연결될 때나 실시간으로 지나가는 내 스냅샷에는 반응하지 않는다.
 *
 * 그리고 호스트의 공유 종료가 서버에 남기는 '종료' 표시(라운드 자료 없음): 그때 방에 없던 기기가 돌아와서 제 사본을 다시 올리지 않는다.
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
const session = (B, code, id, ref, extra) => S.createSession(Object.assign({
  mqtt: B.mqtt, code, clientId: id, name: id, broker: 'ws://localhost:1/mqtt', getRound: () => ref.round,
  onError: (e) => { ref.errors = (ref.errors || []).concat(String((e && e.message) || e)); }
}, extra || {}));
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
  ownOlderNoRid: run(async (B, code, A) => { const room = await store(B, code, 'devA', A.round, (m) => { delete m.rid; }); edit(A.round); return { room }; }),
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
  // 유예가 끝나 먼저 한 번 올리고(서버가 비어 있는 줄 알고), 늦게 온 내 옛 스냅샷을 보고 한 번 더 올린다: 이미 연결을 마친 뒤에 온 것도 견준다.
  // 두 번이고 그 뒤로는 조용하다
  assert.equal(kinds(c.first), 'snap devA | snap devA');
  assert.ok(c.first.every((m) => m.keys.name.v === 'X-H'));
  assert.equal(c.later, 0);
  assert.equal(c.stored.keys.name.v, 'X-H');
});

test('own stored snapshot older than the round and without a round id (an older build stored it): the session sends the round once', { timeout: TIMEOUT }, async () => {
  const c = await CASES.ownOlderNoRid;
  assert.equal(kinds(c.first), 'snap devA');
  assert.equal(c.first[0].keys.name.v, 'X-H');
  assert.equal(c.later, 0);
});

// ───────── 세션이 이어지는 동안: 다시 연결될 때와 실시간으로 지나가는 내 스냅샷 ─────────
/** 방의 자료 메시지 가운데 주어진 연결(mqtt clientId 앞부분)이 보낸 것만, 종류를 이어서 */
async function sentBy(B, room, from, prefix) {
  const out = [];
  for (const e of B.log.slice(from)) {
    if (e.t !== room.topic + '/s' && e.t !== room.topic + '/q') continue;
    if (prefix && String(e.by).indexOf(prefix) !== 0) continue;
    out.push(e.text ? (await S.open(room.key, e.text)).t : 'empty');
  }
  return out.join(' ');
}
const LONG = 3200; // 유예 2초 + 여유: 다시 올릴 것이 있으면 이 안에 나간다
const MORE = {
  // 공유를 멈춘 동안 넣은 값은 세션을 시작할 때 한 번 나간다. 그 뒤 같은 세션이 다시 연결됐을 때 서버에 있는 '내' 스냅샷이
  // 또 옛것이어도(같은 접속 id를 쓰는 이 기기의 다른 화면이 올린 것) 다시 올리지 않는다
  reconnect: (async () => {
    const code = S.randomCode(), B = broker(), ck = S.createClock(), A = { round: mkRound(code, 'devA') }, before = clone(A.round);
    const room = await store(B, code, 'devA', before);
    A.round.scores.p1[0] = 5; S.stamp(A.round, ['score:p1:0'], ck, 'devA');
    const sA = session(B, code, 'devA', A, { clock: ck }), out = {};
    try {
      await sA.start(); await wait(LONG);
      out.start = await sentBy(B, room, 0);
      const other = clone(before); other.scores.p2[0] = 9; S.stamp(other, ['score:p2:0'], ck, 'devA');
      await store(B, code, 'devA', other);
      let mark = B.log.length;
      sA.wake(); await wait(LONG);
      out.afterWake = await sentBy(B, room, mark);
      out.mergedBack = A.round.scores.p2[0];
      mark = B.log.length;
      A.round.scores.p1[1] = 6; S.stamp(A.round, ['score:p1:1'], ck, 'devA'); sA.markDirty(['score:p1:1']);
      await wait(2800);
      out.afterEdit = await sentBy(B, room, mark);
    } finally { sA.stop(); }
    out.errors = A.errors;
    return out;
  })(),
  // 연결이 끊긴 사이에 넣은 값은 세션이 알고 있으므로(dirty) 다시 연결되면 스냅샷으로 나간다
  wakeDirty: (async () => {
    const code = S.randomCode(), B = broker(), ck = S.createClock(), A = { round: mkRound(code, 'devA') };
    const room = await store(B, code, 'devA', A.round);
    const sA = session(B, code, 'devA', A, { clock: ck }), out = {};
    try {
      await sA.start(); await wait(2600);
      out.start = await sentBy(B, room, 0);
      A.round.scores.p1[2] = 7; S.stamp(A.round, ['score:p1:2'], ck, 'devA');
      sA.wake();                       // 연결을 바꾸는 중: 이 순간에는 연결돼 있지 않다
      sA.markDirty(['score:p1:2']);
      await wait(LONG + 2200);
      out.stored = await S.open(room.key, B.retained.get(room.topic + '/s'));
    } finally { sA.stop(); }
    return out;
  })(),
  // 내 옛 스냅샷이 실시간으로(보관본이 아니라) 지나가도 다시 올리지 않는다. 서버의 스냅샷은 다른 기기가 올린 것이고 라운드와 같아서,
  // 이 세션은 아직 내 스냅샷과 견줘 본 적이 없다 (견줘 본 뒤라서 조용한 것이 아니다)
  ownLive: (async () => {
    const code = S.randomCode(), B = broker(), A = { round: mkRound(code, 'devA') }, old = clone(A.round);
    edit(A.round);
    const room = await store(B, code, 'devB', A.round);
    const sA = session(B, code, 'devA', A), out = {};
    try {
      await sA.start(); await wait(2600);
      const raw = B.mqtt.connect({ clientId: 'raw' }); await wait(20);
      const stale = await S.seal(room.key, { t: 'snap', rid: old.id, from: 'devA', keys: S.exportKeys(old) });
      for (let i = 0; i < 3; i++) raw.publish(room.topic + '/s', stale, { qos: 1, retain: false });
      await wait(LONG + 2200);
      out.sent = await sentBy(B, room, 0, 'gsdevA');
      out.name = A.round.name;
    } finally { sA.stop(); }
    return out;
  })(),
  // 공유 종료: 서버에는 라운드 자료가 없는 '종료' 표시만 남는다. 그때 방에 없던 기기가 사본을 들고 돌아오면 알림을 한 번 받고 아무것도 올리지 않는다.
  // 라운드 없이 참여하려는 기기도 알림만 받는다. 종료한 호스트 자신은 같은 코드로 다시 열 수 있다
  closedMarker: (async () => {
    const code = S.randomCode(), B = broker(), room = await S.deriveRoom(code), out = {};
    const H = { round: mkRound(code, 'devH') }, sh = session(B, code, 'devH', H);
    await sh.start(); await wait(2600);
    out.before = (await S.open(room.key, B.retained.get(room.topic + '/s'))).t;
    out.cleared = await sh.clearRetained(); sh.stop(); await wait(50);
    out.marker = await S.open(room.key, B.retained.get(room.topic + '/s'));
    out.presenceLeft = B.retained.has(room.topic + '/p/devH');
    const guest = async () => {
      const mark = B.log.length, A = { round: clone(H.round) }; let closed = 0;
      A.round.scores.p1[0] = 5; S.stamp(A.round, ['score:p1:0'], S.createClock(), 'devA');
      const sa = session(B, code, 'devA', A, { onClosed: () => { closed++; } });
      await sa.start(); await wait(LONG); sa.stop();
      return { closed, sent: await sentBy(B, room, mark), stored: (await S.open(room.key, B.retained.get(room.topic + '/s'))).t, errors: A.errors };
    };
    const fresh = async () => {
      const mark = B.log.length, N = { round: null }; let closed = 0, adopted = 0;
      const sn = session(B, code, 'devN', N, { onClosed: () => { closed++; }, onSnapshot: () => { adopted++; } });
      await sn.start(); await wait(LONG); sn.stop();
      return { closed, adopted, sent: await sentBy(B, room, mark) };
    };
    out.guest = await guest();
    out.fresh = await fresh();
    const mark = B.log.length; let closed = 0;
    const sh2 = session(B, code, 'devH', H, { onClosed: () => { closed++; } });
    await sh2.start(); await wait(LONG); sh2.stop();
    out.host = { closed, sent: await sentBy(B, room, mark), stored: (await S.open(room.key, B.retained.get(room.topic + '/s'))).t };
    return out;
  })(),
  // 살아 있는 방에서 '종료' 표시가 실시간으로 지나가는 경우(그때 방에 있던 기기): 세션은 알리지 않는다. 그 기기는 종료 직전의 스냅샷으로 안다
  closedLive: (async () => {
    const code = S.randomCode(), B = broker(), room = await S.deriveRoom(code), P = { round: mkRound(code, 'devH') }; let closed = 0;
    const sp = session(B, code, 'devA', P, { onClosed: () => { closed++; } });
    try {
      await sp.start(); await wait(2600);
      const raw = B.mqtt.connect({ clientId: 'raw' }); await wait(20);
      raw.publish(room.topic + '/s', await S.seal(room.key, { t: 'closed', from: 'devH' }), { qos: 1, retain: false });
      await wait(300);
    } finally { sp.stop(); }
    return { closed, errors: P.errors };
  })()
};
const LONGER = 20000;

test('the own stored snapshot is compared once per session: a reconnect does not send again, later edits still go out', { timeout: LONGER }, async () => {
  const c = await MORE.reconnect;
  assert.equal(c.start, 'snap', 'session start: the value entered while out is sent once');
  assert.equal(c.afterWake, '', 'reconnect within the same session: nothing is sent');
  assert.equal(c.mergedBack, null, 'own messages are still never merged back');
  assert.equal(c.afterEdit, 'op snap', 'an edit after the reconnect goes out as before');
  assert.equal(c.errors, undefined);
});

test('a value entered while the connection is down is sent after the session reconnects', { timeout: LONGER }, async () => {
  const c = await MORE.wakeDirty;
  assert.equal(c.start, '', 'nothing changed: nothing sent');
  assert.equal(c.stored.keys['score:p1:2'].v, 7, 'the value reaches the server in a snapshot over the new connection');
});

test('an own snapshot passing by live (not the stored one) never triggers a resend', { timeout: LONGER }, async () => {
  const c = await MORE.ownLive;
  assert.equal(c.sent, '');
  assert.equal(c.name, 'X-H', 'and it is not merged back');
});

test('ending the share leaves a marker without round data; a returning phone is told once and sends nothing; the host can reopen the room', { timeout: LONGER }, async () => {
  const c = await MORE.closedMarker;
  assert.equal(c.before, 'snap');
  assert.equal(c.cleared, true);
  assert.deepEqual(c.marker, { t: 'closed', from: 'devH' }, 'no round data is left on the server');
  assert.equal(c.presenceLeft, false);
  assert.deepEqual(c.guest, { closed: 1, sent: '', stored: 'closed', errors: undefined }, 'a phone that was out when the share ended');
  assert.deepEqual(c.fresh, { closed: 1, adopted: 0, sent: 'hello' }, 'a phone joining without a round: told, nothing adopted');
  assert.deepEqual(c.host, { closed: 0, sent: 'snap', stored: 'snap' }, 'the host that ended it reconnects with the same code: the room is open again');
});

test('a marker passing by live is not reported by the session', { timeout: LONGER }, async () => {
  const c = await MORE.closedLive;
  assert.deepEqual(c, { closed: 0, errors: undefined });
});
