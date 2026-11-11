const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../games.js');

function mkRound(players, scores, opts) {
  const holes = (opts && opts.holes) || 18;
  return Object.assign({
    holes,
    pars: G.defaultPars(holes),
    strokeIndex: G.defaultStrokeIndex(holes),
    players,
    scores,
    extras: {},
    games: {}
  }, opts || {});
}

test('strokesPerHole distributes handicap by stroke index', () => {
  const s = G.strokesPerHole(20, 18, G.defaultStrokeIndex(18));
  assert.equal(s.reduce((a, b) => a + b, 0), 20);
  // SI 1 and 2 holes get 2 strokes
  const si = G.defaultStrokeIndex(18);
  assert.equal(s[si.indexOf(1)], 2);
  assert.equal(s[si.indexOf(2)], 2);
  assert.equal(s[si.indexOf(3)], 1);
  // 9홀은 절반
  const s9 = G.strokesPerHole(18, 9, G.defaultStrokeIndex(9));
  assert.equal(s9.reduce((a, b) => a + b, 0), 9);
});

test('strokePlay totals, ranking and stroke bet', () => {
  const r = mkRound(
    [{ id: 'a', name: 'A', hcp: 0 }, { id: 'b', name: 'B', hcp: 0 }],
    { a: Array(18).fill(4), b: Array(18).fill(5) },
    { games: { stroke: { unit: 1000 } } }
  );
  const res = G.strokePlay(r, { unit: 1000 });
  assert.equal(res.rows[0].id, 'a');
  assert.equal(res.rows[0].gross, 72);
  assert.equal(res.rows[0].toPar, 0);
  assert.equal(res.rows[1].toPar, 18);
  assert.equal(res.rows[0].rank, 1);
  assert.equal(res.rows[1].rank, 2);
  assert.deepEqual(res.transfers.map(t => [t.from, t.to, t.amount]), [['b', 'a', 18000]]);
});

test('stableford points', () => {
  assert.equal(G.stablefordPoints(-1), 3);
  assert.equal(G.stablefordPoints(0), 2);
  assert.equal(G.stablefordPoints(1), 1);
  assert.equal(G.stablefordPoints(2), 0);
  const r = mkRound([{ id: 'a', name: 'A', hcp: 0 }], { a: Array(18).fill(4) });
  const res = G.stableford(r, { net: false });
  // par 72 course with all 4s: 10 par-4 → 2pt, 4 par-3 → 1pt, 4 par-5 → 3pt = 20+4+12 = 36
  assert.equal(res.rows[0].points, 36);
});

test('skins with carryover and money', () => {
  const a = Array(18).fill(null), b = Array(18).fill(null), c = Array(18).fill(null);
  // hole1 tie, hole2 tie, hole3 A wins (3 skins), hole4 B wins (1 skin)
  a[0] = 4; b[0] = 4; c[0] = 5;
  a[1] = 4; b[1] = 4; c[1] = 4;
  a[2] = 2; b[2] = 3; c[2] = 3;
  a[3] = 5; b[3] = 4; c[3] = 5;
  const r = mkRound([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], { a, b, c });
  const res = G.skins(r, { unit: 1000, mode: 'individual' });
  const byId = Object.fromEntries(res.entrants.map(e => [e.id, e.skins]));
  assert.deepEqual(byId, { a: 3, b: 1, c: 0 });
  assert.equal(res.carry, 0);
  const s = G.settle(res.transfers, r.players);
  const net = Object.fromEntries(s.rows.map(x => [x.id, x.net]));
  // A: receives 3000 from B and C = 6000, pays 1000 to B → +5000
  assert.deepEqual(net, { a: 5000, b: -1000, c: -4000 });
});

test('team skins split winnings among team members', () => {
  const r = mkRound(
    [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'A' }, { id: 'c', name: 'C', team: 'B' }, { id: 'd', name: 'D', team: 'B' }],
    { a: [3], b: [5], c: [4], d: [4] },
    { holes: 9 }
  );
  const res = G.skins(r, { unit: 1000, mode: 'team' });
  assert.equal(res.entrants[0].id, 'A');
  assert.equal(res.entrants[0].skins, 1);
  const s = G.settle(res.transfers, r.players);
  const net = Object.fromEntries(s.rows.map(x => [x.id, x.net]));
  assert.deepEqual(net, { a: 1000, b: 1000, c: -1000, d: -1000 });
});

