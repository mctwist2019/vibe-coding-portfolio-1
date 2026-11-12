const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../games.js');
const S = require('../sync.js');

const defaults = {
  pars: G.defaultPars, strokeIndex: G.defaultStrokeIndex,
  games: () => ({
    stroke: { enabled: true, net: false, unit: 0 }, stableford: { enabled: true, net: true },
    skins: { enabled: false, net: false, mode: 'individual', unit: 1000 }, match: { enabled: false, net: false, mode: 'individual', unit: 1000 },
    nassau: { enabled: false, net: false, mode: 'individual', unit: 5000 }, bestball: { enabled: false, net: false, count: 1, unit: 1000 },
    vegas: { enabled: false, net: false, unit: 100 }, bonus: { nearest: false, longest: false, birdie: false, unit: 1000 }
  })
};

function mkRound() {
  const r = {
    id: 'r1', holes: 9, date: '2026-11-09', createdAt: 1000, name: '테스트',
    pars: G.defaultPars(9), strokeIndex: G.defaultStrokeIndex(9),
    players: [{ id: 'a', name: 'A', hcp: 0, team: 'A' }, { id: 'b', name: 'B', hcp: 5, team: 'B' }],
    scores: { a: new Array(9).fill(null), b: new Array(9).fill(null) }, extras: {}, games: defaults.games(),
    status: 'live', rev: {}, currentHole: 0, share: { host: 'host1' }
  };
  S.stampAll(r, 1000, 'host1');
  return r;
}

test('room code generation, normalization and formatting', () => {
  const c = S.randomCode();
  assert.equal(c.length, 8);
  assert.ok(S.isValidCode(c));
  assert.equal(S.formatCode(c), c.slice(0, 4) + '-' + c.slice(4));
  assert.equal(S.normalizeCode(' ab-cd 01xy'), 'ABCDOIXY');
  assert.ok(!S.isValidCode('ABCD01XY'));
  assert.ok(!S.isValidCode('ABCDEF'));
});

test('hybrid logical clock is monotonic and observes remote; maxRevTs seeds it', () => {
  let t = 100;
  const c = S.createClock(() => t);
  assert.equal(c.now(), 100);
  assert.equal(c.now(), 101);
  c.observe(500);
  assert.equal(c.now(), 501);
  t = 1000;
  assert.equal(c.now(), 1000);
  const r = mkRound(); r.rev['score:a:0'] = { ts: 99999, by: 'x' };
  assert.equal(S.maxRevTs(r), 99999);
});

test('exportKeys uses field-level keys and covers every mutable field', () => {
  const r = mkRound();
  r.scores.a[0] = 4; r.extras[2] = { nearest: 'b' };
  S.stampAll(r, 1000, 'host1');
  const keys = S.exportKeys(r);
  assert.deepEqual(keys.meta.v.playerIds, ['a', 'b']);
  assert.equal(keys.meta.v.holes, 9);
  assert.equal(keys.name.v, '테스트');
  assert.equal(keys.status.v, 'live');
  assert.equal(keys['pl:a:name'].v, 'A');
  assert.equal(keys['pl:b:hcp'].v, 5);
  assert.equal(keys['pl:b:team'].v, 'B');
  assert.equal(keys['gm:skins:unit'].v, 1000);
  assert.equal(keys['gm:bestball:count'].v, 1);
  assert.equal(keys['par:0'].v, 4);
  assert.equal(keys['score:a:0'].v, 4);
  assert.equal(keys['score:a:0'].ts, 1000);
  assert.equal(keys['extra:2:nearest'].v, 'b');
  assert.ok(!('extra:2:longest' in keys));
  assert.ok(!('score:a:1' in keys), 'null scores without rev are not exported');
  assert.ok(!('players' in keys) && !('games' in keys), 'no whole-object keys');
});

test('merge applies newer keys, keeps local newer ones, reports localNewer', () => {
  const r = mkRound();
  const clock = S.createClock(() => 5000);
  r.scores.a[0] = 4; S.stamp(r, ['score:a:0'], clock, 'me');
  const res = S.merge(r, {
    'score:a:0': { v: 7, ts: 2000, by: 'other' },   // older → ignored
    'score:b:0': { v: 5, ts: 3000, by: 'other' },   // newer than initial 1000 → applied
    'par:0': { v: 5, ts: 1000, by: 'zzz' },         // tie on ts, by greater → applied
    'pl:a:name': { v: 'A2', ts: 4000, by: 'other' },
    'pl:b:team': { v: 'A', ts: 4000, by: 'other' },
    'gm:skins:enabled': { v: true, ts: 4000, by: 'other' },
    'status': { v: 'finished', ts: 6000, by: 'other' }
  });
  assert.equal(r.scores.a[0], 4);
  assert.equal(r.scores.b[0], 5);
  assert.equal(r.pars[0], 5);
  assert.equal(r.players[0].name, 'A2');
  assert.equal(r.players[1].team, 'A');
  assert.equal(r.games.skins.enabled, true);
  assert.equal(r.status, 'finished');
  assert.ok(res.localNewer);
  assert.ok(res.changed.includes('score:b:0') && !res.changed.includes('score:a:0'));
  assert.equal(res.maxTs, 6000);
});

