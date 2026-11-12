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

// ───────────────────────── 스킨스 공금 방식 · OECD 벌금 · 캐디피 ─────────────────────────
function oecdRound(scores, stats, opts) {
  const pad = (a) => a.concat(Array(18 - a.length).fill(null));
  const players = Object.keys(scores).map((id) => ({ id, name: id.toUpperCase(), hcp: 0, team: '' }));
  const sc = {}; Object.keys(scores).forEach((id) => { sc[id] = pad(scores[id]); });
  return mkRound(players, sc, Object.assign({ pars: Array(18).fill(4), stats: stats || {} }, opts || {}));
}
const netOf = (res, r) => Object.fromEntries(G.settle(res.transfers, r.players).rows.map((x) => [x.id, x.net]));
const skinsOf = (res) => Object.fromEntries(res.entrants.map((e) => [e.id, e.skins]));
const finalOf = (res) => Object.fromEntries(res.entrants.map((e) => [e.id, e.final]));
const FUND = { mode: 'individual', fund: true, stake: 100000, prize: 20000, start: 10000, tip: 10000, caddie: 150000, fine: 10000 };

test('OECD faults come from the detail stats and the gross score', () => {
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

test('skins fund: stakes make the fund, start hand-outs and hole prizes come out, the caddie fee is paid from what is left', () => {
  // a wins holes 1 and 2, hole 3 is tied, b wins hole 4 with the carried skin
  const r = oecdRound({ a: [3, 3, 4, 5], b: [4, 4, 4, 4], c: [4, 4, 4, 5], d: [5, 5, 5, 5] });
  const res = G.skins(r, FUND);
  assert.deepEqual(res.fund, { stake: 100000, prize: 20000, start: 10000, tip: 10000, caddie: 150000, fine: 10000, oecd: false, join: 0, players: 4,
    total: 400000, startOut: 50000, paid: 80000, fines: 0, left: 270000, rest: 120000, share: 30000, even: true, caddieTotal: 160000, collect: false, cash: 0, caddieDue: 160000 });
  assert.deepEqual(skinsOf(res), { a: 2, b: 2, c: 0, d: 0 });
  assert.equal(res.holes[3].amount, 40000, 'a carried skin doubles the prize');
  const e = Object.fromEntries(res.entrants.map((x) => [x.id, x]));
  assert.deepEqual([e.a.take, e.b.take, e.c.take, e.d.take], [50000, 50000, 10000, 10000], 'took = start hand-out + prizes');
  // 최종 = 받은 돈 − 낸 돈 + 남는 돈의 1/4
  assert.deepEqual(finalOf(res), { a: -20000, b: -20000, c: -60000, d: -60000 });
  // 사람들의 합은 캐디가 가져간 돈만큼 마이너스다. 송금 정리에는 캐디가 받는 쪽으로 나오고 손익 표에는 없다
  const s = G.settle(res.transfers, r.players);
  assert.deepEqual(Object.fromEntries(s.rows.map((x) => [x.id, x.net])), finalOf(res));
  assert.equal(s.rows.length, 4);
  assert.equal(s.rows.reduce((t, x) => t + x.net, 0), -160000);
  assert.ok(s.payments.every((p) => p.to === '#caddie' && p.from.charAt(0) !== '#'), 'everyone owes, so every payment goes to the caddie');
  assert.equal(s.payments.reduce((t, p) => t + p.amount, 0), 160000);
  // 공금 방식이 아니면 예전 그대로: 스킨 하나에 다른 사람 각각이 단가를 준다
  const plain = G.skins(r, { mode: 'individual', unit: 1000 });
  assert.equal(plain.fund, null);
  assert.deepEqual(netOf(plain, r), { a: 4000, b: 4000, c: -4000, d: -4000 });
  // 설정값이 이상해도 0으로 본다
  const zero = G.skins(r, { mode: 'individual', fund: true, stake: -5, prize: 'x', start: null, tip: undefined, caddie: NaN });
  assert.deepEqual([zero.fund.total, zero.fund.paid, zero.fund.caddieTotal, zero.fund.share], [0, 0, 0, 0]);
  assert.deepEqual(zero.transfers, []);
});

test('skins fund: money left over is handed back equally; a shortage is shared equally; unwon skins stay in the fund', () => {
  // 캐디피가 없으면 남은 돈을 똑같이 돌려받는다 → 합이 0
  const r = oecdRound({ a: [3, 3], b: [4, 4] });
  let res = G.skins(r, Object.assign({}, FUND, { start: 0, tip: 0, caddie: 0 }));
  assert.deepEqual([res.fund.left, res.fund.rest, res.fund.share], [160000, 160000, 80000]);
  assert.deepEqual(finalOf(res), { a: 20000, b: -20000 });
  assert.deepEqual(netOf(res, r), { a: 20000, b: -20000 });
  // 두 명이 10만씩인데 캐디피 15만 + 시작 지급 3만: 모자란 돈을 반씩 낸다
  res = G.skins(r, FUND);
  assert.deepEqual([res.fund.total, res.fund.startOut, res.fund.paid, res.fund.left, res.fund.rest, res.fund.share], [200000, 30000, 40000, 130000, -20000, -10000]);
  assert.deepEqual(finalOf(res), { a: 10000 + 40000 - 100000 - 10000, b: 10000 - 100000 - 10000 });
  assert.equal(netOf(res, r).a + netOf(res, r).b, -160000);
  // 상금이 공금보다 많이 나가도(18홀 × 2만 > 20만) 모자란 만큼 나눠 낸다
  const full = oecdRound({ a: Array(18).fill(3), b: Array(18).fill(4) });
  res = G.skins(full, Object.assign({}, FUND, { start: 0, tip: 0, caddie: 0 }));
  assert.deepEqual([res.fund.paid, res.fund.left, res.fund.share], [360000, -160000, -80000]);
  assert.deepEqual(finalOf(res), { a: 360000 - 100000 - 80000, b: -100000 - 80000 });
  // 마지막 홀까지 비겨서 못 가져간 스킨의 상금은 공금에 남는다
  const tied = oecdRound({ a: Array(18).fill(4), b: Array(18).fill(4) });
  res = G.skins(tied, Object.assign({}, FUND, { start: 0, tip: 0, caddie: 0 }));
  assert.equal(res.carry, 18); assert.equal(res.fund.paid, 0);
  assert.deepEqual(finalOf(res), { a: 0, b: 0 });
  // 팀전은 공금 방식을 쓰지 않는다
  const tr = mkRound([{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'A' }, { id: 'c', name: 'C', team: 'B' }, { id: 'd', name: 'D', team: 'B' }],
    { a: [3], b: [5], c: [4], d: [4] }, { holes: 9 });
  res = G.skins(tr, Object.assign({}, FUND, { mode: 'team', unit: 1000, oecd: true }));
  assert.equal(res.fund, null);
  assert.deepEqual(netOf(res, tr), { a: 1000, b: 1000, c: -1000, d: -1000 });
});

test('skins fund OECD: a player who has the stake back pays a fine into the fund for each fault, from the next hole on', () => {
  // a wins holes 1-5: after 4 skins a holds 90,000 (not yet), after 5 holds 110,000 (member from hole 6)
  const r = oecdRound({ a: [3, 3, 3, 3, 3, 5, 5], b: [4, 4, 4, 4, 4, 4, 4], c: [4, 4, 4, 4, 4, 5, 5], d: [5, 5, 5, 5, 5, 5, 5] },
    { a: { 3: { ob: 1 }, 4: { ob: 1, bk: 1 }, 5: { ob: 1, pt: 3 }, 6: { hz: 2 } }, b: { 5: { ob: 1 } } });
  const res = G.skins(r, Object.assign({ oecd: true }, FUND));
  assert.equal(res.holes[3].oecd, undefined, 'below the stake: no fine');
  assert.equal(res.holes[4].oecd, undefined, 'the hole on which the stake is recovered is still free');
  assert.deepEqual(res.holes[5].oecd, [{ id: 'a', name: 'A', faults: ['ob', 'pt3'], labels: ['OB', '3퍼트'], fine: 20000 }]);
  assert.equal(res.holes[5].winner, 'b');
  // 벌금을 내고 90,000이 되어 기준 아래로 내려갔다 → 7번홀의 해저드는 벌금이 없다
  assert.equal(res.holes[6].oecd, undefined);
  const e = Object.fromEntries(res.entrants.map((x) => [x.id, x]));
  assert.deepEqual([e.a.prize, e.a.fines, e.a.take, e.a.oecd], [100000, 20000, 90000, false]);
  assert.deepEqual([e.b.prize, e.b.fines, e.b.oecd], [40000, 0, false], 'b never had the stake back, so its OB cost nothing');
  assert.deepEqual([res.fund.paid, res.fund.fines, res.fund.left, res.fund.rest, res.fund.share], [140000, 20000, 230000, 80000, 20000]);
  assert.deepEqual(finalOf(res), { a: 90000 - 100000 + 20000, b: 50000 - 100000 + 20000, c: 10000 - 100000 + 20000, d: 10000 - 100000 + 20000 });
  assert.equal(Object.values(netOf(res, r)).reduce((t, v) => t + v, 0), -160000);
  // OECD를 끄면 벌금이 없다
  const off = G.skins(r, FUND);
  assert.ok(off.holes.every((h) => !h.oecd)); assert.equal(off.fund.fines, 0);
  // 벌금 0원이면 걸려도 낼 것이 없다
  assert.equal(G.skins(r, Object.assign({ oecd: true }, FUND, { fine: 0 })).fund.fines, 0);
});

test('skins fund OECD with a joining amount: prize money of 60,000 (start hand-out not counted) makes a member from the next hole', () => {
  // a wins holes 1-3 (60,000 in prizes). Faults: hole 3 OB (not yet a member), hole 4 OB + bunker, hole 5 hazard, hole 6 3-putt
  const r = oecdRound({ a: [3, 3, 3, 5, 5, 3, 5], b: [4, 4, 4, 4, 4, 4, 4], c: [4, 4, 4, 5, 5, 4, 5], d: [5, 5, 5, 5, 5, 5, 5] },
    { a: { 2: { ob: 1 }, 3: { ob: 1, bk: 1 }, 4: { hz: 1 }, 5: { pt: 3 }, 6: { ob: 1 } }, b: { 3: { ob: 1 }, 4: { ob: 1 } } });
  const res = G.skins(r, Object.assign({ oecd: true, join: 60000 }, FUND));
  assert.equal(res.fund.join, 60000);
  assert.equal(res.holes[1].oecd, undefined);
  assert.equal(res.holes[2].oecd, undefined, 'the hole on which the amount is reached is still free (40,000 before it)');
  assert.deepEqual(res.holes[3].oecd, [{ id: 'a', name: 'A', faults: ['ob', 'bk'], labels: ['OB', '벙커'], fine: 20000 }], 'member from the next hole: 60,000 in prizes, although 70,000 is still below the stake');
  // 벌금 2만을 내서 상금 − 벌금이 4만이 됐다 → 5번홀의 해저드는 벌금이 없다 (b는 4·5번홀을 이겼지만 그 홀들을 시작할 때는 0원·2만이라 OB에 벌금이 없다)
  assert.equal(res.holes[4].oecd, undefined, 'below the amount again after the fine: no fine until it is filled again');
  assert.equal(res.holes[4].winner, 'b');
  // 6번홀: a가 이겨 다시 6만 → 그 홀의 3퍼트는 아직 벌금이 없고, 7번홀의 OB부터 벌금
  assert.equal(res.holes[5].winner, 'a'); assert.equal(res.holes[5].oecd, undefined);
  assert.deepEqual(res.holes[6].oecd, [{ id: 'a', name: 'A', faults: ['ob'], labels: ['OB'], fine: 10000 }]);
  const e = Object.fromEntries(res.entrants.map((x) => [x.id, x]));
  assert.deepEqual([e.a.prize, e.a.fines, e.a.take, e.a.oecd], [80000, 30000, 60000, false], 'take includes the start hand-out; membership looks at prize − fines = 50,000');
  assert.equal(res.holes[6].winner, 'b');
  assert.deepEqual([e.b.prize, e.b.fines, e.b.oecd], [60000, 0, true], 'b reaches 60,000 on the last hole played: a member from the next hole on');
  assert.deepEqual([res.fund.paid, res.fund.fines], [140000, 30000]);
  // 가입 기준이 없으면(예전 라운드) 본전 기준 그대로: a는 가진 돈이 10만에 못 미쳐 한 번도 가입하지 않는다
  const old = G.skins(r, Object.assign({ oecd: true }, FUND));
  assert.equal(old.fund.join, 0); assert.equal(old.fund.fines, 0); assert.ok(old.holes.every((h) => !h.oecd));
  assert.equal(G.skins(r, Object.assign({ oecd: true, join: 0 }, FUND)).fund.fines, 0, 'join 0 is the old rule');
  assert.equal(G.skins(r, Object.assign({ oecd: true, join: 'x' }, FUND)).fund.fines, 0, 'a value that is not an amount is the old rule');
  // OECD를 끄면 가입 기준이 있어도 벌금이 없다
  assert.equal(G.skins(r, Object.assign({ join: 60000 }, FUND)).fund.fines, 0);
});

test('skins fund OECD with a joining amount: exactly the amount joins, one won below does not; the start hand-out and the stake do not matter', () => {
  const r = oecdRound({ a: [3, 3, 3, 5], b: [4, 4, 4, 4], c: [4, 4, 4, 5] }, { a: { 3: { ob: 1 } } });
  const fineOf = (opt) => G.skins(r, Object.assign({ oecd: true }, FUND, opt)).fund.fines;
  assert.equal(fineOf({ join: 60000 }), 10000);
  assert.equal(fineOf({ join: 60001 }), 0);
  assert.equal(fineOf({ join: 59999 }), 10000);
  assert.equal(fineOf({ join: 60000, start: 0 }), 10000, 'the start hand-out is not part of the amount');
  assert.equal(fineOf({ join: 60000, start: 50000 }), 10000);
  assert.equal(fineOf({ join: 70000, start: 50000 }), 0, 'a large start hand-out does not make a member');
  assert.equal(fineOf({ join: 60000, stake: 0, caddie: 0, tip: 0, start: 0 }), 10000, 'the stake does not matter either');
  assert.equal(fineOf({ join: 60000, prize: 10000 }), 0, 'three skins at 10,000 are 30,000');
  // 가진 돈보다 많이 내지 않는다: 벌금 50만이어도 시작 지급 + 상금 = 7만까지만
  assert.equal(fineOf({ join: 60000, fine: 500000 }), 70000);
  // 이월된 스킨은 상금도 여러 배다: 두 홀 동타 뒤 한 번 이기면 6만
  const r2 = oecdRound({ a: [4, 4, 3, 5], b: [4, 4, 4, 4], c: [4, 4, 4, 5] }, { a: { 3: { hz: 1 } } });
  const res2 = G.skins(r2, Object.assign({ oecd: true, join: 60000 }, FUND));
  assert.equal(res2.holes[2].amount, 60000);
  assert.deepEqual(res2.holes[3].oecd.map((o) => [o.id, o.fine]), [['a', 10000]]);
  // 팀전은 공금 방식이 아니므로 가입 기준이 있어도 벌금이 없다
  const tr = mkRound([{ id: 'a', name: 'A', hcp: 0, team: 'A' }, { id: 'b', name: 'B', hcp: 0, team: 'B' }], { a: [3, 3, 3, 5].concat(Array(14).fill(null)), b: [4, 4, 4, 4].concat(Array(14).fill(null)) }, { pars: Array(18).fill(4), stats: { a: { 3: { ob: 1 } } } });
  const tres = G.skins(tr, Object.assign({}, FUND, { mode: 'team', unit: 1000, oecd: true, join: 60000 }));
  assert.equal(tres.fund, null); assert.ok(tres.holes.every((h) => !h.oecd));
});

test('skins fund OECD with a joining amount follows the play order and goes through computeAll', () => {
  // 10번홀 출발: 10~12번홀을 이겨 6만 → 그다음에 친 13번홀부터 벌금 대상. 1번홀의 OB는 18번홀까지 친 뒤라 벌금
  // (홀 번호 순으로 세면 1번홀은 가입 전이라 벌금이 없다: 두 순서의 결과가 달라야 순서를 따르는지 알 수 있다)
  const sc = { a: Array(18).fill(4), b: Array(18).fill(5), c: Array(18).fill(5) };
  [9, 10, 11].forEach((h) => { sc.a[h] = 3; });
  for (let h = 0; h < 18; h++) if (![9, 10, 11].includes(h)) { sc.a[h] = 5; }
  const r = mkRound([{ id: 'a', name: 'A', hcp: 0, team: '' }, { id: 'b', name: 'B', hcp: 0, team: '' }, { id: 'c', name: 'C', hcp: 0, team: '' }], sc,
    { pars: Array(18).fill(4), stats: { a: { 0: { ob: 1 } } } });
  const back = [9, 10, 11, 12, 13, 14, 15, 16, 17, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  const opt = Object.assign({ oecd: true, join: 60000 }, FUND);
  const inOrder = G.skins(r, Object.assign({ order: back }, opt));
  assert.deepEqual(inOrder.holes.filter((h) => h.oecd).map((h) => [h.hole, h.oecd[0].fine]), [[0, 10000]], 'hole 1 is played after hole 18, when a is a member');
  const natural = G.skins(r, opt);
  assert.deepEqual(natural.holes.filter((h) => h.oecd).map((h) => h.hole), [], 'in hole-number order hole 1 comes before joining');
  r.games = { skins: Object.assign({ enabled: true, playorder: true }, opt) };
  const all = G.computeAll(r, { order: back });
  assert.equal(all.skins.fund.join, 60000); assert.equal(all.skins.fund.fines, 10000, 'computeAll hands the play order to skins');
  assert.equal(all.settlement.rows.reduce((t, x) => t + x.net, 0), -(all.skins.fund.caddieTotal));
  r.games.skins.playorder = false;
  assert.equal(G.computeAll(r, { order: back }).skins.fund.fines, 0, 'a round without the playorder stamp keeps hole-number order');
});

test('skins fund OECD: a fine never exceeds what the player holds; ties and unplayed holes', () => {
  // 낸 돈 2만, 상금 2만: 한 번 이기면 가입. 벌금 5만이어도 가진 돈(2만)까지만 낸다
  const r = oecdRound({ a: [3, 8, 4], b: [4, 8, null], c: [4, 8, 4] }, { a: { 1: { ob: 1, bk: 1 }, 2: { ob: 1 } } });
  const res = G.skins(r, { mode: 'individual', fund: true, stake: 20000, prize: 20000, fine: 50000, oecd: true });
  assert.deepEqual(res.holes[1].oecd[0].faults, ['ob', 'bk', 'tri']);
  assert.equal(res.holes[1].oecd[0].fine, 20000);
  assert.equal(res.holes[1].tie, true);
  assert.equal(res.holes[2].played, false); assert.equal(res.holes[2].oecd, undefined, 'a hole that is not fully entered is not judged');
  assert.deepEqual([res.fund.total, res.fund.paid, res.fund.fines, res.fund.left], [60000, 20000, 20000, 60000]);
  assert.deepEqual(finalOf(res), { a: 0 - 20000 + 20000, b: -20000 + 20000, c: -20000 + 20000 });
});

test('skins fund collected up front: profit and loss stay the same, the payments hand out what is in the envelope', () => {
  const r = oecdRound({ a: [3, 3, 3, 3, 3, 5], b: [4, 4, 4, 4, 4, 4], c: [4, 4, 4, 4, 4, 5], d: [5, 5, 5, 5, 5, 5] }, { a: { 5: { ob: 1, pt: 3 } } });
  r.games = { skins: Object.assign({ enabled: true, oecd: true }, FUND) };
  const off = G.computeAll(r);
  r.games.skins.collect = true;
  const on = G.computeAll(r);
  // 손익은 걷었든 안 걷었든 같다
  assert.deepEqual(on.settlement.rows, off.settlement.rows);
  assert.deepEqual(finalOf(on.skins), { a: 15000, b: -45000, c: -65000, d: -65000 });
  // 걷어 둔 돈 = 공금 − 시작 지급. 끝나고 줄 돈 = 상금 − 벌금 + 남는 돈의 1/4, 캐디에게는 캐디피만
  assert.deepEqual([on.skins.fund.collect, on.skins.fund.cash, on.skins.fund.caddieDue], [true, 350000, 150000]);
  assert.deepEqual(Object.fromEntries(on.skins.entrants.map((e) => [e.id, e.due])), { a: 105000, b: 45000, c: 25000, d: 25000 });
  assert.deepEqual(Object.fromEntries(off.skins.entrants.map((e) => [e.id, e.due])), finalOf(off.skins), 'not collected: what is due is the profit or loss itself');
  assert.deepEqual([off.skins.fund.collect, off.skins.fund.cash, off.skins.fund.caddieDue, off.skins.payout], [false, 0, 160000, undefined]);
  const pay = Object.fromEntries(on.settlement.payments.map((p) => [p.from + '>' + p.to, p.amount]));
  assert.deepEqual(pay, { '#pot>#caddie': 150000, '#pot>a': 105000, '#pot>b': 45000, '#pot>c': 25000, '#pot>d': 25000 });
  // 송금 줄은 장부의 "끝나고 나눌 돈"과 같은 순서다: 받을 사람들, 그다음 캐디피
  assert.deepEqual(on.settlement.payments.map((p) => p.from + '>' + p.to), ['#pot>a', '#pot>b', '#pot>c', '#pot>d', '#pot>#caddie']);
  assert.ok(on.settlement.payments.every((p) => p.fixed === true));
  assert.equal(on.settlement.payments.reduce((t, p) => t + p.amount, 0), 350000, 'exactly the money in the envelope is handed out');
  // 모자랄 때: 봉투의 돈은 캐디피와 딴 사람에게 가고, 모자란 만큼은 못 딴 사람이 더 낸다
  r.games.skins.caddie = 300000;
  const short = G.computeAll(r);
  assert.deepEqual(Object.fromEntries(short.skins.entrants.map((e) => [e.id, e.due])), { a: 67500, b: 7500, c: -12500, d: -12500 });
  const bal = {};
  short.settlement.payments.forEach((p) => { bal[p.from] = (bal[p.from] || 0) - p.amount; bal[p.to] = (bal[p.to] || 0) + p.amount; });
  assert.deepEqual(bal, { '#pot': -350000, '#caddie': 300000, a: 67500, b: 7500, c: -12500, d: -12500 });
  // 더 낼 사람은 다른 사람이 아니라 공금에 내고, 캐디피는 전부 공금에서 나간다 (장부의 "더 내요"와 같은 줄)
  assert.deepEqual(short.settlement.payments.map((p) => [p.from + '>' + p.to, p.amount]),
    [['#pot>a', 67500], ['#pot>b', 7500], ['c>#pot', 12500], ['d>#pot', 12500], ['#pot>#caddie', 300000]]);
  // 다른 게임(오장)과 합쳐도 송금 뒤에는 모두의 잔액이 맞는다
  r.games.skins.caddie = 150000; r.games.ojang = { enabled: true, unit: 1000 };
  const both = G.computeAll(r);
  const want = { '#pot': -350000, '#caddie': 150000 };
  both.settlement.rows.forEach((x) => { want[x.id] = x.net + 100000 - 10000; });
  const got = {};
  both.settlement.payments.forEach((p) => { got[p.from] = (got[p.from] || 0) - p.amount; got[p.to] = (got[p.to] || 0) + p.amount; });
  Object.keys(want).forEach((k) => assert.equal(got[k] || 0, want[k], k));
  // 공금 줄은 다른 게임이 있어도 그대로이고(장부와 같다), 다른 게임의 돈은 플레이어끼리만 오간다
  const strip = (list) => list.map((p) => [p.from + '>' + p.to, p.amount]);
  assert.deepEqual(strip(both.settlement.payments.filter((p) => p.fixed)), strip(on.settlement.payments));
  const others = both.settlement.payments.filter((p) => !p.fixed);
  assert.ok(others.length > 0 && others.every((p) => p.from.charAt(0) !== '#' && p.to.charAt(0) !== '#'));
  const ojangNet = {};
  others.forEach((p) => { ojangNet[p.from] = (ojangNet[p.from] || 0) - p.amount; ojangNet[p.to] = (ojangNet[p.to] || 0) + p.amount; });
  both.ojang.rows.forEach((x) => assert.equal(ojangNet[x.id] || 0, x.amount, 'the other lines settle the 오장 money alone'));
  // 공금 방식이 꺼져 있거나 팀전이면 '미리 걷음'은 아무 일도 하지 않는다
  r.games.ojang.enabled = false; r.games.skins.fund = false;
  const plain = G.computeAll(r);
  assert.equal(plain.skins.payout, undefined); assert.ok(plain.settlement.payments.every((p) => p.from.charAt(0) !== '#' && p.to.charAt(0) !== '#'));
  // settle: 줄이 정해진 게임은 그 줄 그대로 내고, 나머지 게임만 최소 횟수로 정리한다. 손익은 모든 게임의 합이다
  const two = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const st = G.settle([{ from: 'a', to: '#pot', amount: 5000, game: 'f' }, { from: '#pot', to: 'b', amount: 5000, game: 'f' }, { from: 'b', to: 'a', amount: 2000, game: 'x' }], two,
    { game: 'f', payments: [{ from: '#pot', to: 'b', amount: 3000 }] });
  assert.deepEqual(st.rows.map((x) => [x.id, x.net]), [['b', 3000], ['a', -3000]]);
  assert.deepEqual(st.payments, [{ from: '#pot', to: 'b', amount: 3000, fixed: true }, { from: 'b', to: 'a', amount: 2000 }]);
  assert.deepEqual(G.settle([{ from: 'a', to: 'b', amount: 5000, game: 'x' }], two).payments, [{ from: 'a', to: 'b', amount: 5000 }]);
  // 금액이 같은 사람끼리는 플레이어 순서로 짝을 짓는다 (송금이 적힌 순서가 아니다). 예전 기록의 송금 줄이 그대로 나오게 하는 약속이다
  const three = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  assert.deepEqual(G.settle([{ from: 'c', to: 'a', amount: 1000, game: 'x' }, { from: 'b', to: 'a', amount: 1000, game: 'x' }], three).payments,
    [{ from: 'b', to: 'a', amount: 1000 }, { from: 'c', to: 'a', amount: 1000 }]);
});

test('skins fund collected up front: a player who owes pays the fund, exactly as the ledger says (skins 9 / 6 / 3 / 0)', () => {
  // 기본 금액. a가 1~9번홀, b가 10~15번홀, c가 16~18번홀을 이긴다. 공금은 160,000원 모자라 1인당 40,000원
  const win = (from, to) => Array.from({ length: 18 }, (_, h) => (h >= from && h <= to ? 3 : 4));
  const r = oecdRound({ a: win(0, 8), b: win(9, 14), c: win(15, 17), d: Array(18).fill(4) });
  r.games = { skins: Object.assign({ enabled: true, collect: true }, FUND) };
  const all = G.computeAll(r);
  assert.deepEqual(skinsOf(all.skins), { a: 9, b: 6, c: 3, d: 0 });
  assert.deepEqual(Object.fromEntries(all.skins.entrants.map((e) => [e.id, e.due])), { a: 140000, b: 80000, c: 20000, d: -40000 });
  assert.deepEqual(all.settlement.payments.map((p) => [p.from + '>' + p.to, p.amount]),
    [['#pot>a', 140000], ['#pot>b', 80000], ['#pot>c', 20000], ['d>#pot', 40000], ['#pot>#caddie', 150000]]);
  // 봉투: 걷어 둔 350,000 + 더 낸 40,000 = 나눠 준 240,000 + 캐디피 150,000
  const pot = all.settlement.payments.reduce((t, p) => t + (p.to === '#pot' ? p.amount : p.from === '#pot' ? -p.amount : 0), 0);
  assert.equal(all.skins.fund.cash + pot, 0);
  // 오장을 함께 해도 공금 줄은 그대로이고 캐디피는 전부 공금에서 나간다
  r.games.ojang = { enabled: true, unit: 5000 };
  const both = G.computeAll(r);
  assert.deepEqual(both.settlement.payments.filter((p) => p.fixed).map((p) => [p.from + '>' + p.to, p.amount]),
    [['#pot>a', 140000], ['#pot>b', 80000], ['#pot>c', 20000], ['d>#pot', 40000], ['#pot>#caddie', 150000]]);
  assert.ok(both.settlement.payments.filter((p) => !p.fixed).every((p) => p.from.charAt(0) !== '#' && p.to.charAt(0) !== '#'));
  assert.deepEqual(both.settlement.payments.filter((p) => p.to === '#caddie').map((p) => [p.from, p.amount]), [['#pot', both.skins.fund.caddieDue]]);
});

test('skins fund collected up front needs money to collect: a stake that does not cover the start hand-outs is settled as not collected', () => {
  const r = oecdRound({ a: [3, 4, 4], b: [4, 4, 3], c: [4, 4, 4], d: [4, 4, 4] });
  [0, 10000, 12000].forEach((stake) => {
    // 4명: 걷는 돈 0 / 40,000 / 48,000원, 시작 지급 50,000원
    r.games = { skins: Object.assign({ enabled: true }, FUND, { stake, collect: false }) };
    const off = G.computeAll(r);
    r.games.skins.collect = true;
    const on = G.computeAll(r);
    assert.deepEqual([on.skins.fund.collect, on.skins.fund.cash, on.skins.payout], [false, 0, undefined], 'stake ' + stake);
    assert.deepEqual(on.settlement, off.settlement, 'stake ' + stake);
    assert.ok(on.settlement.payments.every((p) => p.from !== '#pot' && p.to !== '#pot'), 'stake ' + stake);
  });
  // 걷는 돈이 시작 지급보다 많아지면 다시 적용된다 (4명 × 13,000 = 52,000 > 50,000)
  r.games.skins.stake = 13000;
  const ok = G.computeAll(r);
  assert.deepEqual([ok.skins.fund.collect, ok.skins.fund.cash], [true, 2000]);
});

test('play order: a round that starts on hole 10 carries skins, OECD membership and the 오장 all-square rule from 18 to 1', () => {
  const back = [9, 10, 11, 12, 13, 14, 15, 16, 17, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  // 스킨스: 18번홀 동타 → 1번홀로 이월 (홀 번호 순이면 이월이 사라진다)
  const sc = { a: Array(18).fill(null), b: Array(18).fill(null) };
  sc.a[17] = 4; sc.b[17] = 4; sc.a[0] = 3; sc.b[0] = 4;
  const r = mkRound([{ id: 'a', name: 'A', hcp: 0 }, { id: 'b', name: 'B', hcp: 0 }], sc, { pars: Array(18).fill(4) });
  assert.equal(G.skins(r, { mode: 'individual', unit: 1000, order: back }).holes[0].skins, 2);
  assert.equal(G.skins(r, { mode: 'individual', unit: 1000 }).holes[0].skins, 1);
  assert.equal(G.skins(r, { mode: 'individual', unit: 1000, order: back }).holes.length, 18);
  // 오장: 18번홀 전원 동타 → 1번홀이 배판
  assert.deepEqual(G.ojang(r, { unit: 5000, order: back }).holes[0].reasons, ['버디', '앞 홀 전원 동타']);
  assert.deepEqual(G.ojang(r, { unit: 5000 }).holes[0].reasons, ['버디']);
  // 아직 안 친 홀의 '배판 예정' 표시는 홀마다 붙는다 (앞쪽에 빈 홀이 있어도)
  const sc2 = { a: Array(18).fill(null), b: Array(18).fill(null) };
  [1, 6].forEach((h) => { sc2.a[h] = 4; sc2.b[h] = 4; });
  sc2.a[2] = 4; // 3번홀은 한 사람만 입력
  const oj = G.ojang(mkRound([{ id: 'a', name: 'A', hcp: 0 }, { id: 'b', name: 'B', hcp: 0 }], sc2, { pars: Array(18).fill(4) }), { unit: 5000 });
  assert.equal(oj.holes[2].pendingDouble, true); assert.equal(oj.holes[7].pendingDouble, true); assert.equal(oj.holes[3].pendingDouble, false);
  assert.equal(oj.nextDouble, 2);
  // OECD: 후반(10~18번)에 본전을 찾은 사람은 그 뒤에 치는 1번홀부터 벌금 대상
  const sc3 = { a: Array(18).fill(null), b: Array(18).fill(null) };
  for (let h = 9; h < 18; h++) { sc3.a[h] = 3; sc3.b[h] = 4; }
  sc3.a[0] = 4; sc3.b[0] = 4;
  const r3 = mkRound([{ id: 'a', name: 'A', hcp: 0 }, { id: 'b', name: 'B', hcp: 0 }], sc3, { pars: Array(18).fill(4), stats: { a: { 0: { ob: 1 } } } });
  const o = Object.assign({ oecd: true }, FUND);
  assert.deepEqual(G.skins(r3, Object.assign({ order: back }, o)).holes[0].oecd.map((x) => x.fine), [10000]);
  assert.equal(G.skins(r3, o).holes[0].oecd, undefined, 'in hole-number order hole 1 comes before the skins were won');
  // computeAll이 순서를 넘겨 준다 (스킨스는 playorder 표시가 있는 라운드만). 잘못된 순서는 홀 번호 순으로 대신한다
  r.games = { skins: { enabled: true, unit: 1000, mode: 'individual', playorder: true } };
  assert.equal(G.computeAll(r, { order: back }).skins.holes[0].skins, 2);
  assert.equal(G.computeAll(r).skins.holes[0].skins, 1);
  assert.equal(G.computeAll(r, { order: [0, 0, 1] }).skins.holes[0].skins, 1);
  assert.equal(G.computeAll(r, { order: back.concat([18]) }).skins.holes[0].skins, 1);
});

test('오장: review cases — three of four tying does not carry, near is judged on the real score', () => {
  // 네 명 중 세 명 동타: 그 홀은 배판이지만 '전원 동타'가 아니므로 다음 홀은 민판
  const r = ojRound({ a: [4, 4], b: [4, 5], c: [4, 4], d: [5, 4] });
  const res = G.ojang(r, { unit: 5000 });
  assert.deepEqual(res.holes[0].reasons, ['동타 3명']);
  assert.deepEqual(res.holes[1].reasons, ['동타 3명'], 'no carry reason');
  assert.equal(res.holes[1].reasons.includes('앞 홀 전원 동타'), false);
  // 네트를 켜도 니어는 실제 타수가 파 이하여야 한다
  const n = ojRound({ a: [4], b: [3] }, { pars: [3].concat(Array(17).fill(4)), extras: { 0: { nearest: 'a' } } });
  n.players[0].hcp = 18;
  const nr = G.ojang(n, { unit: 5000, net: true });
  assert.deepEqual(nr.holes[0].near, { pid: 'a', ok: false });
  // 라운드에 없는 사람이 니어로 적혀 있으면 무시
  const g = ojRound({ a: [3], b: [3] }, { pars: [3].concat(Array(17).fill(4)), extras: { 0: { nearest: 'zz' } } });
  assert.equal(G.ojang(g, { unit: 5000 }).holes[0].near, undefined);
  // 결과는 금액이 큰 순서
  assert.deepEqual(res.rows.map((x) => x.amount), res.rows.map((x) => x.amount).slice().sort((x, y) => y - x));
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
  const res = G.skins(r, { mode: 'individual', fund: true, stake: 20000, prize: 20000, fine: 5000, oecd: true });
  assert.deepEqual(res.holes[1].oecd.map((o) => o.fine), [5000]);
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

test('nearest only on par 3 and longest only on par 5: entries on other holes are left out when the rule is on', () => {
  const players = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase() }));
  // 1번홀 파4, 2번홀 파3, 3번홀 파5
  const r = mkRound(players, { a: [4, 3, 5], b: [4, 3, 5], c: [4, 3, 5] },
    { holes: 9, pars: [4, 3, 5, 4, 4, 4, 4, 4, 4], extras: { 0: { nearest: 'a', longest: 'b' }, 1: { nearest: 'b', longest: 'c' }, 2: { nearest: 'c', longest: 'a' } } });
  const cnt = (res, f) => Object.fromEntries(Object.keys(res.counts).map((id) => [id, res.counts[id][f]]));
  const netOfBonus = (res) => Object.fromEntries(G.settle(res.transfers, r.players).rows.map((x) => [x.id, x.net]));
  // 규칙이 꺼져 있으면(예전에 만든 라운드) 어느 홀에 적었든 그대로 센다
  const free = G.bonuses(r, { nearest: true, longest: true, unit: 1000 });
  assert.deepEqual(cnt(free, 'nearest'), { a: 1, b: 1, c: 1 });
  assert.deepEqual(cnt(free, 'longest'), { a: 1, b: 1, c: 1 });
  assert.deepEqual(free.rules, { parthree: false, parfive: false, eraser: false });
  assert.deepEqual(netOfBonus(free), { a: 0, b: 0, c: 0 });
  // 켜면 니어는 파3(2번홀), 롱기는 파5(3번홀)만
  const ruled = G.bonuses(r, { nearest: true, longest: true, unit: 1000, parthree: true, parfive: true });
  assert.deepEqual(cnt(ruled, 'nearest'), { a: 0, b: 1, c: 0 });
  assert.deepEqual(cnt(ruled, 'longest'), { a: 1, b: 0, c: 0 });
  assert.deepEqual(ruled.events.filter((e) => e.type !== 'birdie'), [{ hole: 1, type: 'nearest', pid: 'b' }, { hole: 2, type: 'longest', pid: 'a' }]);
  assert.deepEqual(netOfBonus(ruled), { a: 1000, b: 1000, c: -2000 });
  // 하나씩만 켤 수도 있다
  assert.deepEqual(cnt(G.bonuses(r, { parthree: true }), 'longest'), { a: 1, b: 1, c: 1 });
  assert.deepEqual(cnt(G.bonuses(r, { parfive: true }), 'nearest'), { a: 1, b: 1, c: 1 });
  // 판정 함수
  assert.equal(G.nearInfo(r, 0, { parthree: true }).pid, null);
  assert.equal(G.nearInfo(r, 0, {}).pid, 'a');
  assert.equal(G.nearInfo(r, 1, { parthree: true }).pid, 'b');
  assert.equal(G.longOf(r, 1, { parfive: true }), null);
  assert.equal(G.longOf(r, 2, { parfive: true }), 'a');
  assert.equal(G.longOf(r, 5, { parfive: true }), null, 'nothing entered');
  assert.equal(G.nearInfo(Object.assign({}, r, { extras: { 1: { nearest: 'zz' } } }), 1, {}).pid, null, 'unknown player');
  // computeAll은 라운드의 보너스 설정을 그대로 쓴다
  r.games = { bonus: { nearest: true, longest: true, unit: 1000, parthree: true, parfive: true } };
  assert.deepEqual(Object.fromEntries(G.computeAll(r).settlement.rows.map((x) => [x.id, x.net])), { a: 1000, b: 1000, c: -2000 });
});

test('eraser: on a par 3 a player who makes par or better erases the nearest; it is neither counted nor paid', () => {
  const players = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase() }));
  // 1~4번홀 파3, 5번홀 파4
  const r = mkRound(players, { a: [3, 3, 2, 3, 4], b: [3, 4, 3, null, 4], c: [4, 3, 3, 3, 4] }, { holes: 9, pars: [3, 3, 3, 3, 4, 4, 4, 4, 4],
    extras: { 0: { nearest: 'a', eraser: 'b' }, 1: { nearest: 'a', eraser: 'b' }, 2: { nearest: 'a', eraser: 'c' }, 3: { nearest: 'a', eraser: 'b' }, 4: { nearest: 'a', eraser: 'b' } } });
  const on = { nearest: true, unit: 1000, eraser: true };
  assert.deepEqual(G.nearInfo(r, 0, on), { raw: 'a', pid: null, eraser: 'b', erased: true, why: null }, 'b made par: erased');
  assert.deepEqual(G.nearInfo(r, 1, on), { raw: 'a', pid: 'a', eraser: 'b', erased: false, why: 'over' }, 'b made bogey: not erased');
  assert.deepEqual(G.nearInfo(r, 2, on), { raw: 'a', pid: null, eraser: 'c', erased: true, why: null }, 'the group decides; a birdie near can be erased by a par if they say so');
  assert.deepEqual(G.nearInfo(r, 3, on), { raw: 'a', pid: 'a', eraser: 'b', erased: false, why: 'noscore' }, 'no score yet: the near stands for now');
  assert.deepEqual(G.nearInfo(r, 4, on), { raw: 'a', pid: 'a', eraser: null, erased: false, why: null }, 'not a par 3: no eraser');
  const res = G.bonuses(r, on);
  assert.deepEqual(res.counts.a, { nearest: 3, longest: 0, birdie: 1, eagle: 0, eraser: 0 });
  assert.equal(res.counts.b.eraser, 1); assert.equal(res.counts.c.eraser, 1);
  assert.deepEqual(res.events.filter((e) => e.type === 'erased'), [{ hole: 0, type: 'erased', pid: 'a', by: 'b' }, { hole: 2, type: 'erased', pid: 'a', by: 'c' }]);
  assert.deepEqual(Object.fromEntries(G.settle(res.transfers, r.players).rows.map((x) => [x.id, x.net])), { a: 6000, b: -3000, c: -3000 });
  // 룰이 꺼져 있으면 지우개 표시는 아무 일도 하지 않는다
  const off = G.bonuses(r, { nearest: true, unit: 1000 });
  assert.equal(off.counts.a.nearest, 5); assert.equal(off.counts.b.eraser, 0);
  assert.ok(off.events.every((e) => e.type !== 'erased'));
  // 니어를 한 본인이나 없는 사람은 지울 수 없다
  r.extras[0] = { nearest: 'a', eraser: 'a' };
  assert.equal(G.nearInfo(r, 0, on).pid, 'a');
  r.extras[0] = { nearest: 'a', eraser: 'zz' };
  assert.equal(G.nearInfo(r, 0, on).pid, 'a');
  r.extras[0] = { eraser: 'b' };
  assert.deepEqual(G.nearInfo(r, 0, on), { raw: null, pid: null, eraser: null, erased: false, why: null }, 'an eraser without a nearest means nothing');
  // 파3 제한과 함께: 파4에 남은 니어는 빠진다
  r.extras[0] = { nearest: 'a', eraser: 'b' };
  assert.equal(G.bonuses(r, { nearest: true, unit: 1000, eraser: true, parthree: true }).counts.a.nearest, 2);
});

