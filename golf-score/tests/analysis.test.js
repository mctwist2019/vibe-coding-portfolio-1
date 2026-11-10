const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../games.js');
const A = require('../analysis.js');

function mk(holes, scores, extra) {
  const players = Object.keys(scores).map((id) => ({ id, name: id.toUpperCase(), hcp: 0, team: '' }));
  const r = { id: 'r', holes, pars: G.defaultPars(holes), strokeIndex: G.defaultStrokeIndex(holes), players, scores: {}, extras: {}, stats: {}, holeInfo: {}, status: 'live', rev: {} };
  players.forEach((p) => { const a = scores[p.id].slice(); while (a.length < holes) a.push(null); r.scores[p.id] = a; });
  return Object.assign(r, extra || {});
}
// 기본 파(9홀): 4,4,3,5,4,4,3,4,5

test('playerStats: distribution, par types, streaks, bounce-back, doubles', () => {
  const r = mk(9, { a: [4, 5, 3, 8, 4, 4, 2, 6, 5] });
  const s = A.playerStats(r, 'a');
  assert.equal(s.played, 9);
  assert.equal(s.gross, 41);
  assert.equal(s.toPar, 5);
  assert.deepEqual(s.dist, { birdie: 1, par: 5, bogey: 1, double: 1, triple: 1 });
  assert.deepEqual(s.byPar[3], { n: 2, toPar: -1 });
  assert.deepEqual(s.byPar[5], { n: 2, toPar: 3 });
  assert.equal(s.streakBest, 3, 'holes 5-7 are par or better');
  assert.equal(s.streakNow, 1);
  assert.deepEqual(s.bounce, { chances: 2, made: 2 }, 'par after the triple, par after the double');
  assert.equal(s.doubles, 2);
  assert.equal(s.lostToDoubles, 3, 'triple → bogey saves 2, double → bogey saves 1');
  assert.deepEqual(s.best, { h: 6, diff: -1 });
  assert.deepEqual(s.worst, { h: 3, diff: 3 });
  assert.equal(s.nines, null, 'no halves on a 9-hole round');
  assert.deepEqual(s.seq.map((e) => e.cum), [0, 1, 1, 4, 4, 4, 3, 5, 5]);
});

test('playerStats: detail stats are counted only where recorded; penalty estimate capped per hole', () => {
  const r = mk(9, { a: [4, 5, 3, 8, 4, 2, null, null, null] });
  r.stats = { a: { 0: { pt: 2, fw: 1 }, 1: { pt: 3, fw: 3 }, 2: { pt: 1, fw: 1 }, 3: { ob: 1, hz: 1, pt: 3, fw: 2 }, 5: { ob: 3, pt: 0 }, 7: { ob: 1, pt: 2 } } };
  r.extras = { 2: { nearest: 'a' }, 3: { longest: 'a' } };
  const s = A.playerStats(r, 'a');
  assert.equal(s.ob, 4, 'the OB on hole 8 (no score) is not counted');
  assert.equal(s.hz, 1);
  assert.equal(s.penalty, 3 + 1, 'hole 4: 3; hole 6: 3 OB = 6 capped at score-1 = 1');
  assert.deepEqual(s.putts, { holes: 5, total: 9, one: 2, three: 2 });
  assert.deepEqual(s.fw, { chances: 3, hit: 1, left: 1, right: 1 }, 'tee shot on the par 3 is ignored');
  assert.deepEqual(s.gir, { holes: 5, hit: 3 }, 'holes 1, 3 and 6 (2 strokes, 0 putts on a par 4)');
  assert.equal(s.detailHoles, 5, 'only holes that also have a score');
  assert.equal(s.nearest, 1);
  assert.equal(s.longest, 1);
  assert.equal(A.playerStats(mk(9, { a: [4, 4] }), 'a').detailHoles, 0);
});

test('playOrder: back-nine start is detected from which nine has scores, then from entry time', () => {
  const back = mk(18, { a: new Array(9).fill(null).concat([4, 5, 3]) });
  assert.equal(A.playOrder(back).startBack, true);
  assert.deepEqual(A.playOrder(back).order.slice(0, 3), [9, 10, 11]);
  const s = A.playerStats(back, 'a');
  assert.deepEqual(s.seq.map((e) => e.h), [9, 10, 11]);
  assert.equal(s.nines[0].label, '전반 (10~18번)');
  assert.equal(s.nines[0].n, 3);
  // 양쪽 다 기록이 있으면 입력 시각으로 판단
  const wrapped = mk(18, { a: [4, 4].concat(new Array(7).fill(null), [4, 4, 3, 5, 4, 4, 3, 4, 5]) });
  for (let h = 9; h < 18; h++) wrapped.rev['score:a:' + h] = { ts: 1000 + h, by: 'x' };
  wrapped.rev['score:a:0'] = { ts: 5000, by: 'x' }; wrapped.rev['score:a:1'] = { ts: 5100, by: 'x' };
  assert.equal(A.playOrder(wrapped).startBack, true);
  assert.deepEqual(A.playerStats(wrapped, 'a').seq.slice(-2).map((e) => e.h), [0, 1], 'most recent holes are 1 and 2');
  const natural = mk(18, { a: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4] });
  for (let h = 0; h < 11; h++) natural.rev['score:a:' + h] = { ts: 1000 + h, by: 'x' };
  assert.equal(A.playOrder(natural).startBack, false);
  // rev가 없으면: 인코스가 다 찼고 아웃코스가 덜 찼을 때만 인코스 출발로 본다
  assert.equal(A.playOrder(mk(18, { a: [4, 4].concat(new Array(7).fill(null), [4, 4, 3, 5, 4, 4, 3, 4, 5]) })).startBack, true);
  assert.equal(A.playOrder(mk(18, { a: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4] })).startBack, false);
  assert.equal(A.playOrder(mk(9, { a: [4] })).startBack, false);
});