test('merge validates and rejects hostile or malformed input', () => {
  const r = mkRound();
  const res = S.merge(r, {
    'score:a:99': { v: 4, ts: 9000, by: 'x' },               // hole out of range
    'score:zzz:0': { v: 4, ts: 9000, by: 'x' },              // unknown player
    'score:a:1': { v: '5', ts: 9000, by: 'x' },              // string → clamped int 5 (ok)
    'score:a:2': { v: 99, ts: 9000, by: 'x' },               // clamp to 15
    'par:-1': { v: 4, ts: 9000, by: 'x' },
    'par:1': { v: 9, ts: 9000, by: 'x' },                    // clamp to 6
    'si:0': { v: 50, ts: 9000, by: 'x' },                    // clamp to holes
    'meta': { v: { id: 'other', holes: 18 }, ts: 9000, by: 'x' },
    'pl:a:name': { v: '<img onerror=alert(1)>'.repeat(5), ts: 9000, by: 'x' },
    'pl:a:hcp': { v: 999, ts: 9000, by: 'x' },
    'pl:a:team': { v: 'Z', ts: 9000, by: 'x' },
    'pl:a:bogus': { v: 1, ts: 9000, by: 'x' },
    'gm:skins:mode': { v: 'hack', ts: 9000, by: 'x' },
    'gm:skins:unit': { v: -5, ts: 9000, by: 'x' },
    'gm:nope:unit': { v: 1, ts: 9000, by: 'x' },
    'gm:skins:__proto__': { v: 1, ts: 9000, by: 'x' },
    'extra:0:nearest': { v: 'nobody', ts: 9000, by: 'x' },
    'extra:0:longest': { v: 'b', ts: 9000, by: 'x' },
    'status': { v: 'hacked', ts: 9000, by: 'x' },
    'players': { v: [], ts: 9000, by: 'x' },
    'what:ever': { v: 1, ts: 9000, by: 'x' }
  });
  assert.equal(r.holes, 9);
  assert.equal(r.id, 'r1');
  assert.equal(r.scores.a[1], 5);
  assert.equal(r.scores.a[2], 15);
  assert.equal(r.pars[1], 6);
  assert.equal(r.strokeIndex[0], 9);
  assert.equal(r.players[0].name.length, 20);
  assert.equal(r.players[0].hcp, 54);
  assert.equal(r.players[0].team, 'A', 'invalid team rejected');
  assert.equal(r.games.skins.mode, 'individual');
  assert.equal(r.games.skins.unit, 0, 'negative money clamps to 0');
  assert.ok(!r.games.nope);
  assert.equal(r.status, 'live');
  assert.ok(!r.scores.zzz);
  assert.deepEqual(r.extras[0], { longest: 'b' }, 'rejected nearest leaves no trace');
  assert.ok(!res.changed.includes('score:a:99') && !res.changed.includes('players') && !res.changed.includes('what:ever'));
  assert.ok(Object.prototype.toString.call(r.games.skins) === '[object Object]');
});

test('extra tombstones: clearing propagates as null', () => {
  const r = mkRound();
  r.extras[1] = { nearest: 'a' }; S.stamp(r, ['extra:1:nearest'], S.createClock(() => 2000), 'me');
  const res = S.merge(r, { 'extra:1:nearest': { v: null, ts: 3000, by: 'x' } });
  assert.ok(!r.extras[1]);
  assert.deepEqual(res.changed, ['extra:1:nearest']);
  const keys = S.exportKeys(r);
  assert.equal(keys['extra:1:nearest'].v, null, 'tombstone is still exported because it has a rev');
});

test('project/diffAndStamp detects local changes (including clears) and stamps only them', () => {
  const r = mkRound();
  const clock = S.createClock(() => 5000);
  const base = S.project(r);
  r.scores.a[0] = 4; r.pars[0] = 5; r.players[1].team = 'A'; r.games.skins.enabled = true;
  r.extras[0] = { nearest: 'b' };
  let d = S.diffAndStamp(r, base, clock, 'me');
  assert.deepEqual(d.changed.sort(), ['extra:0:nearest', 'gm:skins:enabled', 'par:0', 'pl:b:team', 'score:a:0']);
  assert.equal(r.rev['score:a:0'].ts, 5000);
  assert.equal(r.rev['pl:a:name'].ts, 1000, 'untouched keys keep their rev');
  // clear → tombstone is detected
  delete r.extras[0]; r.scores.a[0] = null;
  d = S.diffAndStamp(r, d.projection, clock, 'me');
  assert.deepEqual(d.changed.sort(), ['extra:0:nearest', 'score:a:0']);
  assert.equal(S.exportKeys(r)['score:a:0'].v, null);
  // no change → nothing
  d = S.diffAndStamp(r, d.projection, clock, 'me');
  assert.deepEqual(d.changed, []);
});

