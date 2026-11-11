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
  assert.ok(A.holeTips(r, 3, 'a').length <= 5);
  // 내 기록 한 줄이 앞에 붙어도 코스 경고는 밀려나지 않는다 (티샷 3줄 + 그린 앞 해저드)
  r.holeInfo[7] = { shape: 'L', haz: 1 | 32 | 16 };
  assert.deepEqual(A.holeTips(r, 7, 'a').slice(1), A.holeTips(r, 7));
  assert.match(A.holeTips(r, 7, 'a').join(' '), /그린 앞에 해저드/);
  // 잘못된 값은 무시
  r.holeInfo[6] = { dist: 'abc', shape: 'X', haz: -1, memo: 5 };
  assert.deepEqual(A.holeInfo(r, 6), { dist: null, shape: null, haz: 0, memo: '' });
});

test('hole shape: a registered source fixes the shape (holes drawn from a course guide map)', () => {
  const r = mk(9, { a: [5, 6, 3] });
  r.holeInfo = { 1: { shape: 'S', haz: 1 }, 2: { shape: 'R' }, 3: { shape: 'R' } };
  try {
    A.setShapeSource((round, h) => (h === 1 ? 'L' : h === 2 ? null : undefined));
    assert.equal(A.holeInfo(r, 1).shape, 'L', 'the source wins over the stored value');
    assert.ok(A.holeLabels(r, 1).includes('좌 도그렉'));
    assert.match(A.holeTips(r, 1).join(' '), /왼쪽으로 휘는/);
    assert.equal(A.holeInfo(r, 2).shape, null, 'null from the source means no shape (e.g. a par 3)');
    assert.equal(A.holeInfo(r, 3).shape, 'R', 'undefined from the source keeps the stored value');
    assert.equal(r.holeInfo[1].shape, 'S', 'the stored value itself is not rewritten');
    A.setShapeSource(() => 'X');
    assert.equal(A.holeInfo(r, 1).shape, null, 'an invalid value from the source is ignored');
  } finally { A.setShapeSource(null); }
  assert.equal(A.holeInfo(r, 1).shape, 'S');
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

test('hole memo as keywords: split on separators, joined with " · ", old sentences fall back to chunks', () => {
  assert.deepEqual(A.memoWords('좌우 OB · 정면 막창(약 240m) · 내리막'), ['좌우 OB', '정면 막창(약 240m)', '내리막']);
  assert.deepEqual(A.memoWords('내리막, 우측 OB，그린 빠름、2단 그린;앞바람\n끊어 가기'), ['내리막', '우측 OB', '그린 빠름', '2단 그린', '앞바람', '끊어 가기']);
  assert.deepEqual(A.memoWords('  내리막 ·· 내리막 ,  '), ['내리막'], 'blank pieces and duplicates are dropped');
  assert.deepEqual(A.memoWords('1.5단 그린 · 210~260m'), ['1.5단 그린', '210~260m'], 'a period inside a number is not a separator');
  assert.deepEqual(A.memoWords('티샷은 우측 벙커 방향. 그린 뒤는 내리막.'), ['티샷은 우측 벙커 방향', '그린 뒤는 내리막'], 'sentences written before keywords existed');
  assert.deepEqual(A.memoWords(''), []);
  assert.deepEqual(A.memoWords(null), []);
  assert.deepEqual(A.memoWords(5), ['5']);
  ['constructor', '__proto__', 'toString'].forEach((w) => assert.deepEqual(A.memoWords(w + ' · ' + w), [w], w));
  const words = ['좌우 OB', '핀보다 짧게', '약간 오르막'];
  assert.deepEqual(A.memoWords(words.join(A.MEMO_SEP)), words, 'join → split round trip');
});

test('hazard labels are grouped by kind (OB · 해저드 · 벙커)', () => {
  assert.deepEqual(A.hazLabels(0), []);
  assert.deepEqual(A.hazLabels(1), ['OB 좌']);
  assert.deepEqual(A.hazLabels(1 | 2), ['OB 좌우']);
  assert.deepEqual(A.hazLabels(8 | 16), ['해저드 우·그린 앞']);
  assert.deepEqual(A.hazLabels(16), ['그린 앞 해저드']);
  assert.deepEqual(A.hazLabels(32 | 64 | 128), ['벙커 좌우·그린 주변']);
  assert.deepEqual(A.hazLabels(255), ['OB 좌우', '해저드 좌우·그린 앞', '벙커 좌우·그린 주변']);
  // 입력 칸의 줄(HAZ_GROUPS)은 여덟 개 비트를 빠짐없이 한 번씩 다룬다
  const bits = [];
  A.HAZ_GROUPS.forEach((g) => { bits.push(g.l, g.r); if (g.g) bits.push(g.g); });
  assert.deepEqual(bits.sort((a, b) => a - b), A.HAZ_LABELS.map((e) => e[0]));
  const r = mk(9, { a: [5] });
  r.holeInfo = { 0: { dist: 362, shape: 'L', haz: 2 | 32 | 64 | 128 } };
  assert.deepEqual(A.holeLabels(r, 0), ['362m', '좌 도그렉', 'OB 우', '벙커 좌우·그린 주변']);
});

test('built-in keyword memos: short keywords; old sentence memos read as keywords of their own hole', () => {
  const S = require('../sync.js');
  const courses = require('../courses.js');
  const v9 = require('./memo-v9.json'); // 예전 버전의 문장형 메모 (코스 이름 → 홀별 문장, 없으면 null)
  const up = courses.memoUpgrades;
  let n = 0;
  courses.forEach((c) => {
    assert.ok(Array.isArray(v9[c.name]) && v9[c.name].length === c.holes, 'fixture covers ' + c.name);
    for (let h = 0; h < c.holes; h++) {
      const info = c.holeInfo[h] || {}, memo = info.memo, old = v9[c.name][h];
      const tag = c.name + ' #' + (h + 1);
      assert.equal(!!memo, !!old, tag + ' has keywords exactly where the old data had a sentence');
      if (!memo) continue;
      n++;
      const words = A.memoWords(memo);
      assert.equal(words.join(A.MEMO_SEP), memo, tag + ' is stored exactly as its keywords joined');
      assert.ok(words.length >= 1 && words.length <= 5, tag + ' keyword count');
      words.forEach((w) => assert.ok(w.length <= 24, tag + ' keyword too long: ' + w));
      assert.ok(!/후기 참고/.test(memo), tag + ' no sentence prefix');
      // 위험 요소로 표시한 OB를 키워드에서 또 말하지 않는다 (요약 줄에 두 번 나오지 않게)
      if (info.haz & 3) assert.ok(!/OB/.test(memo), tag + ' OB is a hazard flag, not also a keyword');
      // 번역표: 이 홀의 옛 문장은 이 홀의 키워드로 읽힌다. 더 들어 있는 말은 그때 자료에 표시가 없던 위험 요소·형태뿐이다
      assert.match(old, /^후기 참고: /);
      assert.ok(Object.prototype.hasOwnProperty.call(up, old), tag + ' old sentence is in the upgrade table');
      const legacy = A.memoWords(up[old]);
      assert.equal(legacy.join(A.MEMO_SEP), up[old], tag + ' upgrade target is in keyword form');
      words.forEach((w) => assert.ok(legacy.includes(w), tag + ' upgrade target keeps this hole\'s keyword: ' + w));
      legacy.filter((w) => !words.includes(w)).forEach((w) => assert.match(w, /OB|해저드|그린 벙커|우측으로 휨/, tag + ' extra word in the upgrade target: ' + w));
      legacy.forEach((w) => assert.ok(w.length <= 24, tag + ' legacy keyword too long: ' + w));
      const clean = { id: 'r', holes: 9, date: 'd', createdAt: 1, name: 'n', pars: [4, 4, 4, 4, 4, 4, 4, 4, 4], strokeIndex: [1, 2, 3, 4, 5, 6, 7, 8, 9], players: [{ id: 'a', name: 'A', hcp: 0, team: '' }],
        scores: { a: new Array(9).fill(null) }, extras: {}, games: {}, status: 'live', rev: {}, course: '', holeInfo: { 0: { memo: old } } };
      S.diffAndStamp(clean, {}, S.createClock(() => 5), 'A');
      assert.equal(clean.holeInfo[0].memo, old, tag + ' the old sentence is what sync validation stored, so an exact match is possible');
    }
  });
  assert.equal(Object.keys(up).length, n, 'no stray entries in the upgrade table');
  // 읽을 때만 바꾼다: 저장된 값은 그대로, 번역표에 없는 메모(직접 고친 문장)는 건드리지 않는다
  const r = mk(9, { a: [5] });
  const old = Object.keys(up)[0];
  r.holeInfo = { 0: { memo: old }, 1: { memo: old + ' 추가' }, 2: { memo: 'toString' } };
  try {
    A.setMemoUpgrades(up);
    assert.equal(A.holeInfo(r, 0).memo, up[old]);
    assert.equal(r.holeInfo[0].memo, old);
    assert.equal(A.holeInfo(r, 1).memo, old + ' 추가');
    assert.equal(A.holeInfo(r, 2).memo, 'toString', 'inherited object keys are not treated as upgrades');
    A.setMemoUpgrades(null);
    assert.equal(A.holeInfo(r, 0).memo, old);
  } finally { A.setMemoUpgrades(null); }
});

test('built-in Creek course: tips never aim at a side its own data calls OB or hazard', () => {
  const courses = require('../courses.js');
  const c = courses.find((x) => x.name === '베어크리크 포천 · 크리크 (화이트티)');
  const r = { holes: c.holes, pars: c.pars, holeInfo: c.holeInfo, players: [], scores: {} };
  let ob = 0;
  for (let h = 0; h < c.holes; h++) {
    const haz = c.holeInfo[h].haz || 0, tips = A.holeTips(r, h).join(' ');
    const left = !!(haz & (A.HAZ.OB_L | A.HAZ.WATER_L)), right = !!(haz & (A.HAZ.OB_R | A.HAZ.WATER_R));
    if (haz & 3) ob++;
    if (left) assert.doesNotMatch(tips, /왼쪽(으로| 절반을|을) 겨냥|가운데보다 왼쪽/, 'hole ' + (h + 1) + ' has danger on the left: ' + tips);
    if (right) assert.doesNotMatch(tips, /오른쪽(으로| 절반을|을) 겨냥|가운데보다 오른쪽/, 'hole ' + (h + 1) + ' has danger on the right: ' + tips);
  }
  assert.ok(ob >= 12, 'OB sides from the reviews are hazard flags');
});

// ───────────────────────── 코드 리뷰에서 확인된 문제의 회귀 테스트 ─────────────────────────
test('hole tips: the personal line ignores what is being entered on that hole (score rows must not jump while tapping)', () => {
  // 1번홀 더블보기 뒤 2번홀(파4) 입력 중
  const r = mk(9, { a: [6], b: [4] }, { holeInfo: { 1: { dist: 336, haz: 1 } }, stats: { a: { 0: { ob: 1 } } } });
  const before = A.holeTips(r, 1, 'a');
  [4, 5, 6, 7, null].forEach((g) => {
    [undefined, { ob: 1 }, { ob: 2, hz: 2, fw: 2 }].forEach((s) => {
      r.scores.a[1] = g; if (s) r.stats.a[1] = s; else delete r.stats.a[1];
      assert.deepEqual(A.holeTips(r, 1, 'a'), before, 'score ' + g + ', stats ' + JSON.stringify(s));
    });
  });
  // 다른 홀의 기록은 그대로 반영된다
  r.scores.a[1] = null; delete r.stats.a[1]; r.scores.a[4] = 6;
  assert.match(A.holeTips(r, 1, 'a').join(' '), /오늘 파4에서 평균 \+2\.0/);
  assert.deepEqual(A.holeTips(r, 1, 'nobody'), A.holeTips(r, 1), 'unknown player → no personal line');
});

test('hole tips: one aim per tee shot (dogleg vs outside hazards), green wording on par 3', () => {
  const r = mk(9, { a: [] }); // 0번은 파4, 2번은 파3
  const tee = (h, info) => { r.holeInfo = { [h]: info }; return A.holeTips(r, h); };
  const aims = (tips) => {
    const s = new Set();
    tips.forEach((t) => {
      if (/오른쪽 절반|오른쪽으로 보내면|오른쪽으로 겨냥|보다 오른쪽을 겨냥/.test(t)) s.add('R');
      if (/왼쪽 절반|왼쪽으로 보내면|왼쪽으로 겨냥|보다 왼쪽을 겨냥/.test(t)) s.add('L');
      if (/가운데로 보내|가운데를 겨냥/.test(t)) s.add('C');
    });
    return [...s].join('');
  };
  assert.deepEqual(tee(0, { shape: 'L', haz: 64 }), ['왼쪽으로 휘는 홀인데 바깥쪽(오른쪽)에 벙커가 있어요. 페어웨이 가운데를 겨냥하고, 벙커에 못 미치는 클럽으로 끊어 가는 것도 방법이에요.']);
  assert.equal(aims(tee(0, { shape: 'R', haz: 32 })), 'C');
  assert.deepEqual(tee(0, { shape: 'L', haz: 2 }), ['왼쪽으로 휘는 홀인데 바깥쪽(오른쪽)이 OB예요. 코너를 가로지르려 하지 말고 페어웨이 가운데를 겨냥하세요.']);
  assert.equal(aims(tee(0, { shape: 'L', haz: 2 | 64 })), 'C');
  assert.equal(aims(tee(0, { shape: 'L', haz: 1 })), 'R'); // 안쪽이 위험한 도그렉은 바깥쪽으로
  assert.equal(aims(tee(0, { shape: 'L', haz: 32 })), 'R');
  for (const shape of [undefined, 'S', 'L', 'R']) for (let haz = 0; haz < 128; haz++) {
    if (haz & 16) continue;
    assert.ok(aims(tee(0, { shape, haz })).length <= 1, 'par4 ' + shape + ' ' + haz);
    const t3 = tee(2, { shape, haz: haz | 128 });
    assert.ok(aims(t3).length <= 1, 'par3 ' + shape + ' ' + haz);
    assert.doesNotMatch(t3.join(' '), /페어웨이|우드나 유틸리티|휘는 홀|끊어 가/, 'par3 ' + shape + ' ' + haz);
  }
  assert.match(tee(2, { haz: 3 })[0], /그린 양쪽이 모두 위험/);
  assert.match(tee(2, { haz: 1 })[0], /왼쪽이 OB예요. 그린 가운데보다 오른쪽/);
});

test('coach: archived or fully entered rounds get no in-the-moment lines; a cheer always exists', () => {
  const LIVE = /지금|방금|다음 티샷|다음 샷|다음 한 샷|다음 홀|남은 \d+홀|잊어요|좋은 페이스|끝까지/;
  const r = mk(18, { a: [4, 5, 3, 5, 5, 4, 4, 5, 5], b: [5, 5, 4, 5, 5, 4, 4, 5, 5], c: [5, 6, 4, 6, 5, 5, 4, 5, 9] });
  r.stats = { c: { 8: { ob: 1 } } };
  assert.equal(A.roundStatus(r).finished, false, 'still live while it is the current round');
  const st = A.roundStatus(r, { archived: true });
  assert.equal(st.finished, true); assert.equal(st.thruAll, 9);
  ['a', 'b', 'c'].forEach((id) => { const c = A.coach(r, id, st); assert.doesNotMatch(c.cheers.concat(c.tips).join(' '), LIVE, id); });
  assert.match(A.coach(r, 'a', st).cheer, /오늘의 1위/);
  const fin = mk(9, { a: [5, 5, 4, 6, 5, 6, 4, 5, 6], b: [4, 4, 3, 5, 4, 4, 3, 4, 5] }, { status: 'finished' });
  assert.doesNotMatch(A.coach(fin, 'a').cheers.join(' '), LIVE);
  // 나는 18홀을 다 넣었는데 동반자가 한 홀 남은 상태: 아직 최종이 아니므로 순위를 단정하지 않고, 실시간 문구도 쓰지 않는다
  const full = [4, 5, 3, 5, 5, 4, 4, 5, 5, 4, 5, 3, 5, 5, 4, 4, 5, 5];
  const ca = A.coach(mk(18, { a: full, b: full.map((v, i) => (i === 17 ? null : v + 1)) }), 'a');
  assert.doesNotMatch(ca.cheers.join(' '), /지금 단독 선두|오늘의 1위/);
  assert.match(ca.cheers.join(' '), /수고하셨어요/);
  // 격려는 항상 한 줄 이상 (입력 화면이 c.cheer를 그대로 쓴다)
  [[6], [5, 6], [4, 5, 4, 5, 4, 7], [5, 5, 5, 8], [4]].forEach((s) => {
    const c = A.coach(mk(18, { a: s, b: [4] }), 'a');
    assert.ok(c.cheer && c.lead && c.cheers.length >= 1, JSON.stringify(s));
  });
  assert.doesNotMatch(A.coach(mk(18, { a: [4, 5, 4, 5, 4, 7], b: [4] }), 'a').cheer, /좋은 페이스|스윙 리듬 괜찮아요/);
});

test('coach: rank talk compares only the holes everyone has entered, and stays quiet when entries are far apart', () => {
  // a가 7번홀(파3)을 먼저 입력해 트리플: 둘 다 친 6홀에서는 a가 1타 앞서지만 파 대비 누적만 보면 b가 앞서 보인다
  const r = mk(18, { a: [5, 5, 4, 5, 5, 5, 6], b: [5, 5, 4, 6, 5, 5] });
  let st = A.roundStatus(r);
  assert.equal(st.even, false);
  assert.equal(st.players[0].id, 'b', 'the raw table still ranks by cumulative to-par');
  assert.match(A.coach(r, 'a', st).cheers.join(' '), /지금 단독 선두/);
  assert.match(A.coach(r, 'b', st).cheers.join(' '), /선두와 1타 차, 남은 12홀/);
  r.scores.b[6] = 3; // b도 7번홀 입력(파) → 이제 b가 2타 앞선다
  st = A.roundStatus(r);
  assert.equal(st.even, true);
  assert.match(A.coach(r, 'b', st).cheers.join(' '), /지금 단독 선두/);
  assert.match(A.coach(r, 'a', st).cheers.join(' '), /선두와 2타 차, 남은 11홀/);
  // 9홀만 입력된 사람이 '오늘의 1위'가 되지 않는다
  const fin = mk(18, { a: new Array(18).fill(5), b: [6, 5, 4, 7, 5, 5, 5, 5, 6] }, { status: 'finished' });
  assert.equal(A.roundStatus(fin).players[0].id, 'b');
  ['a', 'b'].forEach((id) => assert.doesNotMatch(A.coach(fin, id).cheers.join(' '), /1위/, id));
  // 진행 중에 한 사람이 9홀에서 멈춘 경우: 나머지 사람에게 순위를 말하지 않는다
  const f15 = [5, 5, 4, 5, 5, 5, 4, 5, 6, 5, 5, 4, 6, 5, 5];
  const stop = mk(18, { a: f15, b: f15.map((v, i) => (i === 3 ? v + 1 : v)), c: [4, 4, 3, 5, 4, 4, 3, 4, 5] });
  ['a', 'b', 'c'].forEach((id) => { const c = A.coach(stop, id); assert.doesNotMatch(c.cheers.concat(c.tips).join(' '), /선두|1위/, id); });
  // 스코어가 하나도 없는 사람은 비교에서 빠진다
  const idle = mk(9, { a: [4, 4, 3], b: [5, 4, 3], c: [] });
  assert.equal(A.roundStatus(idle).even, true);
  assert.match(A.coach(idle, 'a').cheers.join(' '), /지금 단독 선두/);
  // 여유가 없을 때는 '충분히 뒤집을 수 있어요'라고 하지 않는다
  const tight = A.coach(mk(9, { a: [4, 4, 3, 5, 4, 4, 3, 4], b: [4, 4, 3, 5, 4, 4, 3, 5] }), 'b').cheers.join(' ');
  assert.match(tight, /선두와 1타 차, 남은 1홀까지 포기하지 마세요/);
  assert.doesNotMatch(tight, /충분히/);
});

test('coach: no 전·후반 trend line when the first nine has too few recorded holes', () => {
  const a = new Array(8).fill(null).concat([5, 5, 5, 3]); // 9번 파, 10~12번 보기·보기·파
  const c = A.coach(mk(18, { a }), 'a');
  assert.ok(!c.tips.concat(c.cheers).some((t) => t.indexOf('후반 들어') >= 0));
});

test('playOrder: an explicitly chosen start (round.startBack) wins over the entry-time guess', () => {
  const r = mk(18, { a: [4, 4, 3, 5, 4, 4, 3, 4, 4, 5, 5, 4, 8] }); // 9번홀 버디, 13번홀 +3
  [9, 10, 11].forEach((h, i) => { r.rev['score:a:' + h] = { ts: 1000 + i, by: 'x' }; });
  for (let h = 0; h < 9; h++) r.rev['score:a:' + h] = { ts: 2000 + h, by: 'x' };
  r.rev['score:a:12'] = { ts: 3000, by: 'x' };
  assert.equal(A.playOrder(r).startBack, true, 'the guess can only follow entry time');
  r.startBack = false;
  assert.equal(A.playOrder(r).startBack, false);
  const s = A.playerStats(r, 'a');
  assert.equal(s.seq[s.seq.length - 1].h, 12);
  assert.deepEqual(s.nines.map((n) => n.label), ['전반 (1~9번)', '후반 (10~18번)']);
  const c = A.coach(r, 'a');
  assert.match(c.tips[0], /^13번홀은 잊어요/);
  assert.ok(!c.cheers.some((t) => /9번홀 버디/.test(t)));
  const n = mk(18, { a: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4] });
  for (let h = 0; h < 11; h++) n.rev['score:a:' + h] = { ts: 1000 + h, by: 'x' };
  n.startBack = true;
  assert.deepEqual(A.playerStats(n, 'a').seq.map((e) => e.h), [9, 10, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const nine = mk(9, { a: [4] }); nine.startBack = true;
  assert.equal(A.playOrder(nine).startBack, false);
  const junk = mk(18, { a: [4] }); junk.startBack = 'in';
  assert.equal(A.playOrder(junk).startBack, false);
});

test('coach: no rank talk while a hole that two or more players entered is missing for someone else', () => {
  const RANK = /선두|1위/;
  // 세 명 중 한 명(b)이 7번홀을 아직 입력하지 않음: a와 c는 같은 7홀로 비교할 수 있으므로 6홀 기준 순위를 말하면 틀린다
  const r = mk(18, { a: [5, 5, 4, 6, 5, 5, 6], b: [5, 5, 4, 6, 5, 6], c: [5, 5, 4, 6, 6, 5, 3] });
  const st = A.roundStatus(r);
  st.players.forEach((p) => assert.equal(p.cmpGap, null, p.id));
  ['a', 'b', 'c'].forEach((id) => { const c = A.coach(r, id, st); assert.doesNotMatch(c.cheers.concat(c.tips).join(' '), RANK, id); assert.ok(c.cheer && c.lead); });
  r.scores.b[6] = 3;
  assert.match(A.coach(r, 'a').cheers.join(' '), /선두와 2타 차/);
  assert.match(A.coach(r, 'c').cheers.join(' '), /공동 선두/);
  // 네 명 중 한 명(d)이 3번홀을 비워 둔 채 진행: 라운드 내내 틀린 순위를 말하지 않는다
  const blank = mk(18, { a: [4, 4, 6, 5, 4, 4, 2, 4], b: [4, 4, 3, 5, 4, 4, 3, 4], c: [4, 4, 3, 5, 4, 5, 3, 4], d: [4, 4, null, 5, 4, 4, 3, 4] });
  ['a', 'b', 'c', 'd'].forEach((id) => { const c = A.coach(blank, id); assert.doesNotMatch(c.cheers.concat(c.tips).join(' '), RANK, id); });
  // 한 사람만 먼저 입력한 경우는 그대로: 모두가 입력한 홀까지의 순위를 말한다
  const first = mk(18, { a: [5, 5, 4, 5, 5, 5, 6], b: [5, 5, 4, 6, 5, 5], c: [5, 5, 4, 6, 6, 5] });
  assert.match(A.coach(first, 'a').cheers.join(' '), /지금 단독 선두/);
  // 두 사람이 서로 다른 홀을 비운 경우도 그대로: 둘 다 입력한 홀로 비교
  const two = mk(18, { a: [5, 5, null, 5, 5, 5, 3], b: [5, 5, 4, 6, null, 5, 3] });
  assert.match(A.coach(two, 'a').cheers.join(' '), /지금 단독 선두/);
  assert.match(A.coach(two, 'b').cheers.join(' '), /선두와 1타 차/);
});