test('roundStatus: ranks, gaps, ties, hot player, hole difficulty, finished flag', () => {
  const r = mk(9, { a: [4, 4, 3, 5, 4], b: [5, 5, 4, 6, 4], c: [4, 4, 3, 5, 4], d: [] });
  const st = A.roundStatus(r);
  assert.equal(st.thruAll, 0);
  assert.equal(st.active, 3);
  const by = Object.fromEntries(st.players.map((p) => [p.id, p]));
  assert.equal(by.a.rank, 1); assert.equal(by.a.tied, true); assert.equal(by.c.tied, true);
  assert.equal(by.b.rank, 3); assert.equal(by.b.gap, 4); assert.equal(by.b.remaining, 4);
  assert.equal(by.d.rank, null); assert.equal(by.d.gap, null);
  assert.equal(st.hot, null, 'a and c share the best recent form → no single hot player');
  assert.equal(st.finished, false);
  const r2 = mk(9, { a: [4, 4, 3, 5, 4, 4, 3, 4, 5], b: [5, 5, 3, 5, 4, 4, 3, 4, 8] });
  const st2 = A.roundStatus(r2);
  assert.equal(st2.thruAll, 9); assert.equal(st2.finished, true);
  assert.deepEqual(st2.hardest, { h: 8, avg: 1.5 });
  assert.equal(st2.hot.id, 'a');
});

test('coach: messages follow the record and are deterministic', () => {
  // 방금 버디 + 선두
  const r1 = mk(9, { a: [4, 4, 2], b: [5, 5, 4] });
  const c1 = A.coach(r1, 'a');
  assert.match(c1.cheer, /3번홀 버디/);
  assert.equal(c1.lead, c1.cheer);
  assert.deepEqual(A.coach(r1, 'a'), c1, 'same input → same output');
  // 방금 트리플 + OB: 급한 팁이 한 줄 메시지가 된다
  const r2 = mk(9, { a: [4, 4, 3, 8], b: [4, 4, 3, 5] });
  r2.stats = { a: { 3: { ob: 1 } } };
  const c2 = A.coach(r2, 'a');
  assert.match(c2.tips[0], /4번홀은 잊어요/);
  assert.match(c2.tips[1], /방금 OB/);
  assert.equal(c2.lead, c2.tips[0]);
  // 추격 중
  assert.match(A.coach(r2, 'a').cheers.join(' '), /선두와 3타 차, 남은 5홀/);
  // 누적 OB · 3퍼트
  const r3 = mk(9, { a: [6, 6, 4, 5, 4, 5], b: [4, 4, 3, 5, 4, 4] });
  r3.stats = { a: { 0: { ob: 1, pt: 3 }, 1: { ob: 1, pt: 3 }, 2: { pt: 2 }, 3: { pt: 2 } } };
  const t3 = A.coach(r3, 'a').tips.join(' ');
  assert.match(t3, /OB가 2번 나와 약 4타/);
  assert.match(t3, /3퍼트가 2번/);
  // 티샷이 한쪽으로 쏠림
  const r5 = mk(9, { a: [5, 5, 3, 6, 5], b: [4, 4, 3, 5, 4] });
  r5.stats = { a: { 0: { fw: 3 }, 1: { fw: 3 }, 3: { fw: 3 }, 4: { fw: 1 } } };
  assert.equal(A.teeMissSide(A.playerStats(r5, 'a')), 'R');
  assert.match(A.coach(r5, 'a').tips.join(' '), /티샷이 오른쪽으로 3번 빗나갔어요.*왼쪽/);
  r5.holeInfo = { 5: { haz: 2 }, 6: { haz: 1 } };
  assert.match(A.holeTips(r5, 5, 'a')[0], /오른쪽으로 자주 빗나갔는데 이 홀은 오른쪽이 위험/);
  assert.doesNotMatch(A.holeTips(r5, 6, 'a').join(' '), /자주 빗나갔는데/);
  r5.stats.a[4].fw = 2; r5.stats.a[3].fw = 2;
  assert.equal(A.teeMissSide(A.playerStats(r5, 'a')), null, 'mixed misses → no side');
  // 만회
  const r4 = mk(9, { a: [4, 7, 3], b: [4, 4, 3] });
  assert.match(A.coach(r4, 'a').cheers.join(' '), /2번홀 실수 뒤에 바로 파로 만회/);
  // 기록 전 / 모르는 플레이어
  assert.match(A.coach(mk(9, { a: [], b: [4] }), 'a').cheer, /아직 기록 전/);
  assert.deepEqual(A.coach(r1, 'zzz'), { cheer: '', lead: '', cheers: [], tips: [] });
  // 종료된 라운드에는 '방금/다음 티샷' 류의 메시지가 나오지 않는다
  const fin = mk(9, { a: [4, 4, 3, 5, 4, 4, 3, 4, 9], b: [4, 4, 3, 5, 4, 4, 3, 4, 5] }, { status: 'finished' });
  fin.stats = { a: { 8: { ob: 1 } } };
  const cf = A.coach(fin, 'a');
  assert.ok(!/방금|다음 티샷|잊어요/.test(cf.tips.join(' ') + cf.cheers.join(' ')), JSON.stringify(cf));
  assert.match(A.coach(fin, 'b').cheer, /오늘의 1위/);
});