test('roundFromSnapshot reconstructs a full round for a new participant', () => {
  const r = mkRound();
  r.scores.a[0] = 3; r.scores.b[0] = 5; r.pars[0] = 3; r.extras[0] = { nearest: 'a' }; r.games.vegas.enabled = true;
  S.stampAll(r, 1000, 'host1');
  S.stamp(r, ['score:a:0', 'score:b:0', 'par:0', 'extra:0:nearest', 'gm:vegas:enabled'], S.createClock(() => 2000), 'host1');
  const snap = S.exportKeys(r);
  const copy = S.roundFromSnapshot(snap, defaults);
  assert.equal(copy.id, 'r1');
  assert.equal(copy.holes, 9);
  assert.equal(copy.name, '테스트');
  assert.deepEqual(copy.players, r.players);
  assert.equal(copy.scores.a[0], 3);
  assert.equal(copy.scores.b[0], 5);
  assert.equal(copy.scores.b.length, 9);
  assert.equal(copy.pars[0], 3);
  assert.deepEqual(copy.extras[0], { nearest: 'a' });
  assert.equal(copy.games.vegas.enabled, true);
  assert.equal(copy.share.host, 'host1');
  const res = S.merge(copy, snap);
  assert.deepEqual(res.changed, []);
  assert.equal(res.localNewer, false);
  assert.equal(S.hasKeysMissingFrom(copy, snap), false);
  assert.deepEqual(S.exportKeys(copy), snap, 'replica exports identical keys');
  copy.scores.b[4] = 6; S.stamp(copy, ['score:b:4'], S.createClock(() => 3000), 'guest');
  assert.equal(S.hasKeysMissingFrom(copy, snap), true);
  // 잘못된 meta는 거부
  assert.equal(S.roundFromSnapshot({ meta: { v: { id: 'x', holes: 7, playerIds: ['a'] } } }, defaults), null);
  assert.equal(S.roundFromSnapshot({}, defaults), null);
});

test('two replicas converge regardless of merge order', () => {
  const a = mkRound(), b = S.roundFromSnapshot(S.exportKeys(mkRound()), defaults);
  const ca = S.createClock(() => 5000), cb = S.createClock(() => 4000); // b의 시계가 느림
  a.scores.a[0] = 4; S.stamp(a, ['score:a:0'], ca, 'A');
  b.scores.a[0] = 6; S.stamp(b, ['score:a:0'], cb, 'B'); // 충돌: 같은 셀
  b.scores.b[0] = 5; S.stamp(b, ['score:b:0'], cb, 'B');
  b.players[0].team = 'B'; S.stamp(b, ['pl:a:team'], cb, 'B');
  a.players[1].hcp = 9; S.stamp(a, ['pl:b:hcp'], ca, 'A'); // 동시에 다른 필드 편집 → 둘 다 보존
  const snapA = S.exportKeys(a), snapB = S.exportKeys(b);
  S.merge(a, snapB); S.merge(b, snapA);
  assert.equal(a.scores.a[0], 4);
  assert.equal(b.scores.a[0], 4);
  assert.equal(a.scores.b[0], 5);
  assert.equal(a.players[0].team, 'B');
  assert.equal(b.players[1].hcp, 9);
  assert.deepEqual(S.exportKeys(a), S.exportKeys(b));
});

test('deriveRoom + seal/open roundtrip; wrong code fails; plaintext rejected', async () => {
  assert.ok(S.cryptoAvailable());
  const room = await S.deriveRoom('ABCDEFGH');
  assert.ok(room.topic.startsWith(S.TOPIC_ROOT) && room.topic.length === S.TOPIC_ROOT.length + 32);
  assert.ok(!room.topic.includes('ABCDEFGH'));
  const other = await S.deriveRoom('ABCDEFGJ');
  assert.notEqual(room.topic, other.topic);
  const msg = { t: 'op', from: 'x', keys: { 'score:a:0': { v: 4, ts: 1, by: 'x' } } };
  const sealed = await S.seal(room.key, msg);
  assert.ok(sealed.startsWith('E2.'));
  assert.deepEqual(await S.open(room.key, sealed), msg);
  await assert.rejects(S.open(other.key, sealed));
  await assert.rejects(S.open(room.key, 'P1.' + JSON.stringify(msg)), 'plaintext is not accepted');
  await assert.rejects(S.seal(null, msg));
});

test('parseBrokerUrl', () => {
  assert.deepEqual(S.parseBrokerUrl('wss://broker.emqx.io:8084/mqtt'), { protocol: 'wss', host: 'broker.emqx.io', port: 8084, path: '/mqtt' });
  assert.deepEqual(S.parseBrokerUrl('ws://localhost:1884'), { protocol: 'ws', host: 'localhost', port: 1884, path: '/mqtt' });
  assert.deepEqual(S.parseBrokerUrl('wss://mqtt.eclipseprojects.io:443/mqtt').port, 443);
  assert.equal(S.parseBrokerUrl('http://x'), null);
});

// ───── 코드 리뷰에서 확인된 결함의 회귀 테스트 ─────

test('open() never throws synchronously: malformed base64 is a rejection', async () => {
  const room = await S.deriveRoom('ABCDEFGH');
  let threw = false, p;
  try { p = S.open(room.key, 'E2.!!!.x'); } catch (e) { threw = true; }
  assert.equal(threw, false, 'must return a promise, not throw');
  await assert.rejects(p);
  await assert.rejects(S.open(room.key, 'E2.!.!'));
  await assert.rejects(S.open(room.key, 'E2.' + 'AAAA' + '.' + 'AAAA'), 'bad iv length');
});

