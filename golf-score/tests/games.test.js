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
