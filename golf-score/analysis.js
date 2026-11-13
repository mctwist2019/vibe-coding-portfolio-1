/*
 * analysis.js — 라운드 분석 (순수 함수)
 *   - 플레이어별 통계: 스코어 분포, 파3/4/5 성적, 전·후반, 연속 기록, OB·해저드·퍼트 등 상세 기록
 *   - 경기 현황: 순위, 타수 차, 최근 흐름, 어려웠던 홀
 *   - 코치 한마디: 기록을 규칙으로 해석해 만든 격려와 팁 (서버·AI 호출 없음)
 * 브라우저(window.GolfAnalysis2)와 Node(require) 양쪽에서 사용 가능. games.js에 의존.
 */
(function (root, factory) {
  var G = root.GolfGames2 || (typeof require === 'function' ? require('./games.js') : null);
  var api = factory(G);
  // 브라우저 전용 안전장치. 갱신 도중 app.js만 못 받으면 기기에 저장돼 있던 예전 app.js가 이 파일과 섞여 실행된다. 예전 app.js는 이 파일이 내놓는
  // 새 이름을 몰라서, 버전에 따라 스스로 '업데이트 중' 안내를 띄우거나(5cb3e2a), 빈 화면으로 멈추거나, 일부 화면만 그린 채 돌아간다(그보다 앞선 버전).
  // 그래서 index.html의 스크립트가 모두 실행된 직후에 '이 파일과 같은 버전의 app.js가 실행됐는지'(app.js가 window.__gsApp에 적는다)를 보고, 아니면
  // 화면 전체를 덮는 안내를 띄우고 두 번까지 다시 받아 본다 (app.js의 안내와 같은 동작. app.js를 아예 못 받은 경우에도 뜬다).
  // 확인은 DOMContentLoaded에서 한다: 예전 app.js가 실행 중에 넣는 스크립트(MQTT 라이브러리)가 느리면 load는 그만큼 늦어진다. load는 만일을 위한 두 번째 기회다.
  // games.js · analysis.js · sync.js 가운데 하나만 새것일 수도 있어 세 파일에 똑같이 있고, 한 번만 등록된다
  if (typeof document !== 'undefined' && typeof root.addEventListener === 'function' && !root.__gsAppWatch) {
    root.__gsAppWatch = true;
    var appCheck = function () {
      if (root.__gsAppWatch === 'done') return;
      root.__gsAppWatch = 'done';
      if (root.__gsApp === api.BUILD || document.getElementById('retry-load') || !document.body) return; // 짝이 맞는 app.js가 실행됐거나, app.js가 이미 안내를 띄웠다
      var tries = 0, box = document.createElement('div'), old = document.getElementById('app');
      try { tries = Number(sessionStorage.getItem('gs.mismatch')) || 0; sessionStorage.setItem('gs.mismatch', String(tries + 1)); } catch (e) { tries = 9; }
      if (old) old.style.display = 'none'; // 예전 app.js가 그려 둔 화면은 숨긴다 (안내 아래에서 키보드로 눌리지 않게)
      box.setAttribute('style', 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;overflow:auto;background:#f3f6f2');
      box.innerHTML = '<div class="screen"><div class="card"><h2>앱을 업데이트하는 중이에요</h2><div class="muted">새 버전의 파일을 일부만 받았어요. 인터넷이 연결된 곳에서 다시 열면 이어서 받아요. 입력해 둔 점수는 기기에 그대로 있어요.</div>' +
        '<button class="btn primary block" id="retry-load" style="margin-top:12px">다시 시도</button></div></div>';
      document.body.appendChild(box);
      document.getElementById('retry-load').addEventListener('click', function () { location.reload(); });
      if (tries < 2) setTimeout(function () { location.reload(); }, 1500);
    };
    document.addEventListener('DOMContentLoaded', appCheck);
    root.addEventListener('load', appCheck);
  }
  root.GolfAnalysis2 = api; // 이름의 2: games.js의 같은 줄 설명 참고
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  /** 벌타 추정: 국내 아마추어 라운드 관행(OB티 = 2타 손실, 해저드 = 1타 손실) 기준 */
  var OB_COST = 2, HZ_COST = 1;

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  /** 상세 기록 한 칸 읽기: round.stats[pid][hole][field] (없으면 null) */
  function stat(round, pid, h, f) {
    var s = round.stats && round.stats[pid] && round.stats[pid][h];
    return s ? num(s[f]) : null;
  }
  function parKey(par) { return par <= 3 ? 3 : par >= 5 ? 5 : 4; }
  function fmtAvg(v) { var r = Math.round(v * 10) / 10; if (r === 0) return 'E'; return (r > 0 ? '+' : '') + r.toFixed(1); }
  function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function hashStr(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h; }

  /**
   * 플레이 순서 추정. 18홀에서 인코스(10번홀)부터 시작하는 경우가 흔하므로
   * "방금 홀 / 최근 3홀 / 전반·후반"을 홀 번호가 아니라 실제 친 순서로 계산하기 위함.
   * 반환 { order: [홀 인덱스...], startBack: bool }
   */
  function playOrder(round) {
    var n = round.holes, natural = [], back = [], i;
    for (i = 0; i < n; i++) natural.push(i);
    if (n !== 18) return { order: natural, startBack: false };
    for (i = 9; i < 18; i++) back.push(i);
    for (i = 0; i < 9; i++) back.push(i);
    // 출발 코스를 직접 지정했으면 그 값이 우선: 지난 홀을 나중에 몰아서 입력하면 입력 시각만으로는 친 순서를 알 수 없다
    if (round.startBack === true || round.startBack === false) return { order: round.startBack ? back : natural, startBack: round.startBack };
    function any(h) { return round.players.some(function (p) { return G.gross(round, p.id, h) !== null; }); }
    function count(a, b) { var c = 0; for (var h = a; h < b; h++) if (any(h)) c++; return c; }
    function minTs(a, b) {
      var m = null, rev = round.rev || {};
      for (var h = a; h < b; h++) round.players.forEach(function (p) {
        if (G.gross(round, p.id, h) === null) return;
        var r = rev['score:' + p.id + ':' + h], t = r ? num(r.ts) : null;
        if (t !== null && t > 0 && (m === null || t < m)) m = t;
      });
      return m;
    }
    var F = count(0, 9), B = count(9, 18), startBack = false;
    if (B > 0 && F === 0) startBack = true;
    else if (B > 0 && F > 0) {
      var tf = minTs(0, 9), tb = minTs(9, 18);
      if (tf !== null && tb !== null && tf !== tb) startBack = tb < tf; // 먼저 입력된 쪽이 먼저 친 코스
      else startBack = B === 9 && F < 9;
    }
    return { order: startBack ? back : natural, startBack: startBack };
  }

  /** 플레이어 한 명의 통계. skipHole을 주면 그 홀은 빼고 집계한다 */
  function playerStats(round, pid, ord, skipHole) {
    ord = ord || playOrder(round);
    var pars = round.pars;
    var st = {
      id: pid, played: 0, gross: 0, par: 0, toPar: 0,
      dist: { birdie: 0, par: 0, bogey: 0, double: 0, triple: 0 }, eagles: 0, // birdie = 버디 이하
      byPar: { 3: { n: 0, toPar: 0 }, 4: { n: 0, toPar: 0 }, 5: { n: 0, toPar: 0 } },
      nines: null,                 // 18홀: [{label, n, toPar}, {…}] (친 순서 기준 전반/후반)
      seq: [],                     // 친 순서대로 [{h, gross, diff, cum}]
      best: null, worst: null,     // {h, diff}
      streakBest: 0, streakNow: 0, // 파 이하 연속 (최장 / 지금)
      bounce: { chances: 0, made: 0 }, // 더블 이상 다음 홀에서 파 이하로 만회
      doubles: 0, lostToDoubles: 0,    // 더블 이상 홀 수 / 그 홀들을 보기로 막았다면 줄였을 타수
      ob: 0, hz: 0, bk: 0, penalty: 0,
      putts: { holes: 0, total: 0, one: 0, three: 0 },
      fw: { chances: 0, hit: 0, left: 0, right: 0 }, // 파4·5 티샷: 안착 / 왼쪽 / 오른쪽
      gir: { holes: 0, hit: 0 },   // 퍼트 수를 기록한 홀에서 (타수 − 퍼트) ≤ 파 − 2
      nearest: 0, longest: 0,
      detailHoles: 0               // 상세 기록이 하나라도 있는 홀 수
    };
    var cum = 0, run = 0, prevDiff = null;
    ord.order.forEach(function (h) {
      var g = G.gross(round, pid, h);
      if (g === null || h === skipHole) return; // 스코어가 없는 홀은 상세 기록도 집계하지 않음 (스코어를 지운 뒤 남은 기록이 섞이지 않게)
      var ob = stat(round, pid, h, 'ob'), hz = stat(round, pid, h, 'hz'), bk = stat(round, pid, h, 'bk');
      var pt = stat(round, pid, h, 'pt'), fw = stat(round, pid, h, 'fw');
      if (ob !== null || hz !== null || bk !== null || pt !== null || fw !== null) st.detailHoles++;
      if (ob !== null) st.ob += ob;
      if (hz !== null) st.hz += hz;
      st.penalty += Math.min((ob || 0) * OB_COST + (hz || 0) * HZ_COST, Math.max(0, g - 1)); // 한 홀의 벌타 추정은 그 홀 타수 − 1을 넘지 않음
      if (bk !== null) st.bk += bk;
      if (pt !== null) { st.putts.holes++; st.putts.total += pt; if (pt <= 1) st.putts.one++; if (pt >= 3) st.putts.three++; }
      if (fw !== null && pars[h] >= 4) { st.fw.chances++; if (fw === 1) st.fw.hit++; else if (fw === 2) st.fw.left++; else if (fw === 3) st.fw.right++; }
      var d = g - pars[h];
      cum += d;
      st.played++; st.gross += g; st.par += pars[h];
      st.seq.push({ h: h, gross: g, diff: d, cum: cum });
      if (d <= -2) st.eagles++;
      if (d <= -1) st.dist.birdie++; else if (d === 0) st.dist.par++; else if (d === 1) st.dist.bogey++; else if (d === 2) st.dist.double++; else st.dist.triple++;
      var bp = st.byPar[parKey(pars[h])]; bp.n++; bp.toPar += d;
      if (st.best === null || d < st.best.diff) st.best = { h: h, diff: d };
      if (st.worst === null || d > st.worst.diff) st.worst = { h: h, diff: d };
      if (d <= 0) { run++; if (run > st.streakBest) st.streakBest = run; } else run = 0;
      if (prevDiff !== null && prevDiff >= 2) { st.bounce.chances++; if (d <= 0) st.bounce.made++; }
      if (d >= 2) { st.doubles++; st.lostToDoubles += d - 1; }
      if (pt !== null) { st.gir.holes++; if (g - pt <= pars[h] - 2) st.gir.hit++; }
      prevDiff = d;
    });
    st.streakNow = run;
    st.toPar = st.gross - st.par;
    if (round.holes === 18) {
      var first = ord.order.slice(0, 9), a = { n: 0, toPar: 0 }, b = { n: 0, toPar: 0 };
      st.seq.forEach(function (e) { var t = first.indexOf(e.h) >= 0 ? a : b; t.n++; t.toPar += e.diff; });
      a.label = ord.startBack ? '전반 (10~18번)' : '전반 (1~9번)';
      b.label = ord.startBack ? '후반 (1~9번)' : '후반 (10~18번)';
      st.nines = [a, b];
    }
    // 니어·롱기 횟수는 보너스 설정의 홀 제한(니어는 파3, 롱기는 파5)과 지우개 룰을 따른다 (보너스 탭의 횟수와 같다)
    var rules = (round.games && round.games.bonus) || {};
    for (var xh = 0; xh < round.holes; xh++) { if (G.nearInfo(round, xh, rules).pid === pid) st.nearest++; if (G.longOf(round, xh, rules) === pid) st.longest++; }
    return st;
  }

  /** 티샷이 한쪽으로 쏠리는지: 빗나간 티샷이 3번 이상이고 그중 70% 이상이 같은 쪽이면 'L' 또는 'R' */
  function teeMissSide(st) {
    var miss = st.fw.left + st.fw.right;
    if (miss < 3) return null;
    if (st.fw.right / miss >= 0.7) return 'R';
    if (st.fw.left / miss >= 0.7) return 'L';
    return null;
  }

  /** 경기 현황 (라운드 중간에도 사용). opts.archived = 기록으로 보관된 라운드(홀이 덜 채워졌어도 끝난 라운드로 본다) */
  function roundStatus(round, opts) {
    var ord = playOrder(round);
    var rows = G.strokePlay(round, {}).rows;
    var stats = {};
    round.players.forEach(function (p) { stats[p.id] = playerStats(round, p.id, ord); });
    var active = rows.filter(function (r) { return r.played > 0; });
    var lead = active.length ? active[0].toPar : null;
    var rankCount = {};
    active.forEach(function (r) { rankCount[r.rank] = (rankCount[r.rank] || 0) + 1; });
    var thruAll = 0, h;
    for (h = 0; h < round.holes; h++) if (round.players.every(function (p) { return G.gross(round, p.id, h) !== null; })) thruAll++;
    // 순위를 말해도 되는지: 파 대비 누적은 입력한 홀이 다르면 먼저 입력한 사람이 불리해 보인다.
    //  even    = 스코어가 있는 사람 모두가 정확히 같은 홀들을 입력함 (표의 순위를 그대로 믿어도 됨)
    //  cmpGap  = 모두가 입력한 홀(공통 홀)까지만 비교한 선두와의 타수 차. 각자 입력하는 '내 점수만' 모드에서
    //            한 사람이 한 홀 먼저 입력해도 순위 멘트가 뒤집히지 않게 한다. 누군가 2홀 이상 밀려 있으면 비교하지 않음(null)
    //            두 명 이상이 입력했는데 다른 누군가가 비워 둔 홀이 있을 때도 비교하지 않는다: 그 홀을 빼면 입력한 사람들끼리의 순위가 틀어진다
    var even = true, split = false, common = [], maxPlayed = 0, cmp = {}, cmpLead = null, cmpLeaders = 0;
    for (h = 0; h < round.holes; h++) {
      var entered = 0;
      active.forEach(function (r) { if (r.holes[h] !== null) entered++; });
      if (entered && entered === active.length) common.push(h);
      else if (entered) { even = false; if (entered > 1) split = true; }
    }
    active.forEach(function (r) {
      if (r.played > maxPlayed) maxPlayed = r.played;
      cmp[r.id] = common.reduce(function (a, hh) { return a + r.holes[hh] - round.pars[hh]; }, 0);
      if (cmpLead === null || cmp[r.id] < cmpLead) cmpLead = cmp[r.id];
    });
    active.forEach(function (r) { if (cmp[r.id] === cmpLead) cmpLeaders++; });
    var fair = active.length >= 2 && common.length >= 3 && maxPlayed - common.length <= 1 && !split;
    var players = rows.map(function (r) {
      return { id: r.id, name: r.name, team: r.team, played: r.played, gross: r.gross, toPar: r.toPar, rank: r.rank,
        tied: r.rank !== null && rankCount[r.rank] > 1, gap: r.played ? r.toPar - lead : null, remaining: round.holes - r.played,
        cmpGap: fair && r.played ? cmp[r.id] - cmpLead : null, cmpTied: cmpLeaders > 1 };
    });
    // 최근 3홀 흐름이 가장 좋은 사람 (3홀 이상 친 사람이 2명 이상이고 단독일 때만)
    var hot = null, cands = [];
    round.players.forEach(function (p) {
      var s = stats[p.id].seq; if (s.length < 3) return;
      cands.push({ id: p.id, name: p.name, toPar: s.slice(-3).reduce(function (a, e) { return a + e.diff; }, 0) });
    });
    if (cands.length >= 2) {
      cands.sort(function (a, b) { return a.toPar - b.toPar; });
      if (cands[0].toPar < cands[1].toPar) hot = cands[0];
    }
    // 홀 난이도: 2명 이상이 친 홀의 평균 (파 대비)
    var hard = null, easy = null, nHoles = 0;
    for (h = 0; h < round.holes; h++) {
      var sum = 0, n = 0;
      round.players.forEach(function (p) { var g = G.gross(round, p.id, h); if (g !== null) { sum += g - round.pars[h]; n++; } });
      if (n < 2) continue;
      nHoles++;
      var avg = sum / n;
      if (hard === null || avg > hard.avg) hard = { h: h, avg: avg };
      if (easy === null || avg < easy.avg) easy = { h: h, avg: avg };
    }
    if (nHoles < 3 || (hard && easy && hard.avg === easy.avg)) { hard = null; easy = null; }
    return {
      order: ord.order, startBack: ord.startBack, stats: stats, players: players, active: active.length, even: even,
      thruAll: thruAll, finished: round.status === 'finished' || thruAll === round.holes || !!(opts && opts.archived),
      hot: hot, hardest: hard, easiest: easy
    };
  }

  /**
   * 코치 한마디: 격려(cheers)와 팁(tips)을 우선순위 순으로 돌려준다.
   * 반환 { cheer: 문자열, cheers: [문자열], tips: [문자열] }
   */
  function coach(round, pid, status) {
    status = status || roundStatus(round);
    var st = status.stats[pid];
    if (!st) return { cheer: '', lead: '', cheers: [], tips: [] };
    var me = null;
    status.players.forEach(function (p) { if (p.id === pid) me = p; });
    var fin = status.finished;
    var over = fin || st.played >= round.holes; // 이 플레이어는 더 칠 홀이 없음 → '지금/방금/다음/남은' 류의 문구를 쓰지 않음
    var seed = st.played + hashStr(pid);
    function pick(arr) { return arr[seed % arr.length]; }
    if (st.played === 0) {
      return { cheer: '아직 기록 전이에요. 첫 홀은 가볍게, 리듬부터 찾아요.', lead: '아직 기록 전이에요. 첫 홀은 가볍게, 리듬부터 찾아요.', cheers: ['아직 기록 전이에요. 첫 홀은 가볍게, 리듬부터 찾아요.'],
        tips: ['티샷 전에 목표 지점 하나만 정하고 평소 루틴대로 쳐 보세요.'] };
    }
    var cheers = [], tips = [];
    function cheer(w, text) { cheers.push({ w: w, text: text }); }
    function tip(w, text) { tips.push({ w: w, text: text }); }
    var seq = st.seq, last = seq[seq.length - 1], prev = seq.length >= 2 ? seq[seq.length - 2] : null;
    var no = last.h + 1;
    var last3 = seq.slice(-3), last3Sum = last3.reduce(function (a, e) { return a + e.diff; }, 0);
    var slump = last3.length === 3 && last3.every(function (e) { return e.diff >= 1; }) && last3Sum >= 5;
    var ptAvg = st.putts.holes ? st.putts.total / st.putts.holes : null;
    var types = [3, 4, 5].filter(function (t) { return st.byPar[t].n >= 2; }).map(function (t) { return { t: t, avg: st.byPar[t].toPar / st.byPar[t].n }; });
    types.sort(function (a, b) { return a.avg - b.avg; });
    var n1 = st.nines ? st.nines[0] : null, n2 = st.nines ? st.nines[1] : null;
    // 전·후반 비교는 전반 기록이 절반 넘게 있을 때만 (8~9번홀부터 기록을 시작한 사람에게 1~2홀로 추세를 말하지 않도록)
    var avg1 = n1 && n1.n >= 5 ? n1.toPar / n1.n : null, avg2 = n2 && n2.n >= 3 ? n2.toPar / n2.n : null;

    // ── 격려
    if (!over && last.diff <= -2) cheer(110, no + '번홀 이글! 🦅 오늘의 한 방이에요.');
    else if (!over && last.diff === -1) cheer(100, no + '번홀 버디! 🎉 그 리듬 그대로 가요.');
    if (!over && prev && prev.diff >= 2 && last.diff <= 0) cheer(95, (prev.h + 1) + '번홀 실수 뒤에 바로 ' + G.toParLabel(last.diff) + '로 만회했어요. 멘탈이 좋아요!');
    if (!over && st.streakNow >= 3) cheer(90, '최근 ' + st.streakNow + '홀 연속 파 이하! 흐름이 아주 좋아요.');
    else if (!over && st.streakNow === 2) cheer(60, '두 홀 연속 파 이하, 감이 올라오고 있어요.');
    if (!over && G.nearInfo(round, last.h, (round.games && round.games.bonus) || {}).pid === pid) cheer(85, no + '번홀 니어리스트! 아이언 샷이 날카로워요.');
    if (me && status.active >= 2 && st.played >= 3) {
      if (fin) { // 최종 순위는 모두 같은 홀을 입력했을 때만 말한다 (9홀만 입력된 사람이 1위가 되지 않게)
        if (status.even && me.rank === 1) cheer(me.tied ? 75 : 80, me.tied ? '공동 1위로 마쳤어요. 멋진 라운드였어요!' : '오늘의 1위! 축하해요 🏆');
      } else if (!over && me.cmpGap !== null) { // 진행 중: 모두가 입력한 홀까지만 비교
        if (me.cmpGap === 0 && !me.cmpTied) cheer(80, '지금 단독 선두예요. 욕심내지 말고 하던 대로만 가요.');
        else if (me.cmpGap === 0) cheer(75, '공동 선두예요. 한 홀 한 홀 집중하면 됩니다.');
        else if (me.cmpGap <= 3 && me.remaining >= me.cmpGap) cheer(70, '선두와 ' + me.cmpGap + '타 차, 남은 ' + me.remaining +
          (me.remaining >= me.cmpGap + 2 ? '홀이면 충분히 뒤집을 수 있어요.' : '홀까지 포기하지 마세요. 아직 기회는 있어요.')); // 여유가 없을 때는 '충분히'라고 하지 않는다
      }
    }
    if (st.dist.birdie >= 2) cheer(58, '오늘 버디가 ' + st.dist.birdie + '개! 공격적인 플레이가 통하고 있어요.');
    if (avg1 !== null && avg2 !== null && avg2 <= avg1 - 0.3) cheer(65, '후반 들어 홀당 ' + fmt1(avg1 - avg2) + '타씩 좋아졌어요.');
    if (st.played >= 6 && st.doubles === 0) cheer(55, st.played + '홀 동안 더블보기 없이 안정적이에요.');
    if (st.streakBest >= 4 && st.streakNow < 3) cheer(52, '파 이하를 ' + st.streakBest + '홀 연속으로 이어 간 구간이 있었어요. 그 리듬을 기억해요.');
    if (st.played >= 5 && types.length && types[0].avg <= 0.5) cheer(50, '파' + types[0].t + '에서 평균 ' + fmtAvg(types[0].avg) + ', 여기가 강점이에요.');
    if (st.putts.holes >= 4 && ptAvg <= 1.8) cheer(50, '퍼트가 홀당 ' + fmt1(ptAvg) + '개, 그린 위에서 든든해요.');
    if (st.fw.chances >= 4 && st.fw.hit / st.fw.chances >= 0.6) cheer(45, '페어웨이 안착 ' + st.fw.hit + '/' + st.fw.chances + ', 티샷이 안정적이에요.');
    if (st.bounce.made >= 2) cheer(48, '큰 실수 뒤에 ' + st.bounce.made + '번이나 바로 만회했어요. 회복력이 좋아요.');
    if (!over && (slump || st.toPar / st.played >= 2)) cheer(40, '스코어는 잠시 잊어요. 다음 한 샷만 잘 치면 흐름은 금방 바뀝니다.');
    if (over) cheer(20, '수고하셨어요! 오늘 기록을 다음 라운드의 목표로 삼아 보세요.');
    // 다른 격려가 하나도 없을 때만 쓰는 기본 문구. 격려는 항상 한 줄 이상이어야 한다(아래에서 c[0]을 읽음)
    if (!cheers.length) cheer(10, last.diff >= 2 ? '괜찮아요, 누구나 그런 홀이 있어요. 다음 홀부터 다시 차분하게 가요.'
      : pick(['좋은 페이스예요. 한 홀씩 차분하게 가요.', '지금처럼 한 샷 한 샷 집중하면 됩니다.', '스윙 리듬 괜찮아요. 끝까지 같은 템포로!']));

    // ── 팁
    var lastOb = stat(round, pid, last.h, 'ob'), lastHz = stat(round, pid, last.h, 'hz');
    if (!over && last.diff >= 3) tip(100, no + '번홀은 잊어요. 다음 티샷은 평소 루틴대로, 스윙은 80%만.');
    if (!over && lastOb) tip(98, '방금 OB가 나왔어요. 다음 티샷은 넓은 쪽을 겨냥하고, 좁은 홀이면 우드나 유틸리티도 좋아요.');
    if (!over && lastHz) tip(90, '방금 해저드는 잊고, 다음 샷은 안전한 쪽으로 넉넉하게 겨냥하세요.');
    if (st.ob >= 2) tip(88, 'OB가 ' + st.ob + '번 나와 약 ' + (st.ob * OB_COST) + '타를 잃었어요. 좁은 홀에서는 드라이버를 내려놓고 페어웨이를 먼저 지키세요.');
    else if (st.ob === 1 && !lastOb) tip(40, 'OB 1번으로 약 ' + OB_COST + '타 손실. 위험한 쪽만 피해서 겨냥해도 충분해요.');
    if (st.putts.three >= 2) tip(85, '3퍼트가 ' + st.putts.three + '번 나왔어요. 첫 퍼트는 넣으려 하기보다 홀 1m 안에 붙이는 거리감에 집중해 보세요.');
    else if (st.putts.holes >= 4 && ptAvg >= 2.3) tip(60, '퍼트가 홀당 ' + fmt1(ptAvg) + '개예요. 어프로치를 핀보다 그린 중앙으로 보내면 긴 퍼트가 줄어듭니다.');
    if (!over && slump) tip(82, '최근 3홀이 힘들었어요. 물 한 모금 마시고 스윙 템포를 한 박자 늦춰 보세요.');
    if (st.hz >= 2) tip(80, '해저드에 ' + st.hz + '번 들어갔어요. 물 앞에서는 한 클럽 길게 잡거나, 과감히 끊어 가는 쪽이 타수를 아낍니다.');
    if (st.doubles >= 2) tip(75, '더블보기 이상이 ' + st.doubles + '홀이에요. 이 홀들을 보기로만 막았어도 ' + st.lostToDoubles + '타를 줄였어요. 위기에서는 무리하지 말고 \'보기 작전\'으로.');
    var missSide = teeMissSide(st);
    if (missSide) tip(72, '티샷이 ' + (missSide === 'R' ? '오른쪽' : '왼쪽') + '으로 ' + (missSide === 'R' ? st.fw.right : st.fw.left) + '번 빗나갔어요. 어드레스에서 겨냥을 조금 ' + (missSide === 'R' ? '왼쪽' : '오른쪽') + '으로 두고 템포를 늦춰 보세요.');
    else if (st.fw.chances >= 4 && st.fw.hit / st.fw.chances < 0.4) tip(70, '페어웨이 안착 ' + st.fw.hit + '/' + st.fw.chances + '. 티샷은 힘을 빼고 80% 스윙으로 방향부터 잡아 보세요.');
    if (st.bk >= 2) tip(62, '벙커에 ' + st.bk + '번 빠졌어요. 벙커에서는 핀이 아니라 그린 넓은 쪽을 보고 한 번에 탈출하는 게 먼저예요.');
    if (avg1 !== null && avg2 !== null && avg2 >= avg1 + 0.5) tip(62, '후반 들어 홀당 ' + fmt1(avg2 - avg1) + '타 늘었어요. 힘이 빠질 때는 한 클럽 길게 잡고 부드럽게 치세요.');
    if (st.played >= 5 && types.length >= 2) {
      var worst = types[types.length - 1];
      if (worst.avg >= 1.5 && worst.avg - types[0].avg >= 0.5) {
        tip(55, worst.t === 3 ? '파3에서 평균 ' + fmtAvg(worst.avg) + '. 핀을 직접 노리기보다 그린 중앙을 겨냥해 보세요.'
          : worst.t === 5 ? '파5에서 평균 ' + fmtAvg(worst.avg) + '. 2온 욕심보다 세 번에 나눠 가는 편이 안전해요.'
          : '파4에서 평균 ' + fmtAvg(worst.avg) + '. 세컨드 샷이 편한 위치로 티샷을 보내는 것부터 생각해 보세요.');
      }
    }
    if (!over && me && me.cmpGap === 0 && me.remaining >= 1 && me.remaining <= 6 && st.played >= 3) tip(50, '선두일수록 안전하게. 어려운 핀은 피하고 그린 중앙을 보세요.');
    if (st.detailHoles === 0 && st.played >= 3) tip(15, 'OB·해저드·퍼트 수를 함께 기록하면 더 정확한 팁을 드릴 수 있어요.');
    tip(10, pick(['티샷 전에 목표 지점 하나만 정하고, 결과보다 루틴에 집중해 보세요.', '그린 주변에서는 굴릴 수 있으면 굴리는 쪽이 실수가 적어요.', '애매한 거리에서는 한 클럽 길게 잡고 부드럽게 치는 편이 좋아요.']));

    function top(list, n) {
      return list.map(function (e, i) { e.i = i; return e; }).sort(function (a, b) { return b.w - a.w || a.i - b.i; }).slice(0, n);
    }
    var c = top(cheers, 3), t = top(tips, 3);
    // 한 줄만 보여줄 때: 방금 일어난 일에 대한 급한 팁(가중치 80 이상)이 격려보다 중요하면 팁, 아니면 격려
    var lead = t.length && t[0].w >= 80 && t[0].w > c[0].w ? t[0].text : c[0].text;
    function texts(a) { return a.map(function (e) { return e.text; }); }
    return { cheer: c[0].text, lead: lead, cheers: texts(c), tips: texts(t) };
  }

  // ───────────────────────── 코스 정보 → 홀 공략 ─────────────────────────
  /** 위험 요소 비트. 라운드에는 holeInfo[h].haz 비트마스크로 저장하고, 공유할 때는 비트마다 따로 보낸다(sync.js의 hi:<h>:z<비트>) */
  var HAZ = { OB_L: 1, OB_R: 2, WATER_L: 4, WATER_R: 8, WATER_FRONT: 16, BUNKER_L: 32, BUNKER_R: 64, BUNKER_GREEN: 128 };
  var HAZ_LABELS = [[1, 'OB 좌'], [2, 'OB 우'], [4, '해저드 좌'], [8, '해저드 우'], [16, '그린 앞 해저드'], [32, '벙커 좌'], [64, '벙커 우'], [128, '그린 주변 벙커']];
  /** 위험 요소를 종류별로 묶은 것 (입력 칸의 줄, 요약 라벨). l/r: 좌·우 비트, g: 그린 쪽 비트와 그 위치 이름 */
  var HAZ_GROUPS = [
    { name: 'OB', l: 1, r: 2 },
    { name: '해저드', l: 4, r: 8, g: 16, gName: '그린 앞' },
    { name: '벙커', l: 32, r: 64, g: 128, gName: '그린 주변' }
  ];
  /** 종류별로 묶은 위험 요소 라벨: 1|2 → ['OB 좌우'], 32|64|128 → ['벙커 좌우·그린 주변'], 16 → ['그린 앞 해저드'] */
  function hazLabels(haz) {
    var out = [];
    HAZ_GROUPS.forEach(function (g) {
      var side = (haz & g.l) && (haz & g.r) ? '좌우' : (haz & g.l) ? '좌' : (haz & g.r) ? '우' : '';
      var green = g.g && (haz & g.g) ? g.gName : '';
      if (side && green) out.push(g.name + ' ' + side + '·' + green);
      else if (side) out.push(g.name + ' ' + side);
      else if (green) out.push(green + ' ' + g.name);
    });
    return out;
  }
  /**
   * 공략 메모는 짧은 키워드 여러 개로 다룬다. 저장·공유는 예전처럼 문자열 한 칸(memo)이고 키워드 사이를 ' · '로 잇는다
   * (옛 버전 기기에는 그 문자열이 그대로 보인다). 쉼표·가운뎃점·줄바꿈, 문장 끝의 마침표에서 나누므로 예전에 문장으로 적어 둔 메모도 토막으로 보인다.
   */
  var MEMO_SEP = ' · ';
  function memoWords(memo) {
    var out = [], seen = {};
    String(memo === null || memo === undefined ? '' : memo).split(/[·,，、;\r\n]+|\.(?=\s|$)/).forEach(function (w) {
      w = w.replace(/\s+/g, ' ').trim();
      if (w && !seen['k' + w]) { seen['k' + w] = 1; out.push(w); }
    });
    return out;
  }
  /**
   * 메모 번역표 (앱이 등록): 기본 제공 코스의 예전 문장형 메모 → 지금의 키워드 메모. 그 문장이 그대로 남은 칸만 읽을 때 바꿔 준다.
   * 값은 키워드 문자열이거나 { m: 키워드, z: 위험 요소 비트 }. z는 그때 자료에는 표시가 없었지만 그 문장이 말하던 OB 쪽으로,
   * 읽을 때 그 홀의 위험 요소에 더한다 → 예전 자료로 만든 라운드·저장 코스도 지금 자료와 똑같이 보이고, 공략 팁이 OB 쪽을 피한다
   */
  var memoUpgrades = {};
  function setMemoUpgrades(map) { memoUpgrades = map && typeof map === 'object' ? map : {}; }
  var SHAPE_LABELS = { S: '직선', L: '좌 도그렉', R: '우 도그렉' };

  /** 한 홀의 코스 정보 (없으면 빈 값) */
  /**
   * 홀 형태를 따로 정해 주는 함수 (앱이 등록). 코스 안내도 약도가 있는 홀은 라운드에 저장된 값이 아니라 약도 기준 형태를 쓴다.
   * fn(round, h) → 'S' | 'L' | 'R' | null(형태 없음, 예: 파3) | undefined(정해 주지 않음 → 저장된 값 그대로)
   */
  var shapeSource = null;
  function setShapeSource(fn) { shapeSource = typeof fn === 'function' ? fn : null; }
  /**
   * 홀 정보가 비어 있을 때 대신 쓸 자료를 주는 함수 (앱이 등록). 코스 안내도 약도가 있는 코스 이름을 라운드에 붙이기만 한 경우
   * (자료를 불러오지 않고 라운드 설정에서 이름만 적음)에도 그 코스의 거리·위험 요소·키워드가 보이게 한다. 저장된 값은 그대로 비어 있다.
   * fn(round, h) → { dist, haz, memo } | null
   */
  var infoFallback = null;
  function setInfoFallback(fn) { infoFallback = typeof fn === 'function' ? fn : null; }
  function holeInfo(round, h) {
    var i = (round.holeInfo && round.holeInfo[h]) || {};
    if (infoFallback && !(i.dist || i.haz || i.memo)) i = infoFallback(round, h) || i;
    var dist = num(i.dist), haz = num(i.haz);
    var shape = shapeSource ? shapeSource(round, h) : undefined;
    if (shape === undefined) shape = i.shape;
    var memo = typeof i.memo === 'string' ? i.memo : '';
    haz = haz !== null && haz > 0 ? haz : 0;
    var up = memo && Object.prototype.hasOwnProperty.call(memoUpgrades, memo) ? memoUpgrades[memo] : null;
    if (typeof up === 'string') memo = up;
    else if (up && typeof up.m === 'string') { memo = up.m; if (up.z > 0) haz |= up.z & 3; }
    return {
      dist: dist !== null && dist > 0 ? dist : null,
      shape: shape === 'S' || shape === 'L' || shape === 'R' ? shape : null,
      haz: haz,
      memo: memo
    };
  }
  function hasHoleInfo(round, h) { var i = holeInfo(round, h); return !!(i.dist || i.shape || i.haz || i.memo); }
  /** 한 줄 요약에 쓸 라벨들: ['352m', '좌 도그렉', 'OB 좌우', '벙커 우·그린 주변', …] (위험 요소는 종류별로 묶는다) */
  function holeLabels(round, h) {
    var i = holeInfo(round, h), out = [];
    if (i.dist) out.push(i.dist + 'm');
    if (i.shape) out.push(SHAPE_LABELS[i.shape]);
    return out.concat(hazLabels(i.haz));
  }
  /**
   * 입력된 코스 정보(와 오늘의 내 기록)로 만드는 홀 공략 팁. 정보가 없으면 빈 배열.
   * pid를 주면 그 플레이어의 오늘 기록(이 홀은 제외)을 반영한 한 줄이 추가된다.
   * 이 홀의 기록을 빼는 이유: 이 홀 점수를 입력하는 동안 팁이 생겼다 사라지면 화면이 밀려 다른 사람 칸을 누르게 된다.
   */
  function holeTips(round, h, pid) {
    var i = holeInfo(round, h), par = round.pars[h], tips = [];
    if (!(i.dist || i.shape || i.haz)) return tips;
    var obL = !!(i.haz & HAZ.OB_L), obR = !!(i.haz & HAZ.OB_R), wL = !!(i.haz & HAZ.WATER_L), wR = !!(i.haz & HAZ.WATER_R);
    var dangerL = obL || wL, dangerR = obR || wR;
    var bL = !!(i.haz & HAZ.BUNKER_L), bR = !!(i.haz & HAZ.BUNKER_R);
    function what(ob, w) { return ob && w ? 'OB와 해저드' : ob ? 'OB' : '해저드'; }
    var par3 = par <= 3;        // 파3는 티샷이 곧 그린 공략이라 페어웨이·도그렉 문구를 쓰지 않는다
    var outDanger = false;       // 도그렉 바깥쪽(시야가 열리는 쪽)이 OB·해저드인 홀
    // 티샷 방향 — 좌/우/가운데를 가리키는 문장이 서로 엇갈리지 않게 한 가지 목표만 안내한다
    if (par3) {
      if (dangerL && dangerR) tips.push('그린 양쪽이 모두 위험해요. 핀을 직접 노리지 말고 그린 가운데를 겨냥하세요.');
      else if (dangerL) tips.push('왼쪽이 ' + what(obL, wL) + '예요. 그린 가운데보다 오른쪽을 겨냥하세요.');
      else if (dangerR) tips.push('오른쪽이 ' + what(obR, wR) + '예요. 그린 가운데보다 왼쪽을 겨냥하세요.');
      else if (bL && bR) tips.push('그린 양쪽에 벙커가 있어요. 핀보다 그린 가운데를 겨냥하세요.');
      else if (bL) tips.push('그린 왼쪽 벙커를 피해 가운데보다 오른쪽을 겨냥하세요.');
      else if (bR) tips.push('그린 오른쪽 벙커를 피해 가운데보다 왼쪽을 겨냥하세요.');
    } else {
      var bend = i.shape === 'L' ? '왼쪽' : i.shape === 'R' ? '오른쪽' : '';   // 홀이 휘는 쪽 = 코너 안쪽
      var outer = i.shape === 'L' ? '오른쪽' : '왼쪽';                          // 코너 바깥쪽 = 다음 샷의 시야가 열리는 쪽
      var outBunker = !!bend && (i.shape === 'L' ? bR : bL);
      var centre = bend + '으로 휘는 홀이에요. 코너를 가로지르려 하지 말고 페어웨이 가운데로 보내세요.';
      outDanger = !!bend && (i.shape === 'L' ? dangerR : dangerL);
      if (dangerL && dangerR) {
        tips.push('양쪽이 모두 위험한 홀이에요. 거리 욕심을 버리고 페어웨이를 먼저 지키세요.');
        if (bend) tips.push(centre);
      } else if (outDanger) {
        tips.push(bend + '으로 휘는 홀인데 바깥쪽(' + outer + ')이 ' + (i.shape === 'L' ? what(obR, wR) : what(obL, wL)) + '예요. 코너를 가로지르려 하지 말고 페어웨이 가운데를 겨냥하세요.');
      } else {
        if (dangerL) tips.push('왼쪽이 ' + what(obL, wL) + '예요. 티샷은 페어웨이 오른쪽 절반을 겨냥하세요.');
        else if (dangerR) tips.push('오른쪽이 ' + what(obR, wR) + '예요. 티샷은 페어웨이 왼쪽 절반을 겨냥하세요.');
        if (bend) {
          if (dangerL || dangerR || !outBunker) tips.push(bend + '으로 휘는 홀이에요. 티샷을 페어웨이 ' + outer + '으로 보내면 다음 샷의 시야가 열려요.');
          else if (bL && bR) tips.push(centre);
          else tips.push(bend + '으로 휘는 홀인데 바깥쪽(' + outer + ')에 벙커가 있어요. 페어웨이 가운데를 겨냥하고, 벙커에 못 미치는 클럽으로 끊어 가는 것도 방법이에요.');
        }
      }
      if (bL && bR) tips.push('페어웨이 양쪽에 벙커가 있어요. 벙커에 못 미치는 클럽으로 끊어 가는 것도 방법이에요.');
      else if (!outDanger && !outBunker) {   // 바깥쪽이 막힌 도그렉은 위에서 이미 '가운데'로 안내했다
        // 한쪽이 OB·해저드라 이미 반대쪽을 겨냥하라고 했으면 벙커 때문에 같은 말을 또 하지 않는다
        if (bL && !dangerL && !dangerR) tips.push('페어웨이 왼쪽 벙커를 피해 오른쪽으로 겨냥하세요.');
        else if (bR && !dangerL && !dangerR) tips.push('페어웨이 오른쪽 벙커를 피해 왼쪽으로 겨냥하세요.');
      }
    }
    var aimed = par3 && tips.length > 0;   // 파3에서 이미 겨냥할 곳을 안내했으면 같은 샷에 대한 문장을 더 붙이지 않는다
    // 그린 공략
    if (i.haz & HAZ.WATER_FRONT) tips.push(par3 ? '그린 앞에 해저드가 있어요. 짧으면 물이니 한 클럽 길게 잡으세요.' : '그린 앞에 해저드가 있어요. 한 클럽 길게 잡고, 거리가 애매하면 끊어 가세요.');
    if ((i.haz & HAZ.BUNKER_GREEN) && !aimed) tips.push('그린 주변에 벙커가 있어요. 핀보다 그린 가운데를 겨냥하세요.');
    // 거리
    if (i.dist) {
      if (par <= 3) {
        if (i.dist >= 170) tips.push('긴 파3(' + i.dist + 'm)예요. 짧게 떨어지는 것보다 한 클럽 길게 잡는 편이 좋아요.');
        else if (i.dist <= 120) tips.push('짧은 파3(' + i.dist + 'm)예요. 니어리스트를 노려 볼 만해요.');
      } else if (par === 4) {
        if (i.dist >= 380) tips.push('긴 파4(' + i.dist + 'm)예요. 무리한 2온보다 3온 1퍼트 작전도 좋아요.');
        else if (i.dist <= 300) tips.push('짧은 파4(' + i.dist + 'm)예요. 티샷은 거리보다 정확도가 먼저예요.');
      } else {
        if (i.dist >= 500) tips.push('긴 파5(' + i.dist + 'm)예요. 세 번에 나눠 가며 매 샷 페어웨이를 지키세요.');
        else if (i.dist <= 440) tips.push('짧은 파5(' + i.dist + 'm)예요. 티샷이 잘 맞으면 버디 기회예요.');
      }
    }
    // 오늘의 내 기록을 반영한 한 줄. 맨 앞에 넣는 줄은 4줄 제한에 더해 준다 → 코스 경고(그린 앞 해저드 등)가 밀려서 잘리지 않는다
    var cap = 4;
    function lead(t) { tips.unshift(t); cap = 5; }
    if (pid && G.playerById(round, pid)) {
      var st = playerStats(round, pid, null, h);
      if (st.played) {
        var bp = st.byPar[parKey(par)];
        var side = teeMissSide(st);
        var steady = '거리보다 방향이 먼저예요. 가장 자신 있는 클럽을 잡으세요.';   // 바깥쪽이 위험한 도그렉에서는 '가운데' 안내와 엇갈리지 않게 방향을 말하지 않는다
        if (side === 'R' && dangerR && !dangerL) lead('오늘 티샷이 오른쪽으로 자주 빗나갔는데 이 홀은 오른쪽이 위험해요. ' + (outDanger ? steady : '왼쪽을 넉넉히 보고 치세요.'));
        else if (side === 'L' && dangerL && !dangerR) lead('오늘 티샷이 왼쪽으로 자주 빗나갔는데 이 홀은 왼쪽이 위험해요. ' + (outDanger ? steady : '오른쪽을 넉넉히 보고 치세요.'));
        else if (st.ob >= 2 && (obL || obR)) lead('오늘 OB가 ' + st.ob + '번 나왔어요. 이 홀도 OB가 있으니 티샷은 가장 자신 있는 클럽으로.');
        else if (st.hz >= 2 && (wL || wR || (i.haz & HAZ.WATER_FRONT))) lead('오늘 해저드에 ' + st.hz + '번 들어갔어요. 이 홀의 물은 넉넉하게 피해서 겨냥하세요.');
        else if (bp.n >= 2 && bp.toPar / bp.n >= 1.5) tips.push('오늘 파' + parKey(par) + '에서 평균 ' + fmtAvg(bp.toPar / bp.n) + '예요. 이 홀은 무리하지 말고 보기로 막는 작전이 좋아요.');
      }
    }
    return tips.slice(0, cap);
  }

  return {
    BUILD: 18, // 앱 버전(sw.js의 캐시 번호와 같다). app.js가 파일들의 짝이 맞는지 확인하는 데 쓴다
    OB_COST: OB_COST, HZ_COST: HZ_COST, HAZ: HAZ, HAZ_LABELS: HAZ_LABELS, SHAPE_LABELS: SHAPE_LABELS, setShapeSource: setShapeSource, setInfoFallback: setInfoFallback,
    HAZ_GROUPS: HAZ_GROUPS, hazLabels: hazLabels, MEMO_SEP: MEMO_SEP, memoWords: memoWords, setMemoUpgrades: setMemoUpgrades,
    stat: stat, playOrder: playOrder, playerStats: playerStats, roundStatus: roundStatus, coach: coach, teeMissSide: teeMissSide,
    holeInfo: holeInfo, hasHoleInfo: hasHoleInfo, holeLabels: holeLabels, holeTips: holeTips,
    fmtAvg: fmtAvg
  };
});