test('reserved property names are not valid player ids', () => {
  assert.equal(S.cleanPid('__proto__'), '');
  assert.equal(S.cleanPid('constructor'), '');
  assert.equal(S.cleanPid('isPrototypeOf'), '', 'any Object.prototype member name is reserved');
  assert.equal(S.cleanPid('toLocaleString'), '');
  assert.equal(S.cleanPid('abc_1-2'), 'abc_1-2');
  const keys = S.exportKeys(mkRound());
  keys.meta.v.playerIds = ['__proto__', 'a', 'b'];
  keys['pl:__proto__:name'] = { v: 'x', ts: 1000, by: 'h' };
  keys['score:__proto__:0'] = { v: 5, ts: 1000, by: 'h' };
  const r = S.roundFromSnapshot(keys, defaults);
  assert.deepEqual(r.players.map(p => p.id), ['a', 'b']);
  assert.equal(Object.getPrototypeOf(r.scores), Object.prototype);
  assert.equal(S.merge(r, { 'score:__proto__:1': { v: 5, ts: 9999, by: 'h' } }).changed.length, 0);
  // 이미 저장된 라운드에 들어 있던 예약어 id도 ensureScores에서 걸러짐
  const bad = mkRound(); bad.players.push({ id: '__proto__', name: 'x', hcp: 0, team: '' });
  S.ensureScores(bad);
  assert.deepEqual(bad.players.map(p => p.id), ['a', 'b']);
});

test('clock and merge ignore implausibly far-future timestamps', () => {
  const now = 1_700_000_000_000;
  const c = S.createClock(() => now);
  c.observe(now + S.MAX_FUTURE + 1);
  assert.equal(c.now(), now, 'poisoned ts must not pin the clock');
  c.observe(now + 60_000);
  assert.equal(c.now(), now + 60_001, 'ordinary skew is still observed');
  const r = mkRound();
  const res = S.merge(r, { 'score:a:0': { v: 4, ts: 9e15, by: 'x' }, 'score:b:0': { v: 5, ts: 2000, by: 'x' } }, { now: () => now });
  assert.deepEqual(res.changed, ['score:b:0']);
  assert.equal(res.dropped, 1);
  assert.equal(r.scores.a[0], null);
  assert.equal(r.rev['score:a:0'], undefined, 'no rev is stored for the dropped key');
});

test('local writes are canonicalized like remote setKey so replicas converge (fractional SI, negative money)', () => {
  const a = mkRound(), b = S.roundFromSnapshot(S.exportKeys(mkRound()), defaults);
  const clock = S.createClock(() => 5000);
  let base = S.project(a);
  a.strokeIndex[2] = 3.5; a.games.skins.unit = -1000; a.players[1].hcp = 7.5; a.name = 'x'.repeat(100);
  const d = S.diffAndStamp(a, base, clock, 'A');
  assert.deepEqual(d.changed.sort(), ['gm:skins:unit', 'name', 'pl:b:hcp', 'si:2']);
  assert.equal(a.strokeIndex[2], 4);
  assert.equal(a.games.skins.unit, 0);
  assert.equal(a.players[1].hcp, 8);
  assert.equal(a.name.length, 60);
  assert.equal(d.projection['si:2'], '4', 'projection reflects the canonical value');
  S.merge(b, S.exportKeys(a, d.changed));
  assert.deepEqual(S.exportKeys(a), S.exportKeys(b));
  assert.deepEqual(G.strokesPerHole(4, 9, a.strokeIndex), G.strokesPerHole(4, 9, b.strokeIndex));
});

// ───── 홀별 상세 기록(st:) · 코스 정보(course, hi:) ─────