test('hole info: labels and strategy tips come only from what was entered', () => {
  const r = mk(9, { a: [5, 6, 3] });
  assert.deepEqual(A.holeTips(r, 3), []);
  assert.equal(A.hasHoleInfo(r, 3), false);
  r.holeInfo = { 3: { dist: 510, shape: 'L', haz: 1 | 16 | 128, memo: '세컨드는 150 남기기' }, 2: { dist: 115 }, 4: { haz: 1 | 8 }, 5: { memo: '메모만' } };
  assert.deepEqual(A.holeLabels(r, 3), ['510m', '좌 도그렉', 'OB 좌', '그린 앞 해저드', '그린 주변 벙커']);
  const t = A.holeTips(r, 3).join(' ');
  assert.match(t, /왼쪽이 OB예요.*오른쪽 절반/);
  assert.match(t, /왼쪽으로 휘는 홀/);
  assert.match(t, /그린 앞에 해저드/);
  assert.match(A.holeTips(r, 2)[0], /짧은 파3\(115m\)/);
  assert.match(A.holeTips(r, 4)[0], /양쪽이 모두 위험/);
  assert.deepEqual(A.holeTips(r, 5), [], 'a memo alone produces no generated tip');
  assert.equal(A.hasHoleInfo(r, 5), true);
  // 오늘 OB가 많았던 사람에게는 그 사실이 먼저 나온다
  r.stats = { a: { 0: { ob: 1 }, 1: { ob: 1 } } };
  assert.match(A.holeTips(r, 3, 'a')[0], /오늘 OB가 2번/);
  assert.ok(A.holeTips(r, 3, 'a').length <= 4);
  // 잘못된 값은 무시
  r.holeInfo[6] = { dist: 'abc', shape: 'X', haz: -1, memo: 5 };
  assert.deepEqual(A.holeInfo(r, 6), { dist: null, shape: null, haz: 0, memo: '' });
});

test('built-in courses are structurally valid and pass sync validation unchanged', () => {
  const S = require('../sync.js');
  const courses = require('../courses.js');
  assert.ok(courses.length >= 2);
  const names = new Set();
  courses.forEach((c) => {
    assert.ok(c.name && c.name.length <= S.COURSE_MAX, c.name);
    assert.ok(!names.has(c.name)); names.add(c.name);
    assert.ok(c.holes === 9 || c.holes === 18);
    assert.equal(c.pars.length, c.holes);
    assert.ok(c.pars.every((p) => p >= 3 && p <= 5));
    assert.deepEqual(c.strokeIndex.slice().sort((a, b) => a - b), Array.from({ length: c.holes }, (_, i) => i + 1), 'handicap index is a permutation');
    Object.keys(c.holeInfo).forEach((h) => { assert.ok(+h >= 0 && +h < c.holes); });
    // 공유 검증(setKey)을 거쳐도 값이 그대로여야 함 → 동반자 기기에도 똑같이 전달됨
    const r = { id: 'r', holes: c.holes, date: 'd', createdAt: 1, name: 'n', pars: c.pars.slice(), strokeIndex: c.strokeIndex.slice(), players: [{ id: 'a', name: 'A', hcp: 0, team: '' }],
      scores: { a: new Array(c.holes).fill(null) }, extras: {}, games: {}, status: 'live', rev: {}, course: c.name, holeInfo: JSON.parse(JSON.stringify(c.holeInfo)) };
    S.diffAndStamp(r, {}, S.createClock(() => 5), 'A');
    assert.deepEqual(r.holeInfo, c.holeInfo);
    assert.deepEqual(r.pars, c.pars);
    assert.deepEqual(r.strokeIndex, c.strokeIndex);
    assert.equal(r.course, c.name);
  });
});