test('오장: a nearest erased by the eraser rule is treated as if it never happened', () => {
  const pars = [3].concat(Array(17).fill(4));
  // a 니어 + 파, b가 그린 밖에서 파: 지우개. 타수 차만 남는다 (c만 보기)
  const r = ojRound({ a: [3], b: [3], c: [4] }, { pars, extras: { 0: { nearest: 'a', eraser: 'b' } } });
  let res = G.ojang(r, { unit: 5000, eraser: true });
  assert.deepEqual(res.holes[0].near, { pid: 'a', ok: false, erasedBy: 'b' });
  assert.deepEqual(amt(res), { a: 5000, b: 5000, c: -10000 });
  // 지우개 룰이 꺼져 있으면 니어값이 그대로 붙는다
  res = G.ojang(r, { unit: 5000 });
  assert.deepEqual(res.holes[0].near, { pid: 'a', ok: true });
  assert.deepEqual(amt(res), { a: 15000, b: 0, c: -15000 });
  // computeAll은 보너스 설정의 지우개 룰을 오장에 넘긴다
  r.games = { ojang: { enabled: true, unit: 5000 }, bonus: { eraser: true } };
  assert.deepEqual(G.computeAll(r).ojang.holes[0].near, { pid: 'a', ok: false, erasedBy: 'b' });
  r.games.bonus.eraser = false;
  assert.deepEqual(G.computeAll(r).ojang.holes[0].near, { pid: 'a', ok: true });
  // 지운 사람이 보기면 인정되지 않는다
  const r2 = ojRound({ a: [3], b: [4], c: [4] }, { pars, extras: { 0: { nearest: 'a', eraser: 'b' } } });
  assert.deepEqual(G.ojang(r2, { unit: 5000, eraser: true }).holes[0].near, { pid: 'a', ok: true });
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

test('records made before the update keep hole-number carry: skins follows the play order only on rounds stamped with playorder', () => {
  // 예전 버전에서 10번홀 출발로 친 라운드: 10번홀은 a, 1번홀은 b가 버디, 나머지는 전원 파
  const back = [9, 10, 11, 12, 13, 14, 15, 16, 17, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  const sc = { a: Array(18).fill(4), b: Array(18).fill(4), c: Array(18).fill(4), d: Array(18).fill(4) };
  sc.a[9] = 3; sc.b[0] = 3;
  const players = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), hcp: 0, team: '' }));
  const old = mkRound(players, sc, { pars: Array(18).fill(4), games: { skins: { enabled: true, net: false, mode: 'individual', unit: 1000 } } });
  const nets = (all) => Object.fromEntries(all.settlement.rows.map((x) => [x.id, x.net]));
  // 예전 계산(홀 번호 순): 1번홀 b 1스킨, 10번홀 a 9스킨(2~9번홀 이월). 친 순서를 넘겨도 그대로다
  assert.deepEqual(nets(G.computeAll(old)), { a: 26000, b: -6000, c: -10000, d: -10000 });
  assert.deepEqual(G.computeAll(old, { order: back }).settlement, G.computeAll(old).settlement, 'an old record is not recomputed in play order');
  assert.deepEqual(G.computeAll(old, { order: back }).skins.transfers, G.computeAll(old).skins.transfers);
  // 설정을 채운 뒤(playorder: false)에도 같다
  old.games.skins = Object.assign({ fund: false, stake: 100000, prize: 20000, start: 10000, tip: 10000, caddie: 150000, collect: false, oecd: false, fine: 10000, playorder: false }, old.games.skins);
  assert.deepEqual(nets(G.computeAll(old, { order: back })), { a: 26000, b: -6000, c: -10000, d: -10000 });
  // 이 버전에서 만든 라운드(playorder: true)는 친 순서: 10번홀 a 1스킨, 1번홀 b 9스킨(11~18번홀 이월)
  old.games.skins.playorder = true;
  assert.deepEqual(nets(G.computeAll(old, { order: back })), { a: -6000, b: 26000, c: -10000, d: -10000 });
  assert.deepEqual(nets(G.computeAll(old)), { a: 26000, b: -6000, c: -10000, d: -10000 }, 'no order given: hole-number order');
  // 오장은 새로 생긴 게임이라 표시와 상관없이 친 순서를 따른다
  const tie = mkRound(players.slice(0, 2), { a: Array(18).fill(null), b: Array(18).fill(null) }, { pars: Array(18).fill(4), games: { skins: { unit: 1000 }, ojang: { enabled: true, unit: 5000 } } });
  tie.scores.a[17] = 4; tie.scores.b[17] = 4; tie.scores.a[0] = 3; tie.scores.b[0] = 4;
  assert.deepEqual(G.computeAll(tie, { order: back }).ojang.holes[0].reasons, ['버디', '앞 홀 전원 동타']);
  assert.equal(G.computeAll(tie, { order: back }).skins.holes[0].skins, 1);
});