test('detail stats sync as field-level keys with validation and tombstones', () => {
  const a = mkRound(), b = S.roundFromSnapshot(S.exportKeys(mkRound()), defaults);
  const clock = S.createClock(() => 5000);
  let base = S.project(a);
  a.stats = { a: { 2: { ob: 1, pt: 3, fw: 3 } } };
  let d = S.diffAndStamp(a, base, clock, 'A');
  assert.deepEqual(d.changed.sort(), ['st:a:2:fw', 'st:a:2:ob', 'st:a:2:pt']);
  S.merge(b, S.exportKeys(a, d.changed));
  assert.deepEqual(b.stats, { a: { 2: { ob: 1, pt: 3, fw: 3 } } });
  // 다른 기기가 같은 홀의 다른 항목을 고쳐도 둘 다 남는다 (필드 단위 LWW)
  const cb = S.createClock(() => 6000); const baseB = S.project(b);
  b.stats.a[2].hz = 2;
  const db = S.diffAndStamp(b, baseB, cb, 'B');
  base = d.projection; a.stats.a[2].pt = 2;
  d = S.diffAndStamp(a, base, clock, 'A');
  S.merge(a, S.exportKeys(b, db.changed)); S.merge(b, S.exportKeys(a, d.changed));
  assert.deepEqual(a.stats, { a: { 2: { ob: 1, pt: 2, fw: 3, hz: 2 } } });
  assert.deepEqual(S.exportKeys(a), S.exportKeys(b));
  // 0으로 내리면 키가 사라지고 null(tombstone)로 전파된다. 퍼트 0은 유효한 값
  base = S.project(a); a.stats.a[2].ob = 0; a.stats.a[2].pt = 0;
  d = S.diffAndStamp(a, base, clock, 'A');
  assert.deepEqual(a.stats.a[2], { pt: 0, fw: 3, hz: 2 });
  assert.equal(S.exportKeys(a, ['st:a:2:ob'])['st:a:2:ob'].v, null);
  S.merge(b, S.exportKeys(a, d.changed));
  assert.deepEqual(S.exportKeys(a), S.exportKeys(b));
  // 검증: 범위 밖 홀, 모르는 플레이어/필드, 숫자가 아닌 값은 거부, 큰 값은 상한으로
  const res = S.merge(b, {
    'st:a:99:ob': { v: 1, ts: 9e3, by: 'x' }, 'st:zz:1:ob': { v: 1, ts: 9e3, by: 'x' }, 'st:a:1:xx': { v: 1, ts: 9e3, by: 'x' },
    'st:a:1:pt': { v: 'abc', ts: 9e3, by: 'x' }, 'st:a:1:ob': { v: 99, ts: 9e3, by: 'x' }, 'st:a:1:fw': { v: 7, ts: 9e3, by: 'x' },
    'st:__proto__:1:ob': { v: 1, ts: 9e3, by: 'x' }
  });
  assert.deepEqual(res.changed.sort(), ['st:a:1:fw', 'st:a:1:ob']);
  assert.deepEqual(b.stats.a[1], { ob: 9, fw: 3 }, 'values above the range are clamped');
  // 홀 번호는 앞자리 0 없는 표기만: 같은 칸을 다른 키로 덮어쓸 수 없다
  const z = S.merge(b, { 'st:a:01:ob': { v: 2, ts: 9e3 + 1, by: 'x' }, 'score:a:07': { v: 9, ts: 9e3 + 1, by: 'x' }, 'par:00': { v: 5, ts: 9e3 + 1, by: 'x' }, 'hi:03:dist': { v: 100, ts: 9e3 + 1, by: 'x' } });
  assert.deepEqual(z.changed, []);
  assert.equal(b.stats.a[1].ob, 9);
  // 지우면 빈 객체가 남지 않는다
  S.setKey(b, 'st:a:1:ob', null); S.setKey(b, 'st:a:1:fw', null);
  assert.equal(b.stats.a[1], undefined);
});

test('course name and hole info sync, are canonicalized locally, and old rounds stay compatible', () => {
  const a = mkRound(), b = S.roundFromSnapshot(S.exportKeys(mkRound()), defaults);
  assert.equal(S.exportKeys(a).course.v, '', 'a round without a course exports an empty name');
  const clock = S.createClock(() => 5000);
  const base = S.project(a);
  a.course = '베어크리크 포천 · 베어';
  a.holeInfo = { 0: { dist: 352.6, shape: 'L', haz: 17, memo: '왼쪽 OB 조심\n티샷은 우측  ' }, 3: { dist: 0, memo: '' } };
  const d = S.diffAndStamp(a, base, clock, 'A');
  assert.deepEqual(a.holeInfo, { 0: { dist: 353, shape: 'L', haz: 17, memo: '왼쪽 OB 조심 티샷은 우측' } }, 'rounded, newline → space, empty values dropped');
  S.merge(b, S.exportKeys(a, d.changed));
  assert.equal(b.course, '베어크리크 포천 · 베어');
  assert.deepEqual(b.holeInfo, a.holeInfo);
  assert.deepEqual(S.exportKeys(a), S.exportKeys(b));
  const joiner = S.roundFromSnapshot(S.exportKeys(a), defaults);
  assert.deepEqual(joiner.holeInfo, a.holeInfo);
  assert.equal(joiner.course, a.course);
  const res = S.merge(b, {
    'hi:0:shape': { v: 'X', ts: 9e3, by: 'x' }, 'hi:99:dist': { v: 5, ts: 9e3, by: 'x' }, 'hi:1:bogus': { v: 1, ts: 9e3, by: 'x' },
    'hi:1:haz': { v: 9999, ts: 9e3, by: 'x' }, 'hi:1:z128': { v: true, ts: 9e3, by: 'x' }, 'hi:1:z3': { v: 1, ts: 9e3, by: 'x' }, 'hi:1:z256': { v: 1, ts: 9e3, by: 'x' }, 'hi:1:z8': { v: 7, ts: 9e3, by: 'x' },
    'hi:1:memo': { v: '<b>x</b>'.repeat(100), ts: 9e3, by: 'x' }, 'course': { v: 'x'.repeat(99), ts: 9e3, by: 'x' }
  });
  assert.deepEqual(res.changed.sort(), ['course', 'hi:1:memo', 'hi:1:z128'], 'whole-mask key, unknown bits and non-boolean values are rejected');
  assert.equal(b.holeInfo[1].haz, 128);
  assert.equal(b.holeInfo[1].memo.length, S.MEMO_MAX);
  assert.equal(b.course.length, S.COURSE_MAX);
  assert.equal(b.holeInfo[0].shape, 'L', 'invalid shape rejected');
  // 형태를 지우면 tombstone
  S.setKey(b, 'hi:0:shape', null);
  assert.equal(b.holeInfo[0].shape, undefined);
});