test('computeMatch status text', () => {
  // A wins 4 holes straight → after hole 15 with 3 remaining: 4&3
  const a = Array(18).fill(4), b = Array(18).fill(4);
  b[0] = 5; b[1] = 5; b[2] = 5; b[3] = 5;
  // a is 4 up after hole 4 (remaining 14), not decided; stays 4 up → decided when remaining < 4 → after hole 15 (remaining 3)
  const st = G.computeMatch(a, b);
  assert.equal(st.decided, true);
  assert.equal(st.text, '4&3');
  assert.equal(st.leader, 'A');
  const tie = G.computeMatch(Array(9).fill(4), Array(9).fill(4));
  assert.equal(tie.text, 'AS');
  assert.equal(tie.finished, true);
  const prog = G.computeMatch([3, 4, null, null], [4, 4, null, null]);
  assert.equal(prog.finished, false);
  assert.equal(prog.text, '1UP (2홀)');
});

test('matchPlay individual round robin pays margin × unit', () => {
  const r = mkRound(
    [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    { a: Array(9).fill(4), b: Array(9).fill(5), c: Array(9).fill(4) },
    { holes: 9 }
  );
  const res = G.matchPlay(r, { unit: 1000, mode: 'individual' });
  assert.equal(res.matches.length, 3);
  const s = G.settle(res.transfers, r.players);
  const net = Object.fromEntries(s.rows.map(x => [x.id, x.net]));
  // A beats B 5&4 (margin 5) → 5000; C beats B 5&4 → 5000; A vs C AS
  assert.deepEqual(net, { a: 5000, c: 5000, b: -10000 });
});

test('nassau requires 18 holes and pays per segment', () => {
  const r9 = mkRound([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { a: [], b: [] }, { holes: 9 });
  assert.ok(G.nassau(r9, {}).error);
  const a = Array(18).fill(4), b = Array(18).fill(4);
  b[0] = 5; // A wins front and total; back AS
  const r = mkRound([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { a, b });
  const res = G.nassau(r, { unit: 5000, mode: 'individual' });
  const segs = res.matches[0].segments.map(s => s.status.text);
  assert.deepEqual(segs, ['1UP', 'AS', '1UP']);
  const s = G.settle(res.transfers, r.players);
  assert.equal(s.rows[0].id, 'a');
  assert.equal(s.rows[0].net, 10000);
});

test('bestBall team totals and hole wins', () => {
  const r = mkRound(
    [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'A' }, { id: 'c', name: 'C', team: 'B' }, { id: 'd', name: 'D', team: 'B' }],
    { a: [3, 5], b: [5, 5], c: [4, 4], d: [4, 6] },
    { holes: 9 }
  );
  const res = G.bestBall(r, { count: 1, unit: 1000 });
  const t = Object.fromEntries(res.teams.map(x => [x.id, x]));
  assert.equal(t.A.total, 8);
  assert.equal(t.B.total, 8);
  assert.equal(t.A.holesWon, 1);
  assert.equal(t.B.holesWon, 1);
});

test('vegas numbers and birdie flip', () => {
  const r = mkRound(
    [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'A' }, { id: 'c', name: 'C', team: 'B' }, { id: 'd', name: 'D', team: 'B' }],
    { a: [4, 3], b: [5, 5], c: [4, 4], d: [6, 4] },
    { holes: 9 }
  );
  const res = G.vegas(r, { unit: 100 });
  // hole1: A 45 vs B 46 → A wins 1 point
  assert.deepEqual(res.holes[0].nums, [45, 46]);
  assert.equal(res.holes[0].points, 1);
  // hole2 (par4): A has birdie(3) → B flips: A 35 vs B 44 → A wins 9
  assert.deepEqual(res.holes[1].nums, [35, 44]);
  assert.equal(res.holes[1].points, 9);
  const t = Object.fromEntries(res.teams.map(x => [x.id, x.points]));
  assert.deepEqual(t, { A: 10, B: 0 });
  const s = G.settle(res.transfers, r.players);
  const net = Object.fromEntries(s.rows.map(x => [x.id, x.net]));
  assert.deepEqual(net, { a: 1000, b: 1000, c: -1000, d: -1000 });
});

test('bonuses: nearest/longest/birdie', () => {
  const r = mkRound(
    [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    { a: [3], b: [4], c: [4] },
    { holes: 9, extras: { 0: { nearest: 'b', longest: 'c' } } }
  );
  const res = G.bonuses(r, { nearest: true, longest: true, birdie: true, unit: 1000 });
  assert.equal(res.counts.a.birdie, 1);
  // 정산 제외 시에도 횟수는 계산되고 송금만 없다
  const off = G.bonuses(r, { nearest: false, longest: false, birdie: false, unit: 1000 });
  assert.equal(off.counts.a.birdie, 1);
  assert.equal(off.counts.b.nearest, 1);
  assert.equal(off.transfers.length, 0);
  const s = G.settle(res.transfers, r.players);
  const net = Object.fromEntries(s.rows.map(x => [x.id, x.net]));
  // each event: 2 others pay 1000 → +2000 for the winner, -1000 for each other
  assert.deepEqual(net, { a: 0, b: 0, c: 0 });
});

test('simplify produces minimal payments', () => {
  const p = G.simplify({ a: 5000, b: -3000, c: -2000 });
  assert.deepEqual(p, [{ from: 'b', to: 'a', amount: 3000 }, { from: 'c', to: 'a', amount: 2000 }]);
});

test('computeAll aggregates enabled games', () => {
  const r = mkRound(
    [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'B' }],
    { a: Array(18).fill(4), b: Array(18).fill(5) },
    { games: { stroke: { unit: 100 }, skins: { enabled: true, unit: 1000, mode: 'individual' }, match: { enabled: true, unit: 1000, mode: 'team' }, nassau: { enabled: true, unit: 5000, mode: 'team' } } }
  );
  const all = G.computeAll(r);
  assert.ok(all.skins && all.match && all.nassau && all.settlement);
  // 켜지 않은 게임도 항상 계산되지만 정산에는 빠진다
  assert.ok(all.bestball && all.vegas && all.bonus && all.stableford);
  assert.equal(all.bestball.enabled, false);
  assert.equal(all.skins.enabled, true);
  assert.ok(all.vegas.error, '2:2 not possible with 2 players');
  assert.equal(all.settlement.rows[0].id, 'a');
  // stroke 18*100 + skins 18*1000 + match 10&8 → 10*1000 + nassau 3*5000
  assert.equal(all.settlement.rows[0].net, 1800 + 18000 + 10000 + 15000);
});

// ───────────────────────── 스킨스의 OECD 룰 (오장) ─────────────────────────
function oecdRound(scores, stats, opts) {
  const pad = (a) => a.concat(Array(18 - a.length).fill(null));
  const players = Object.keys(scores).map((id) => ({ id, name: id.toUpperCase(), hcp: 0, team: '' }));
  const sc = {}; Object.keys(scores).forEach((id) => { sc[id] = pad(scores[id]); });
  return mkRound(players, sc, Object.assign({ pars: Array(18).fill(4), stats: stats || {} }, opts || {}));
}
const netOf = (res, r) => Object.fromEntries(G.settle(res.transfers, r.players).rows.map((x) => [x.id, x.net]));
const skinsOf = (res) => Object.fromEntries(res.entrants.map((e) => [e.id, e.skins]));

test('OECD faults (오장) come from the detail stats and the gross score', () => {
  const r = oecdRound({ a: [4, 7, 4, 6, 4] }, { a: { 0: { ob: 2, bk: 1, hz: 1, pt: 3 }, 2: { pt: 2 }, 3: { pt: 4 }, 4: { ob: 0, pt: 0 } } });
  assert.deepEqual(G.oecdFaults(r, 'a', 0), ['ob', 'bk', 'hz', 'pt3'], 'each kind counts once per hole, however many times');
  assert.deepEqual(G.oecdFaults(r, 'a', 1), ['tri'], 'triple bogey or worse, from the score alone');
  assert.deepEqual(G.oecdFaults(r, 'a', 2), [], 'two putts and a par are fine');
  assert.deepEqual(G.oecdFaults(r, 'a', 3), ['pt3'], 'double bogey with four putts: only the putts count');
  assert.deepEqual(G.oecdFaults(r, 'a', 4), []);
  assert.deepEqual(G.oecdFaults(r, 'a', 9), [], 'no score, no stats');
  assert.deepEqual(G.oecdFaults(r, 'zz', 0), []);
  r.pars[1] = 5; assert.deepEqual(G.oecdFaults(r, 'a', 1), [], '7 on a par 5 is a double bogey');
  r.stats.a[1] = { hz: 1 }; r.players[0].hcp = 36;
  assert.deepEqual(G.oecdFaults(r, 'a', 1), ['hz'], 'handicap strokes do not excuse a fault');
  assert.deepEqual(G.OECD_ITEMS.map((x) => x[0]), ['ob', 'bk', 'hz', 'pt3', 'tri']);
});

test('OECD: a member who commits faults hands skins back to the next hole', () => {
  // a wins holes 1 and 2 (2 skins = joined). Hole 3: a wins again but with OB and a 3-putt → hands back 2. Hole 4: b wins 1 + 2.
  const r = oecdRound({ a: [3, 3, 3, 5], b: [4, 4, 4, 4], c: [4, 4, 4, 5] }, { a: { 2: { ob: 1, pt: 3 } } });
  const res = G.skins(r, { unit: 1000, mode: 'individual', oecd: true, join: 2 });
  assert.deepEqual(res.oecd, { on: true, join: 2 });
  assert.deepEqual(skinsOf(res), { a: 1, b: 3, c: 0 });
  assert.equal(res.carry, 0);
  assert.deepEqual(res.holes[2].oecd, [{ id: 'a', name: 'A', faults: ['ob', 'pt3'], labels: ['OB', '3퍼트'], returned: 2 }]);
  assert.equal(res.holes[2].carry, 2, 'the returned skins wait for the next outright winner');
  assert.equal(res.holes[3].skins, 3);
  const e = Object.fromEntries(res.entrants.map((x) => [x.id, x]));
  assert.equal(e.a.returned, 2); assert.equal(e.a.oecd, false, 'below the line again: no longer a member');
  assert.equal(e.b.oecd, true);
  // 돈: a +6000(3스킨) −4000(2스킨 반납: 두 사람에게 2000씩) −3000(b의 3스킨) = −1000
  assert.deepEqual(netOf(res, r), { a: -1000, b: 5000, c: -4000 });
  // 같은 라운드, OECD 없이
  const plain = G.skins(r, { unit: 1000, mode: 'individual' });
  assert.deepEqual(skinsOf(plain), { a: 3, b: 1, c: 0 });
  assert.equal(plain.oecd.on, false);
  assert.ok(plain.holes.every((h) => !h.oecd) && plain.entrants.every((x) => !x.oecd && x.returned === 0));
});

test('OECD: applies only from the hole after joining, and only while at or above the line', () => {
  // a joins by winning hole 1 with a fault on that same hole → no penalty there (was not a member when the hole started)
  const r = oecdRound({ a: [3, 4, 4, 4, 4], b: [4, 4, 5, 5, 5], c: [4, 4, 5, 5, 5] }, { a: { 0: { ob: 1 }, 1: { bk: 1 }, 2: { hz: 1 }, 3: { hz: 1 }, 4: { hz: 1 } } });
  const res = G.skins(r, { unit: 1000, mode: 'individual', oecd: true, join: 1 });
  assert.equal(res.holes[0].oecd, undefined);
  // hole 2: tie (carry 1), a is a member with a bunker → hands back its only skin → carry 2, a leaves the club
  assert.deepEqual(res.holes[1].oecd.map((o) => o.returned), [1]);
  assert.equal(res.holes[1].carry, 2);
  // hole 3: a wins 3 skins (1 + carry 2) but was not a member at the start (0 skins) → the hazard costs nothing
  assert.equal(res.holes[2].skins, 3); assert.equal(res.holes[2].oecd, undefined);
  // hole 4: member again (3 skins), wins and has a hazard → hands back 1; hole 5 the same
  assert.deepEqual(res.holes[3].oecd.map((o) => o.returned), [1]);
  assert.deepEqual(res.holes[4].oecd.map((o) => o.returned), [1]);
  assert.equal(res.holes[4].skins, 2, 'the skin handed back on hole 4 is won back on hole 5');
  assert.deepEqual(skinsOf(res), { a: 4, b: 0, c: 0 }); // 3 → (+1 −1) = 3 → (+2 −1) = 4
  assert.equal(res.carry, 1, 'a skin returned on the last played hole stays on the table');
  const net = netOf(res, r);
  assert.equal(net.a + net.b + net.c, 0, 'zero-sum');
  assert.equal(res.entrants.find((x) => x.id === 'a').returned, 3);
});

test('OECD: cannot hand back more skins than held; ties, missing scores and team mode', () => {
  // a has 1 skin (join 1) and commits four kinds on a tied hole → hands back 1 only
  const r = oecdRound({ a: [3, 8], b: [4, 8], c: [4, 8] }, { a: { 1: { ob: 1, bk: 1, hz: 1, pt: 3 } } });
  const res = G.skins(r, { unit: 500, mode: 'individual', oecd: true, join: 1 });
  assert.deepEqual(res.holes[1].oecd[0].faults, ['ob', 'bk', 'hz', 'pt3', 'tri']);
  assert.equal(res.holes[1].oecd[0].returned, 1);
  assert.deepEqual(skinsOf(res), { a: 0, b: 0, c: 0 });
  assert.equal(res.carry, 2);
  assert.deepEqual(netOf(res, r), { a: 0, b: 0, c: 0 }, 'won 1000, handed 1000 back');
  // 점수가 다 들어오지 않은 홀은 벌칙도 보지 않는다
  const r2 = oecdRound({ a: [3, 8], b: [4, null], c: [4, 8] }, { a: { 1: { ob: 1 } } });
  const res2 = G.skins(r2, { unit: 500, mode: 'individual', oecd: true, join: 1 });
  assert.equal(res2.holes[1].played, false); assert.equal(res2.holes[1].oecd, undefined);
  assert.deepEqual(skinsOf(res2), { a: 1, b: 0, c: 0 });
  // 팀전에서는 적용하지 않는다
  const r3 = mkRound([{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'A' }, { id: 'c', name: 'C', team: 'B' }, { id: 'd', name: 'D', team: 'B' }],
    { a: [3, 3], b: [5, 5], c: [4, 4], d: [4, 4] }, { holes: 9, stats: { a: { 1: { ob: 1 } } } });
  const res3 = G.skins(r3, { unit: 1000, mode: 'team', oecd: true, join: 1 });
  assert.equal(res3.oecd.on, false);
  assert.equal(res3.entrants[0].skins, 2);
  // 가입 기준: 잘못된 값은 기본값
  assert.equal(G.skins(r, { oecd: true, join: 0 }).oecd.join, G.OECD_JOIN);
  assert.equal(G.skins(r, { oecd: true, join: 'x' }).oecd.join, G.OECD_JOIN);
  assert.equal(G.skins(r, { oecd: true, join: 7 }).oecd.join, 7);
  assert.equal(G.skins(r, { oecd: true }).oecd.join, 5);
});

test('OECD through computeAll: settlement stays zero-sum over a full round', () => {
  const sc = { a: [], b: [], c: [], d: [] }, stats = { a: {}, b: {}, c: {}, d: {} };
  for (let h = 0; h < 18; h++) {
    sc.a.push(h % 3 === 0 ? 3 : 5); sc.b.push(h % 3 === 1 ? 3 : 5); sc.c.push(h % 3 === 2 ? 3 : 7); sc.d.push(4 + (h % 2));
    if (h % 2) stats.a[h] = { ob: 1 }; if (h % 4 === 1) stats.b[h] = { pt: 3, bk: 2 };
  }
  const r = oecdRound(sc, stats, { games: { skins: { enabled: true, unit: 1000, mode: 'individual', oecd: true, join: 2 } } });
  const all = G.computeAll(r);
  assert.equal(all.skins.oecd.on, true);
  const total = all.skins.entrants.reduce((a, e) => a + e.skins, 0) + all.skins.carry;
  assert.equal(total, 18, 'every skin is either held or waiting on the table');
  assert.ok(all.skins.entrants.some((e) => e.returned > 0));
  assert.equal(all.settlement.rows.reduce((a, x) => a + x.net, 0), 0);
  // 각 사람의 돈 = (가진 스킨이 아니라) 딴 스킨과 내놓은 스킨, 잃은 스킨의 합: 스킨 수 × 단가 × 인원으로 검산
  const n = r.players.length;
  const held = Object.fromEntries(all.skins.entrants.map((e) => [e.id, e.skins]));
  const sumHeld = Object.values(held).reduce((a, b) => a + b, 0);
  all.settlement.rows.forEach((x) => assert.equal(x.net, 1000 * (held[x.id] * n - sumHeld), x.id + ' net follows the skins held at the end'));
});

// ───────────────────────── 양파 한도 (홀당 최대 파의 두 배) ─────────────────────────
test('double-par cap: off by default, caps what every calculation reads when on', () => {
  const r = mkRound([{ id: 'a', name: 'A', hcp: 0 }, { id: 'b', name: 'B', hcp: 0 }], { a: [9, 7, 12, 4], b: [5, 3, 6, 4] }, { holes: 9, pars: [4, 3, 5, 4, 4, 4, 4, 4, 4] });
  assert.equal(G.maxScore(r, 0), 15);
  assert.equal(G.gross(r, 'a', 0), 9);
  assert.equal(G.strokePlay(r, {}).rows.find((x) => x.id === 'a').gross, 32);
  r.games = { stroke: { cap: true } };
  assert.deepEqual([0, 1, 2].map((h) => G.maxScore(r, h)), [8, 6, 10], 'par 4 → 8, par 3 → 6, par 5 → 10');
  assert.deepEqual([0, 1, 2, 3].map((h) => G.gross(r, 'a', h)), [8, 6, 10, 4], 'scores above the cap count as the cap');
  assert.deepEqual([0, 1, 2, 3].map((h) => G.gross(r, 'b', h)), [5, 3, 6, 4], 'scores at or under the cap are untouched');
  assert.equal(r.scores.a[0], 9, 'the stored score is not rewritten');
  assert.equal(G.gross(r, 'a', 5), null);
  const row = G.strokePlay(r, {}).rows.find((x) => x.id === 'a');
  assert.equal(row.gross, 28, 'totals use the capped scores');
  assert.equal(G.score(r, 'a', 0, false, G.strokesMap(r)), 8);
  // 핸디 적용: 한도는 실제 타수에 먼저 적용하고 그다음 핸디 타수를 뺀다
  r.players[0].hcp = 18;
  assert.equal(G.score(r, 'a', 0, true, G.strokesMap(r)), 8 - G.strokesPerHole(18, 9, r.strokeIndex)[0]);
  // 파가 없는 홀 번호 등 이상한 입력에도 15타 기본값
  assert.equal(G.maxScore(r, 99), 15);
  assert.equal(G.maxScore({ games: { stroke: { cap: true } }, pars: [6] }, 0), 12);
  assert.equal(G.maxScore({ games: { stroke: { cap: true } }, pars: [8] }, 0), 15, 'never above the entry limit of 15');
  // 이름: 파의 두 배는 '양파'
  assert.equal(G.toParLabel(4, 4), '양파');
  assert.equal(G.toParLabel(3, 3), '양파');
  assert.equal(G.toParLabel(3, 4), '트리플보기');
  assert.equal(G.toParLabel(3), '트리플보기');
  assert.equal(G.toParLabel(5, 5), '양파');
});

test('double-par cap and OECD together: a capped hole still counts as a triple or worse', () => {
  const r = oecdRound({ a: [3, 12], b: [4, 5], c: [4, 5] }, {}, { games: { stroke: { cap: true } } });
  assert.equal(G.gross(r, 'a', 1), 8);
  assert.deepEqual(G.oecdFaults(r, 'a', 1), ['tri']);
  const res = G.skins(r, { unit: 1000, mode: 'individual', oecd: true, join: 1 });
  assert.deepEqual(res.holes[1].oecd.map((o) => o.returned), [1]);
});

// ───────────────────────── 오장 (타당 스트로크 · 배판 · 파3 니어) ─────────────────────────
function ojRound(scores, opts) {
  const pad = (a) => a.concat(Array(18 - a.length).fill(null));
  const players = Object.keys(scores).map((id) => ({ id, name: id.toUpperCase(), hcp: 0, team: '' }));
  const sc = {}; Object.keys(scores).forEach((id) => { sc[id] = pad(scores[id]); });
  return mkRound(players, sc, Object.assign({ pars: Array(18).fill(4) }, opts || {}));
}
const amt = (res) => Object.fromEntries(res.rows.map((x) => [x.id, x.amount]));

test('오장: 민판 is the stroke difference per hole, pair by pair', () => {
  const r = ojRound({ a: [4], b: [5], c: [4], d: [6] });
  const res = G.ojang(r, { unit: 5000 });
  assert.deepEqual(res.holes[0], { hole: 0, played: true, mult: 1, reasons: [] });
  assert.deepEqual(amt(res), { a: 15000, b: -5000, c: 15000, d: -25000 });
  assert.equal(res.doubles, 0);
  assert.equal(res.transfers.every((t) => t.game === 'ojang'), true);
  assert.deepEqual(netOf(res, r), amt(res), 'the rows and the settlement agree');
  // 타당 금액을 바꾸면 그대로 비례한다
  assert.deepEqual(amt(G.ojang(r, { unit: 10000 })), { a: 30000, b: -10000, c: 30000, d: -50000 });
  assert.deepEqual(amt(G.ojang(r, {})), { a: 0, b: 0, c: 0, d: 0 }, 'no unit, no money');
});

test('오장: 배판 conditions double the hole (once, however many apply)', () => {
  const one = (scores, opts, o) => { const r = ojRound(scores, opts); return { r, res: G.ojang(r, Object.assign({ unit: 5000, birdie: false }, o || {})) }; };
  // 버디
  let x = one({ a: [3], b: [4], c: [5] });
  assert.deepEqual(x.res.holes[0].reasons, ['버디']); assert.equal(x.res.holes[0].mult, 2);
  assert.deepEqual(amt(x.res), { a: 30000, b: 0, c: -30000 });
  // 트리플 이상
  x = one({ a: [4], b: [7] });
  assert.deepEqual(x.res.holes[0].reasons, ['트리플']);
  assert.deepEqual(amt(x.res), { a: 30000, b: -30000 });
  // 더블 보기는 파4에서는 민판, 파3에서는 배판
  x = one({ a: [4], b: [6] });
  assert.deepEqual(x.res.holes[0].reasons, []); assert.deepEqual(amt(x.res), { a: 10000, b: -10000 });
  x = one({ a: [3], b: [5] }, { pars: [3].concat(Array(17).fill(4)) });
  assert.deepEqual(x.res.holes[0].reasons, ['파3 더블']); assert.deepEqual(amt(x.res), { a: 20000, b: -20000 });
  x = one({ a: [3], b: [6] }, { pars: [3].concat(Array(17).fill(4)) });
  assert.deepEqual(x.res.holes[0].reasons, ['트리플'], 'a triple on a par 3 is listed as a triple');
  // 세 명 이상 동타
  x = one({ a: [4], b: [4], c: [4], d: [5] });
  assert.deepEqual(x.res.holes[0].reasons, ['동타 3명']);
  assert.deepEqual(amt(x.res), { a: 10000, b: 10000, c: 10000, d: -30000 });
  x = one({ a: [4], b: [4], c: [5], d: [5] });
  assert.deepEqual(x.res.holes[0].reasons, [], 'two pairs are not three of a kind');
  // 여러 조건이 겹쳐도 2배
  x = one({ a: [3], b: [8], c: [8], d: [8] });
  assert.deepEqual(x.res.holes[0].reasons, ['버디', '트리플', '동타 3명']); assert.equal(x.res.holes[0].mult, 2);
  assert.equal(amt(x.res).a, 5 * 5000 * 2 * 3);
  assert.equal(x.res.doubles, 1);
});

test('오장: when everyone ties, the next hole is 배판 (optional)', () => {
  const r = ojRound({ a: [4, 4, 4], b: [4, 5, 5], c: [4, 5, 6] });
  const res = G.ojang(r, { unit: 5000 });
  assert.deepEqual(res.holes[0].reasons, ['동타 3명']);
  assert.deepEqual(res.holes[1].reasons, ['앞 홀 전원 동타']);
  assert.deepEqual(res.holes[2].reasons, [], 'only the hole right after');
  // 2번홀: a가 b, c에게서 1타 × 2배씩, 3번홀: 민판 (a +1 +2, b +1, c −1 −2)
  assert.deepEqual(amt(res), { a: 20000 + 15000, b: -10000 + 0, c: -10000 - 15000 });
  const off = G.ojang(r, { unit: 5000, carry: false });
  assert.deepEqual(off.holes[1].reasons, []);
  assert.deepEqual(amt(off), { a: 10000 + 15000, b: -5000 + 0, c: -5000 - 15000 });
  // 두 명이어도 전원 동타면 다음 홀 배판
  const two = G.ojang(ojRound({ a: [4, 4], b: [4, 5] }), { unit: 5000 });
  assert.deepEqual(two.holes[0].reasons, []); assert.deepEqual(two.holes[1].reasons, ['앞 홀 전원 동타']);
  assert.deepEqual(amt(two), { a: 10000, b: -10000 });
  // 다음 홀을 아직 안 쳤으면 '다음 홀 배판'으로 알려 준다. 건너뛴(입력 안 한) 홀 뒤로는 이어지지 않는다
  const wait = G.ojang(ojRound({ a: [4], b: [4] }), { unit: 5000 });
  assert.equal(wait.nextDouble, 1);
  assert.equal(G.ojang(ojRound({ a: [4], b: [4] }), { unit: 5000, carry: false }).nextDouble, null);
  const gap = G.ojang(ojRound({ a: [4, null, 4], b: [4, null, 5] }), { unit: 5000 });
  assert.deepEqual(gap.holes[2].reasons, []);
  assert.equal(gap.holes[1].played, false);
});

test('오장: par-3 near pays one stroke only with a par or better; 버디값; 니뻐', () => {
  const pars = [3].concat(Array(17).fill(4));
  // 니어 + 파: 타수 차(1타 × 2명) + 니어(1타 × 2명)
  let r = ojRound({ a: [3], b: [4], c: [4] }, { pars, extras: { 0: { nearest: 'a' } } });
  let res = G.ojang(r, { unit: 5000 });
  assert.deepEqual(res.holes[0].near, { pid: 'a', ok: true });
  assert.deepEqual(amt(res), { a: 20000, b: -10000, c: -10000 });
  assert.deepEqual(amt(G.ojang(r, { unit: 5000, near: false })), { a: 10000, b: -5000, c: -5000 }, 'near switched off');
  // 니어를 했지만 보기: 없던 것으로
  r = ojRound({ a: [3], b: [4], c: [4] }, { pars, extras: { 0: { nearest: 'b' } } });
  res = G.ojang(r, { unit: 5000 });
  assert.deepEqual(res.holes[0].near, { pid: 'b', ok: false });
  assert.deepEqual(amt(res), { a: 10000, b: -5000, c: -5000 });
  // 파4의 니어리스트 표시는 오장에서 쓰지 않는다
  r = ojRound({ a: [4], b: [5] }, { extras: { 0: { nearest: 'a' } } });
  assert.equal(G.ojang(r, { unit: 5000 }).holes[0].near, undefined);
  // 니뻐: 배판 + 타수 차 + 니어값 + 버디값 (모두 2배)
  r = ojRound({ a: [2], b: [3], c: [3] }, { pars, extras: { 0: { nearest: 'a' } } });
  res = G.ojang(r, { unit: 5000 });
  assert.deepEqual(res.holes[0].reasons, ['버디']);
  assert.deepEqual(res.holes[0].birdies, ['a']);
  assert.deepEqual(amt(res), { a: 60000, b: -30000, c: -30000 });
  assert.deepEqual(amt(G.ojang(r, { unit: 5000, birdie: false })), { a: 40000, b: -20000, c: -20000 });
  // 버디값은 파4·파5에서도, 이글도 1타
  r = ojRound({ a: [2], b: [4] });
  assert.deepEqual(amt(G.ojang(r, { unit: 5000 })), { a: 2 * 5000 * 2 + 5000 * 2, b: -30000 });
  // 두 사람이 같이 버디: 서로 주고받아 상쇄된다
  r = ojRound({ a: [3], b: [3], c: [4] });
  assert.deepEqual(amt(G.ojang(r, { unit: 5000 })), { a: 10000 + 10000, b: 10000 + 10000, c: -40000 });
});

test('오장: net scores decide the difference, gross scores decide 배판; incomplete holes are skipped', () => {
  const r = ojRound({ a: [4, 3, 4], b: [5, 4, null] });
  r.players[1].hcp = 18; // 홀마다 1타
  const res = G.ojang(r, { unit: 5000, net: true });
  assert.equal(res.net, true);
  assert.deepEqual(res.holes[0].reasons, []);
  assert.deepEqual(res.holes[1].reasons, ['버디'], 'the birdie is judged on the real score');
  assert.equal(res.holes[2].played, false);
  // 1번홀: 네트 동타 → 0. 2번홀: 네트 동타 → 타수 차 0, 버디값 1타 × 2배
  assert.deepEqual(amt(res), { a: 10000, b: -10000 });
  assert.deepEqual(amt(G.ojang(r, { unit: 5000 })), { a: 5000 + 10000 + 10000, b: -25000 });
  assert.equal(G.ojang(ojRound({ a: [4] }), { unit: 5000 }).error, '플레이어가 2명 이상 필요합니다');
});

test('오장 through computeAll: counted only when switched on, zero-sum, works with the double-par cap', () => {
  const sc = { a: [], b: [], c: [], d: [] };
  for (let h = 0; h < 18; h++) { sc.a.push(3 + (h % 3)); sc.b.push(4 + (h % 4)); sc.c.push(4); sc.d.push(h % 5 === 0 ? 12 : 5); }
  const r = ojRound(sc, { games: { ojang: { enabled: false, unit: 5000 } }, extras: { 2: { nearest: 'c' } } });
  let all = G.computeAll(r);
  assert.equal(all.ojang.enabled, false);
  assert.ok(all.ojang.rows.some((x) => x.amount !== 0), 'always calculated');
  assert.ok(!all.transfers.some((t) => t.game === 'ojang'), 'but not in the settlement while off');
  r.games.ojang.enabled = true;
  all = G.computeAll(r);
  assert.ok(all.transfers.some((t) => t.game === 'ojang'));
  assert.equal(all.settlement.rows.reduce((s, x) => s + x.net, 0), 0);
  assert.equal(all.ojang.rows.reduce((s, x) => s + x.amount, 0), 0);
  const before = all.ojang.rows.find((x) => x.id === 'd').amount;
  r.games.stroke = { cap: true };
  const capped = G.computeAll(r).ojang.rows.find((x) => x.id === 'd').amount;
  assert.ok(capped > before, 'a 12 counted as 8 costs less: ' + before + ' → ' + capped);
});
