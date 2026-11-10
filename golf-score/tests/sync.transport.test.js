/*
 * 전송 계층 통합 테스트 — 실제 MQTT 브로커(WebSocket)가 필요합니다.
 *   MQTT_URL=ws://localhost:1884/mqtt node --test tests/sync.transport.test.js
 * mqtt 패키지가 없거나 MQTT_URL이 없으면 건너뜁니다. (예: npx -p mqtt -p aedes ... 또는 NODE_PATH로 지정)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../games.js');
const S = require('../sync.js');

let mqtt = null;
try { mqtt = require('mqtt'); } catch (e) { mqtt = null; }
const URL = process.env.MQTT_URL;
const skip = !mqtt || !URL;

const defaults = {
  pars: G.defaultPars, strokeIndex: G.defaultStrokeIndex,
  games: () => ({
    stroke: { enabled: true, net: false, unit: 0 }, stableford: { enabled: true, net: true },
    skins: { enabled: false, net: false, mode: 'individual', unit: 1000 }, match: { enabled: false, net: false, mode: 'individual', unit: 1000 },
    nassau: { enabled: false, net: false, mode: 'individual', unit: 5000 }, bestball: { enabled: false, net: false, count: 1, unit: 1000 },
    vegas: { enabled: false, net: false, unit: 100 }, bonus: { nearest: false, longest: false, birdie: false, unit: 1000 }
  })
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function until(fn, ms, what) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      if (fn()) return resolve();
      if (Date.now() - start > ms) return reject(new Error('timeout waiting for ' + what));
      setTimeout(poll, 50);
    })();
  });
}
function hostRound(code) {
  const r = {
    id: 'round-' + code, holes: 9, date: '2026-11-09', createdAt: Date.now(), name: '통합테스트',
    pars: G.defaultPars(9), strokeIndex: G.defaultStrokeIndex(9),
    players: [{ id: 'p1', name: '철수', hcp: 0, team: 'A' }, { id: 'p2', name: '영희', hcp: 0, team: 'B' }],
    scores: { p1: new Array(9).fill(null), p2: new Array(9).fill(null) }, extras: {}, games: defaults.games(),
    status: 'live', rev: {}, currentHole: 0, share: { code, host: 'host' }
  };
  S.stampAll(r, r.createdAt, 'host');
  return r;
}

function mkSession(sessions, clientId, ref, extra) {
  const s = S.createSession(Object.assign({
    mqtt, code: ref.code, clientId, name: clientId, broker: URL,
    getRound: () => ref.round,
    onApply: (keys) => { ref.applied = (ref.applied || []).concat(keys); },
    onStatus: (st) => { ref.status = st; },
    onReady: () => { ref.ready = true; },
    onError: (e) => { ref.errors = (ref.errors || []).concat([e && e.message]); }
  }, extra || {}));
  sessions.push(s);
  return s;
}

test('host → late guest snapshot, bidirectional ops, offline replica convergence, presence', { skip, timeout: 40000 }, async () => {
  const code = S.randomCode();
  const sessions = [];
  try {
    const H = { code, round: hostRound(code) };
    const host = mkSession(sessions, 'host', H);
    await host.start();
    await until(() => H.status === 'connected', 8000, 'host connect');
    await until(() => H.ready === true, 6000, 'host first snapshot published');

    const Gr = { code, round: null };
    const guest = mkSession(sessions, 'guest', Gr, { onSnapshot: (keys) => { Gr.round = S.roundFromSnapshot(keys, defaults); } });
    await guest.start();
    await until(() => Gr.round !== null, 8000, 'guest adopt snapshot');
    assert.equal(Gr.round.id, H.round.id);
    assert.equal(Gr.round.players.length, 2);
    assert.equal(Gr.round.players[0].name, '철수');

    // 호스트 → 게스트 (명시적 touch 경로)
    H.round.scores.p1[0] = 4; host.touch(['score:p1:0']);
    await until(() => Gr.round.scores.p1[0] === 4, 5000, 'guest receives op');

    // 게스트 → 호스트 (diff 경로: 앱은 save() 시 diffAndStamp + markDirty)
    const base = S.project(Gr.round);
    Gr.round.scores.p2[0] = 5; Gr.round.extras[0] = { nearest: 'p2' }; Gr.round.players[1].hcp = 7;
    const d = S.diffAndStamp(Gr.round, base, guest.clock, 'guest');
    guest.markDirty(d.changed);
    await until(() => H.round.scores.p2[0] === 5 && H.round.extras[0] && H.round.extras[0].nearest === 'p2' && H.round.players[1].hcp === 7, 5000, 'host receives guest ops');

    // 오프라인에서 편집한 복제본이 늦게 접속 → 스냅샷 병합으로 모두 수렴
    const stale = S.roundFromSnapshot(S.exportKeys(H.round), defaults);
    stale.scores.p1[3] = 3; S.stamp(stale, ['score:p1:3'], S.createClock(() => Date.now() + 1000), 'offline');
    stale.pars[3] = 3; S.stamp(stale, ['par:3'], S.createClock(() => Date.now() + 1000), 'offline');
    await wait(2500);
    const O = { code, round: stale };
    const off = mkSession(sessions, 'offline', O);
    await off.start();
    await until(() => H.round.scores.p1[3] === 3 && H.round.pars[3] === 3, 10000, 'host gets offline edits');
    await until(() => Gr.round.scores.p1[3] === 3 && Gr.round.pars[3] === 3, 10000, 'guest gets offline edits');
    await until(() => O.round.scores.p2[0] === 5, 10000, 'offline replica catches up');

    await wait(3500);
    const a = S.exportKeys(H.round), b = S.exportKeys(Gr.round), c = S.exportKeys(O.round);
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);

    await until(() => host.peers().length >= 2, 8000, 'host sees two peers');
    assert.ok(!(H.errors || []).length, 'no errors: ' + JSON.stringify(H.errors));
  } finally {
    sessions.forEach(s => s.stop());
    await wait(300);
  }
});

test('joiner gets the snapshot via hello when the retained message is gone', { skip, timeout: 30000 }, async () => {
  const code = S.randomCode();
  const sessions = [];
  try {
    const H = { code, round: hostRound(code) };
    H.round.scores.p1[0] = 3; S.stamp(H.round, ['score:p1:0'], S.createClock(), 'host');
    const host = mkSession(sessions, 'host', H);
    await host.start();
    await until(() => H.ready === true, 8000, 'host ready');

    // 브로커에서 retained 스냅샷이 사라진 상황을 흉내: 빈 retained 발행
    const room = await S.deriveRoom(code);
    const raw = mqtt.connect(URL, { clientId: 'rawtest' + Date.now().toString(36) });
    await new Promise((res, rej) => { raw.on('connect', res); raw.on('error', rej); });
    await new Promise((res) => raw.publish(room.topic + '/s', '', { qos: 1, retain: true }, () => res()));
    raw.end();
    await wait(300);

    const Gr = { code, round: null };
    const guest = mkSession(sessions, 'guest', Gr, { onSnapshot: (keys) => { Gr.round = S.roundFromSnapshot(keys, defaults); } });
    await guest.start();
    await until(() => Gr.round !== null, 8000, 'guest adopts via hello response');
    assert.equal(Gr.round.scores.p1[0], 3);
  } finally {
    sessions.forEach(s => s.stop());
    await wait(300);
  }
});

test('messages for a different round id are rejected (conflict)', { skip, timeout: 30000 }, async () => {
  const code = S.randomCode();
  const sessions = [];
  try {
    const A = { code, round: hostRound(code) };
    const B = { code, round: hostRound(code) }; B.round.id = 'another-round'; B.round.players[0].name = '다른사람';
    let conflicts = 0;
    const sa = mkSession(sessions, 'hostA', A, { onConflict: () => { conflicts++; } });
    await sa.start();
    await until(() => A.ready === true, 8000, 'A ready');
    const sb = mkSession(sessions, 'hostB', B);
    await sb.start();
    await until(() => B.status === 'connected', 8000, 'B connected');
    await wait(3000);
    assert.equal(A.round.players[0].name, '철수', 'A unchanged');
    assert.ok(conflicts >= 1, 'A saw a conflict');
  } finally {
    sessions.forEach(s => s.stop());
    await wait(300);
  }
});

test('a device re-joining with no local round adopts its OWN retained snapshot; adopters become ready without editing', { skip, timeout: 30000 }, async () => {
  const code = S.randomCode();
  const sessions = [];
  try {
    // 1) 기기 A가 호스트로 스냅샷을 올린 뒤 라운드를 삭제하고 세션을 끊음 (retained 스냅샷은 A가 작성자)
    const A = { code, round: hostRound(code) };
    A.round.scores.p1[0] = 3; S.stamp(A.round, ['score:p1:0'], S.createClock(), 'devA');
    const a1 = mkSession(sessions, 'devA', A);
    await a1.start();
    await until(() => A.ready === true, 8000, 'A ready');
    a1.stop();
    await wait(400);

    // 2) 같은 clientId로, 라운드 없이 다시 참여 → 다른 기기가 아무도 없어도 retained 스냅샷을 채택해야 함
    const A2 = { code, round: null };
    const a2 = mkSession(sessions, 'devA', A2, { onSnapshot: (keys) => { A2.round = S.roundFromSnapshot(keys, defaults); } });
    await a2.start();
    await until(() => A2.round !== null, 8000, 'own retained snapshot adopted');
    assert.equal(A2.round.scores.p1[0], 3);
    await until(() => A2.ready === true, 3000, 'adopter is ready without publishing');
    assert.ok(!(A2.errors || []).length, 'no errors: ' + JSON.stringify(A2.errors));

    // 3) 라운드를 들고 재접속하는 기기도 (다른 기기의 retained 스냅샷이 있으면) 편집 없이 ready
    const B = { code, round: S.roundFromSnapshot(S.exportKeys(A2.round), defaults) };
    const b = mkSession(sessions, 'devB', B);
    await b.start();
    await until(() => B.ready === true, 6000, 'reconnecting holder becomes ready from the retained snapshot');
  } finally {
    sessions.forEach(s => s.stop());
    await wait(300);
  }
});

test('wake() on a connected client replaces it and sync keeps working; stop() closes cleanly', { skip, timeout: 30000 }, async () => {
  const code = S.randomCode();
  const sessions = [];
  try {
    const H = { code, round: hostRound(code) };
    const host = mkSession(sessions, 'host', H);
    await host.start();
    await until(() => H.ready === true, 8000, 'host ready');
    const Gr = { code, round: null };
    const guest = mkSession(sessions, 'guest', Gr, { onSnapshot: (keys) => { Gr.round = S.roundFromSnapshot(keys, defaults); } });
    await guest.start();
    await until(() => Gr.round !== null, 8000, 'guest adopted');

    // 포그라운드 복귀를 흉내: 연결된 상태에서 wake() → 클라이언트 교체 후 재연결
    H.round.scores.p1[1] = 5; host.touch(['score:p1:1']); // 미확인 QoS1 발행이 있는 상태에서 wake
    host.wake();
    await until(() => H.status === 'connecting', 2000, 'wake restarts the connection');
    await until(() => H.status === 'connected' && host.hydrated(), 10000, 'host reconnected and hydrated');
    await until(() => Gr.round.scores.p1[1] === 5, 8000, 'pending edit reached the guest after wake');

    H.round.scores.p1[2] = 4; host.touch(['score:p1:2']);
    await until(() => Gr.round.scores.p1[2] === 4, 5000, 'host → guest after wake');
    Gr.round.scores.p2[2] = 6; guest.touch(['score:p2:2']);
    await until(() => H.round.scores.p2[2] === 6, 5000, 'guest → host after wake');
    await until(() => host.peers().length >= 1 && guest.peers().length >= 1, 8000, 'presence after wake');
    assert.ok(!(H.errors || []).length, 'no errors: ' + JSON.stringify(H.errors));

    // 정상 종료: 게스트가 호스트의 presence 해제를 봄 (DISCONNECT 또는 LWT)
    host.stop();
    await until(() => guest.peers().length === 0, 8000, 'host presence cleared after stop');
  } finally {
    sessions.forEach(s => s.stop());
    await wait(300);
  }
});