test('hazard flags sync one key per flag: concurrent toggles of different flags never erase each other', () => {
  const mkr = () => { const r = mkRound(); r.holeInfo = { 2: { haz: 17 } }; S.stampAll(r, 1000, 'H'); return r; };
  const a = mkr(), b = mkr();
  assert.deepEqual(Object.keys(S.exportKeys(a)).filter((k) => /^hi:/.test(k)).sort(), ['hi:2:z1', 'hi:2:z16'], 'mask is projected as one key per set flag');
  assert.equal(S.roundFromSnapshot(S.exportKeys(a), defaults).holeInfo[2].haz, 17);
  const ca = S.createClock(() => 5000), cb = S.createClock(() => 5400);
  let baseA = S.project(a), baseB = S.project(b);
  // A: 5번홀 'OB 좌', B: 같은 홀 '해저드 우' (서로의 입력을 아직 못 받은 상태)
  S.setKey(a, 'hi:4:z1', 1); const da = S.diffAndStamp(a, baseA, ca, 'A');
  S.setKey(b, 'hi:4:z8', 1); const db = S.diffAndStamp(b, baseB, cb, 'B');
  assert.deepEqual(da.changed, ['hi:4:z1']); assert.deepEqual(db.changed, ['hi:4:z8']);
  const opsA = S.exportKeys(a, da.changed), opsB = S.exportKeys(b, db.changed);
  S.merge(a, opsB); S.merge(b, opsA);
  assert.equal(a.holeInfo[4].haz, 9); assert.equal(b.holeInfo[4].haz, 9);
  assert.deepEqual(S.exportKeys(a), S.exportKeys(b));
  // A가 'OB 좌'를 지우는 동안 B가 '벙커 좌'를 추가: 지운 것이 되살아나지 않고 둘 다 반영
  baseA = S.project(a); baseB = S.project(b);
  S.setKey(a, 'hi:4:z1', null); const da2 = S.diffAndStamp(a, baseA, ca, 'A');
  S.setKey(b, 'hi:4:z32', 1); const db2 = S.diffAndStamp(b, baseB, cb, 'B');
  const opsA2 = S.exportKeys(a, da2.changed), opsB2 = S.exportKeys(b, db2.changed);
  assert.equal(opsA2['hi:4:z1'].v, null, 'a cleared flag is sent as a tombstone');
  S.merge(a, opsB2); S.merge(b, opsA2);
  assert.equal(a.holeInfo[4].haz, 40); assert.equal(b.holeInfo[4].haz, 40);
  assert.deepEqual(S.exportKeys(a), S.exportKeys(b));
  // 마지막 위험 요소를 지우면 빈 객체가 남지 않는다
  S.setKey(a, 'hi:4:z8', 0); S.setKey(a, 'hi:4:z32', false);
  assert.equal(a.holeInfo[4], undefined);
  // 범위를 벗어난 로컬 마스크는 정규화된다
  const c = mkRound(); S.stampAll(c, 1000, 'H'); const baseC = S.project(c);
  c.holeInfo = { 0: { haz: 300 } };
  S.diffAndStamp(c, baseC, S.createClock(() => 6000), 'C');
  assert.equal(c.holeInfo[0].haz, 300 & 255);
});

test('shot count (st:<pid>:<h>:sh) syncs like the other detail stats', () => {
  const a = mkRound(), b = S.roundFromSnapshot(S.exportKeys(mkRound()), defaults);
  const clock = S.createClock(() => 7000), base = S.project(a);
  S.setKey(a, 'st:a:2:sh', 3); S.setKey(a, 'st:a:2:pt', 2);
  const d = S.diffAndStamp(a, base, clock, 'A');
  assert.deepEqual(d.changed.sort(), ['st:a:2:pt', 'st:a:2:sh']);
  S.merge(b, S.exportKeys(a, d.changed));
  assert.deepEqual(b.stats.a[2], { sh: 3, pt: 2 });
  // 범위: 1~15, 0은 '없음'
  const res = S.merge(b, { 'st:a:3:sh': { v: 99, ts: 9e3, by: 'x' }, 'st:a:4:sh': { v: 0, ts: 9e3, by: 'x' }, 'st:a:5:sh': { v: 'x', ts: 9e3, by: 'x' } });
  assert.equal(b.stats.a[3].sh, 15);
  assert.equal(b.stats.a[4], undefined);
  assert.ok(res.changed.indexOf('st:a:5:sh') < 0, 'garbage is rejected');
  S.setKey(b, 'st:a:2:sh', null);
  assert.deepEqual(b.stats.a[2], { pt: 2 });
});