test('skins fund: an uneven split is made in whole won, so the payments to the caddie add up to the caddie money', () => {
  // 3명, 기본 금액, 각자 6홀씩 단독 승: 모자란 돈 250,000원을 셋이 나누면 83,333.33…원
  const sc = { a: [], b: [], c: [] };
  for (let h = 0; h < 18; h++) { sc.a.push(h % 3 === 0 ? 3 : 4); sc.b.push(h % 3 === 1 ? 3 : 4); sc.c.push(h % 3 === 2 ? 3 : 4); }
  const r = oecdRound(sc);
  const res = G.skins(r, FUND);
  assert.equal(res.fund.rest, -250000); assert.equal(res.fund.even, false);
  assert.ok(Math.abs(res.fund.share + 250000 / 3) < 1e-6, 'the label amount stays the plain average');
  const by = Object.fromEntries(res.entrants.map((e) => [e.id, e]));
  assert.deepEqual([by.a.share, by.b.share, by.c.share], [-83333, -83333, -83334], 'whole won; the odd won go to the first players');
  assert.equal(res.entrants.reduce((t, e) => t + e.share, 0), -250000);
  assert.deepEqual(finalOf(res), { a: -53333, b: -53333, c: -53334 });
  const s = G.settle(res.transfers, r.players);
  assert.equal(s.rows.reduce((t, x) => t + x.net, 0), -160000);
  assert.equal(s.payments.filter((p) => p.to === '#caddie').reduce((t, p) => t + p.amount, 0), res.fund.caddieTotal, 'the caddie gets exactly 160,000');
  assert.ok(s.payments.every((p) => p.from.charAt(0) !== '#'), 'the fund account never appears as a payer when nothing was collected');
  // 미리 걷은 경우에도 걷어 둔 돈이 정확히 다 나간다
  const col = G.skins(r, Object.assign({ collect: true }, FUND));
  const sc2 = G.settle(col.transfers, r.players, { game: 'skins', payments: col.payout });
  assert.equal(sc2.payments.filter((p) => p.from === '#pot').reduce((t, p) => t + p.amount, 0) - sc2.payments.filter((p) => p.to === '#pot').reduce((t, p) => t + p.amount, 0), col.fund.cash);
  assert.equal(sc2.payments.filter((p) => p.to === '#caddie').reduce((t, p) => t + p.amount, 0), col.fund.caddieDue);
  // 남는 경우: 3명, 시작 지급 없음, 캐디피를 내고 100,000원이 남는다 → 33,334 · 33,333 · 33,333
  const sur = G.skins(oecdRound({ a: [3, 3, 3, 3, 3], b: [4, 4, 4, 4, 4], c: [4, 4, 4, 4, 4] }), { mode: 'individual', fund: true, stake: 100000, prize: 10000, start: 0, tip: 0, caddie: 150000 });
  assert.equal(sur.fund.rest, 100000);
  assert.deepEqual(sur.entrants.map((e) => e.share).sort((x, y) => y - x), [33334, 33333, 33333]);
  assert.equal(sur.entrants.reduce((t, e) => t + e.final, 0), -150000);
  // 여러 인원·금액에서 항상 맞는다
  for (let n = 2; n <= 8; n++) {
    const scs = {}; for (let i = 0; i < n; i++) scs['p' + i] = Array.from({ length: 18 }, (_, h) => (h % n === i ? 3 : 4));
    const rr = oecdRound(scs);
    [[100000, 20000, 10000, 10000, 150000], [100001, 3333, 7, 999, 33333], [50000, 10000, 0, 0, 0], [1, 1, 1, 1, 1]].forEach(([stake, prize, start, tip, caddie]) => {
      const x = G.skins(rr, { mode: 'individual', fund: true, stake, prize, start, tip, caddie });
      assert.ok(x.entrants.every((e) => Number.isInteger(e.final) && Number.isInteger(e.share)), 'whole won for ' + n);
      assert.equal(x.entrants.reduce((t, e) => t + e.share, 0), x.fund.rest);
      const st = G.settle(x.transfers, rr.players);
      assert.equal(st.payments.filter((p) => p.to === '#caddie').reduce((t, p) => t + p.amount, 0), tip + caddie, n + ' players');
      assert.equal(st.rows.reduce((t, y) => t + y.net, 0) + tip + caddie, 0);
    });
  }
});

