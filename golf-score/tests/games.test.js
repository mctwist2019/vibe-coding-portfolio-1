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
  assert.deepEqual(res.fund, { stake: 100000, prize: 20000, start: 10000, tip: 10000, caddie: 150000, fine: 10000, oecd: false, players: 4,
    total: 400000, startOut: 50000, paid: 80000, fines: 0, left: 270000, rest: 120000, share: 30000, caddieTotal: 160000 });
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
  // computeAll이 순서를 넘겨 준다. 잘못된 순서는 홀 번호 순으로 대신한다
  r.games = { skins: { enabled: true, unit: 1000, mode: 'individual' } };
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