test('new game settings (skins fund and OECD, 오장, double-par cap) are validated like the others', () => {
  const r = { id: 'r', holes: 18, date: 'd', createdAt: 1, name: 'n', pars: Array(18).fill(4), strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    players: [{ id: 'a', name: 'A', hcp: 0, team: '' }], scores: { a: Array(18).fill(null) }, extras: {}, status: 'live', rev: {},
    games: { skins: { enabled: true, net: false, mode: 'individual', unit: 1000, fund: true, stake: 100000, prize: 20000, start: 10000, tip: 10000, caddie: 150000, collect: true, oecd: true, fine: 10000 } } };
  assert.deepEqual(Object.keys(S.GAME_SCHEMA.skins).sort(), ['caddie', 'collect', 'enabled', 'fine', 'fund', 'join', 'mode', 'net', 'oecd', 'playorder', 'prize', 'stake', 'start', 'tip', 'unit']);
  ['fund', 'stake', 'prize', 'start', 'tip', 'caddie', 'collect', 'oecd', 'fine'].forEach((f) => assert.ok(S.allKeys(r).includes('gm:skins:' + f), f));
  assert.equal(S.getKey(r, 'gm:skins:stake'), 100000);
  assert.equal(S.setKey(r, 'gm:skins:stake', 50000), true); assert.equal(r.games.skins.stake, 50000);
  assert.equal(S.setKey(r, 'gm:skins:prize', -1), true); assert.equal(r.games.skins.prize, 0, 'money is clamped at zero');
  assert.equal(S.setKey(r, 'gm:skins:caddie', 'x'), false); assert.equal(r.games.skins.caddie, 150000);
  assert.equal(S.setKey(r, 'gm:skins:fund', 'maybe'), false); assert.equal(r.games.skins.fund, true);
  assert.equal(S.setKey(r, 'gm:skins:oecd', false), true); assert.equal(r.games.skins.oecd, false);
  // OECD 가입 기준: 금액으로 검증하고, 예전 라운드(값이 없음)는 키를 보내지 않는다
  assert.ok(!S.allKeys(r).includes('gm:skins:join'), 'a round without the setting does not send it');
  assert.equal(S.setKey(r, 'gm:skins:join', 60000), true); assert.equal(r.games.skins.join, 60000); assert.ok(S.allKeys(r).includes('gm:skins:join'));
  assert.equal(S.setKey(r, 'gm:skins:join', 0), true); assert.equal(r.games.skins.join, 0, '0 (the old rule) is a valid value');
  assert.equal(S.setKey(r, 'gm:skins:join', 'many'), false); assert.equal(r.games.skins.join, 0);
  assert.equal(S.setKey(r, 'gm:skins:join', -5), true); assert.equal(r.games.skins.join, 0, 'money is clamped at zero');
  assert.equal(S.setKey(r, 'gm:skins:collect', false), true); assert.equal(r.games.skins.collect, false);
  assert.equal(S.setKey(r, 'gm:skins:collect', 'yes'), false); assert.equal(r.games.skins.collect, false);
  assert.equal(S.setKey(r, 'gm:skins:member', 3), false, 'no such setting');
  assert.equal(S.allKeys(r).includes('gm:skins:playorder'), false, 'a round without the stamp does not send one');
  assert.equal(S.setKey(r, 'gm:skins:playorder', true), true); assert.equal(r.games.skins.playorder, true);
  assert.ok(S.allKeys(r).includes('gm:skins:playorder'));
  // 오장 설정과 양파 한도
  assert.deepEqual(Object.keys(S.GAME_SCHEMA.ojang).sort(), ['birdie', 'carry', 'enabled', 'near', 'net', 'unit']);
  assert.equal(S.setKey(r, 'gm:ojang:unit', 5000), true); assert.equal(r.games.ojang.unit, 5000);
  assert.equal(S.setKey(r, 'gm:ojang:unit', -1), true); assert.equal(r.games.ojang.unit, 0, 'money is clamped at zero');
  assert.equal(S.setKey(r, 'gm:ojang:carry', false), true); assert.equal(r.games.ojang.carry, false);
  assert.equal(S.setKey(r, 'gm:ojang:mode', 'team'), false, 'no such setting');
  assert.equal(S.setKey(r, 'gm:stroke:cap', true), true); assert.equal(r.games.stroke.cap, true);
  assert.equal(S.setKey(r, 'gm:stroke:cap', 2), false);
  assert.ok(S.allKeys(r).includes('gm:ojang:unit') && S.allKeys(r).includes('gm:stroke:cap'));
});