test('all files carry the same build number as the service worker cache', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, '..');
  const sw = Number(/CACHE = 'golf-score-v(\d+)'/.exec(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8'))[1]);
  const app = Number(/var BUILD = (\d+);/.exec(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'))[1]);
  assert.equal(G.BUILD, sw); assert.equal(require('../analysis.js').BUILD, sw); assert.equal(require('../sync.js').BUILD, sw); assert.equal(app, sw);
  // 브라우저에서 쓰는 이름: 세 파일이 내놓는 이름을 app.js(와 analysis.js)가 그대로 읽어야 한다.
  // 배포되어 있던 예전 app.js는 GolfGames · GolfSync · GolfAnalysis를 읽으므로, 그 이름을 다시 쓰면 예전 app.js가 새 파일과 섞여 돌아간다
  const src = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  [['games.js', 'GolfGames2'], ['sync.js', 'GolfSync2'], ['analysis.js', 'GolfAnalysis2']].forEach(([file, name]) => {
    assert.ok(src(file).includes('root.' + name + ' = api;'), file + ' exports ' + name);
    assert.ok(src('app.js').includes('window.' + name + ';'), 'app.js reads ' + name);
    assert.ok(!new RegExp('root\\.' + name.slice(0, -1) + '\\s*=').test(src(file)), file + ' does not export the released name');
  });
  assert.ok(src('analysis.js').includes('root.GolfGames2 ||'), 'analysis.js reads GolfGames2');
  // 예전 app.js와 섞였는지 확인하는 안전장치: 세 파일에 똑같이 있고(하나만 새것일 수 있다), app.js는 자기 버전을 알린다
  const guard = (f) => { const t = src(f), i = t.indexOf('  // 브라우저 전용 안전장치.'), j = t.indexOf('  root.Golf', i); return i >= 0 && j > i ? t.slice(i, j) : ''; };
  assert.ok(guard('games.js').includes("root.__gsApp === api.BUILD") && guard('games.js').includes('retry-load'));
  assert.equal(guard('sync.js'), guard('games.js')); assert.equal(guard('analysis.js'), guard('games.js'));
  assert.ok(src('app.js').includes('window.__gsApp = BUILD;'), 'app.js announces its build');
});

// ── 팀 매치: 홀마다 적용된 타수와 그 타수를 친 사람 (화면의 '홀별 베스트') ──
const TEAM4 = [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'A' }, { id: 'c', name: 'C', team: 'B' }, { id: 'd', name: 'D', team: 'B' }];

test('team match lists, hole by hole, the stroke applied for each team and who made it', () => {
  // 1번홀 4(a) : 4(c·d) 무 / 2번홀 3(b) : 4(d) A승 / 3번홀 5(a·b) : 4(c) B승 / 4번홀 d 미입력 / 5번홀 4(a) : 6(c) A승 / 6~9번홀 미입력
  const r = mkRound(TEAM4, { a: [4, 5, 5, 4, 4], b: [5, 3, 5, 4, 6], c: [4, 6, 4, 4, 6], d: [4, 4, 7, null, 7] }, { holes: 9 });
  const res = G.matchPlay(r, { unit: 1000, mode: 'team' });
  assert.equal(res.matches.length, 1);
  const m = res.matches[0];
  assert.deepEqual(m.status.holes, [0, 1, -1, null, 1, null, null, null, null]);
  assert.deepEqual(m.best, [
    { a: { score: 4, pids: ['a'] }, b: { score: 4, pids: ['c', 'd'] } },
    { a: { score: 3, pids: ['b'] }, b: { score: 4, pids: ['d'] } },
    { a: { score: 5, pids: ['a', 'b'] }, b: { score: 4, pids: ['c'] } },
    null,
    { a: { score: 4, pids: ['a'] }, b: { score: 6, pids: ['c'] } },
    null, null, null, null
  ]);
  // 적용된 타수는 매치 계산에 쓰는 팀 타수와 같고, 승패 표시와도 맞는다
  m.best.forEach((b, h) => {
    if (!b) return;
    assert.equal(b.a.score, G.teamHoleScore(r, m.a.pids, h, false, 1));
    assert.equal(b.b.score, G.teamHoleScore(r, m.b.pids, h, false, 1));
    assert.equal(Math.sign(b.b.score - b.a.score), m.status.holes[h]);
  });
  assert.equal(m.status.text, '1UP (4홀)');
});

test('team match best: holes after the match is decided are left out, like the hole marks', () => {
  // A팀이 1~5번홀을 모두 이겨 5&4로 끝난다. 6~9번홀에도 점수는 있다
  const r = mkRound(TEAM4, { a: Array(9).fill(3), b: Array(9).fill(5), c: Array(9).fill(4), d: Array(9).fill(6) }, { holes: 9 });
  const res = G.matchPlay(r, { unit: 1000, mode: 'team' });
  const m = res.matches[0];
  assert.equal(m.status.text, '5&4');
  assert.equal(m.status.holes.length, 5);
  assert.equal(m.best.length, 5);
  assert.ok(m.best.every(b => b && b.a.score === 3 && b.a.pids.join() === 'a' && b.b.score === 4 && b.b.pids.join() === 'c'));
  // 돈은 그대로: 진 팀 각자가 홀 차 5 × 1,000원
  const net = Object.fromEntries(G.settle(res.transfers, r.players).rows.map(x => [x.id, x.net]));
  assert.deepEqual(net, { a: 5000, b: 5000, c: -5000, d: -5000 });
});

test('team match best with handicaps uses the net stroke and the player it belongs to', () => {
  // b는 핸디 18(홀마다 1타): 1번홀 그로스 5 → 네트 4로 a(4)와 같다. 2번홀 그로스 4 → 네트 3으로 혼자 가장 좋다
  const players = [{ id: 'a', name: 'A', team: 'A', hcp: 0 }, { id: 'b', name: 'B', team: 'A', hcp: 18 }, { id: 'c', name: 'C', team: 'B', hcp: 0 }, { id: 'd', name: 'D', team: 'B', hcp: 0 }];
  const r = mkRound(players, { a: [4, 4], b: [5, 4], c: [4, 4], d: [5, 5] });
  const net = G.matchPlay(r, { mode: 'team', net: true }).matches[0];
  assert.deepEqual(net.best[0], { a: { score: 4, pids: ['a', 'b'] }, b: { score: 4, pids: ['c'] } });
  assert.deepEqual(net.best[1], { a: { score: 3, pids: ['b'] }, b: { score: 4, pids: ['c'] } });
  assert.deepEqual(net.status.holes.slice(0, 2), [0, 1]);
  const gross = G.matchPlay(r, { mode: 'team' }).matches[0];
  assert.deepEqual(gross.best[0], { a: { score: 4, pids: ['a'] }, b: { score: 4, pids: ['c'] } });
  assert.deepEqual(gross.best[1], { a: { score: 4, pids: ['a', 'b'] }, b: { score: 4, pids: ['c'] } });
});

test('individual match play has no best list, and a team of one names that player', () => {
  const r = mkRound([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], { a: [4, 5], b: [5, 5] }, { holes: 9 });
  assert.ok(G.matchPlay(r, { mode: 'individual' }).matches.every(m => !('best' in m)));
  const t = mkRound([{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'B' }], { a: [4, 5], b: [5, 5] }, { holes: 9 });
  const m = G.matchPlay(t, { mode: 'team' }).matches[0];
  assert.deepEqual(m.best.slice(0, 3), [{ a: { score: 4, pids: ['a'] }, b: { score: 5, pids: ['b'] } }, { a: { score: 5, pids: ['a'] }, b: { score: 5, pids: ['b'] } }, null]);
  assert.equal(G.teamHoleBest(t, ['a', 'b'], 2, false), null);
});

test('toParShort: the short names used in the hole-by-hole table', () => {
  assert.deepEqual([-3, -2, -1, 0, 1, 2, 3].map(d => G.toParShort(d, 5)), ['알바트로스', '이글', '버디', '파', '보기', '더블', '트리플']);
  assert.equal(G.toParShort(4, 5), '+4');
  // 파의 두 배(양파)는 긴 이름과 같다
  assert.deepEqual([G.toParShort(3, 3), G.toParShort(4, 4), G.toParShort(5, 5)], ['양파', '양파', '양파']);
  for (let par = 3; par <= 5; par++) for (let d = -3; d <= 6; d++) {
    const long = G.toParLabel(d, par), short = G.toParShort(d, par);
    assert.equal(short, long === '더블보기' ? '더블' : long === '트리플보기' ? '트리플' : long);
  }
});