test('the chosen start hole is shared: it changes the skins carry order, so every device must use the same one', () => {
  const mk = () => ({ id: 'r', holes: 18, date: 'd', createdAt: 1, name: 'n', pars: Array(18).fill(4), strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
    players: [{ id: 'a', name: 'A', hcp: 0, team: '' }], scores: { a: Array(18).fill(null) }, extras: {}, status: 'live', rev: {}, games: {} });
  const a = mk(), b = mk();
  assert.equal(S.allKeys(a).includes('start'), false, 'nothing is sent while the start hole is automatic');
  assert.equal(S.getKey(a, 'start'), '');
  const clock = S.createClock ? S.createClock() : { now: () => 1000 };
  let d = S.diffAndStamp(a, S.project(a), clock, 'me');
  assert.deepEqual(d.changed, []);
  a.startBack = true;
  d = S.diffAndStamp(a, d.projection, clock, 'me');
  assert.deepEqual(d.changed, ['start']);
  assert.equal(S.getKey(a, 'start'), 'in');
  // 다른 기기가 받는다
  let res = S.merge(b, S.exportKeys(a, ['start']));
  assert.deepEqual(res.changed, ['start']); assert.equal(b.startBack, true);
  // 1번홀로 바꾸고, 다시 자동으로 되돌린 것도 전해진다
  a.startBack = false; d = S.diffAndStamp(a, d.projection, clock, 'me');
  S.merge(b, S.exportKeys(a, ['start'])); assert.equal(b.startBack, false);
  delete a.startBack; d = S.diffAndStamp(a, d.projection, clock, 'me');
  assert.deepEqual(d.changed, ['start']);
  assert.ok(S.allKeys(a).includes('start'), 'the cleared choice is still sent (its timestamp is kept)');
  S.merge(b, S.exportKeys(a, ['start'])); assert.equal(b.startBack, undefined);
  // 이상한 값은 받지 않는다
  assert.equal(S.setKey(b, 'start', 'in'), true); assert.equal(b.startBack, true);
  assert.equal(S.setKey(b, 'start', 'back'), false); assert.equal(S.setKey(b, 'start', 1), false); assert.equal(b.startBack, true);
  assert.equal(S.setKey(b, 'start', null), true); assert.equal(b.startBack, undefined);
  res = S.merge(b, { 'start:1': { v: 'in', ts: 9e6, by: 'x' }, starts: { v: 'in', ts: 9e6, by: 'x' } });
  assert.deepEqual(res.changed, []);
});

test('nearest/longest rules and the eraser are shared: bonus settings and the per-hole eraser key', () => {
  const r = mkRound();
  r.games.bonus = Object.assign(r.games.bonus, { parthree: true, parfive: false, eraser: true });
  assert.equal(S.getKey(r, 'gm:bonus:parthree'), true);
  assert.equal(S.getKey(r, 'gm:bonus:parfive'), false);
  assert.equal(S.getKey(r, 'gm:bonus:eraser'), true);
  assert.equal(S.setKey(r, 'gm:bonus:parfive', true), true); assert.equal(r.games.bonus.parfive, true);
  assert.equal(S.setKey(r, 'gm:bonus:eraser', 'yes'), false, 'only booleans');
  // 홀마다 적는 지우개: 플레이어 id, 비우면 지워진다
  assert.equal(S.setKey(r, 'extra:2:nearest', 'a'), true);
  assert.equal(S.setKey(r, 'extra:2:eraser', 'b'), true);
  assert.deepEqual(r.extras[2], { nearest: 'a', eraser: 'b' });
  assert.equal(S.getKey(r, 'extra:2:eraser'), 'b');
  assert.equal(S.setKey(r, 'extra:2:eraser', 'nobody'), false, 'unknown player');
  assert.equal(S.setKey(r, 'extra:9:eraser', 'b'), false, 'hole out of range');
  assert.equal(S.setKey(r, 'extra:2:erasers', 'b'), false, 'unknown field');
  S.stamp(r, ['extra:2:nearest', 'extra:2:eraser', 'gm:bonus:parthree', 'gm:bonus:parfive', 'gm:bonus:eraser'], S.createClock(() => 2000), 'me');
  const keys = S.exportKeys(r);
  assert.equal(keys['extra:2:eraser'].v, 'b');
  assert.ok(!('extra:3:eraser' in keys));
  // 다른 기기로: 값이 그대로 가고, 지우면 지운 것도 간다
  const other = mkRound();
  assert.deepEqual(S.merge(other, keys).changed.filter((k) => /^extra:/.test(k)).sort(), ['extra:2:eraser', 'extra:2:nearest']);
  assert.deepEqual(other.extras[2], { nearest: 'a', eraser: 'b' });
  assert.equal(other.games.bonus.eraser, true); assert.equal(other.games.bonus.parthree, true);
  assert.equal(S.setKey(r, 'extra:2:eraser', null), true);
  assert.deepEqual(r.extras[2], { nearest: 'a', eraser: null });
  S.stamp(r, ['extra:2:eraser'], S.createClock(() => 3000), 'me');
  assert.deepEqual(S.merge(other, S.exportKeys(r)).changed, ['extra:2:eraser']);
  assert.equal(other.extras[2].eraser, null);
  // 설정을 만든 버전 표시: 0~9999의 정수만
  assert.equal(S.setKey(r, 'gm:bonus:made', 12), true); assert.equal(r.games.bonus.made, 12);
  assert.equal(S.setKey(r, 'gm:bonus:made', 'twelve'), false);
  assert.equal(S.setKey(r, 'gm:bonus:made', -1), true); assert.equal(r.games.bonus.made, 0, 'clamped');
  assert.equal(S.setKey(r, 'gm:bonus:made', 12), true);
  S.stamp(r, ['gm:bonus:made'], S.createClock(() => 3500), 'me');
  assert.ok(S.merge(other, S.exportKeys(r)).changed.indexOf('gm:bonus:made') >= 0); assert.equal(other.games.bonus.made, 12);
  // 니어까지 지우면 그 홀의 기록이 없어진다
  assert.equal(S.setKey(r, 'extra:2:nearest', null), true);
  assert.equal(r.extras[2], undefined);
});

