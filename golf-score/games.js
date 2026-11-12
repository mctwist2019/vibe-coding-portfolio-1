/*
 * games.js — 골프 스코어 / 내기 게임 계산 로직 (순수 함수)
 * 브라우저(window.GolfGames2)와 Node(require) 양쪽에서 사용 가능.
 */
(function (root, factory) {
  var api = factory();
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
  root.GolfGames2 = api; // 이름의 2: 예전 app.js(이 이름을 모른다)가 새 파일과 섞여 실행되면 '업데이트 중' 안내를 띄우게 한다
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_SI_18 = [9, 3, 15, 7, 1, 13, 5, 17, 11, 10, 4, 16, 8, 2, 14, 6, 18, 12];
  var DEFAULT_SI_9 = [5, 1, 7, 3, 9, 2, 8, 4, 6];
  var DEFAULT_PAR_9 = [4, 4, 3, 5, 4, 4, 3, 4, 5];

  function defaultStrokeIndex(n) {
    return n === 9 ? DEFAULT_SI_9.slice() : DEFAULT_SI_18.slice();
  }
  function defaultPars(n) {
    return n === 9 ? DEFAULT_PAR_9.slice() : DEFAULT_PAR_9.concat(DEFAULT_PAR_9);
  }

  /** 핸디캡을 홀별 보너스 타수로 분배. 9홀 라운드는 핸디캡의 절반을 적용. */
  function strokesPerHole(hcp, holes, strokeIndex) {
    var h = Math.max(0, Math.round(Number(hcp) || 0));
    var eff = holes === 9 ? Math.round(h / 2) : h;
    var base = Math.floor(eff / holes);
    var extra = eff % holes;
    var si = strokeIndex && strokeIndex.length === holes ? strokeIndex : defaultStrokeIndex(holes);
    var order = si.map(function (v, i) { return [v, i]; }).sort(function (a, b) { return a[0] - b[0]; });
    var arr = [];
    for (var i = 0; i < holes; i++) arr.push(base);
    for (var k = 0; k < extra; k++) arr[order[k][1]] += 1;
    return arr;
  }

  /**
   * 한 홀에서 세는 가장 큰 타수. 보통은 15타이고, '양파 한도'(round.games.stroke.cap)를 켠 라운드는 파의 두 배까지만 센다
   * (파3 6타 · 파4 8타 · 파5 10타)
   */
  function maxScore(round, h) {
    var cap = !!(round.games && round.games.stroke && round.games.stroke.cap), par = Number(round.pars && round.pars[h]);
    return cap && par > 0 ? Math.min(15, par * 2) : 15;
  }
  /**
   * 홀 타수(없으면 null). 모든 순위·게임·분석이 이 값을 쓴다. 양파 한도를 켜면 그보다 크게 적힌 타수
   * (한도를 켜기 전에 넣었거나 예전 버전 기기가 넣은 값)도 한도로 센다. 저장된 값은 그대로 둔다
   */
  function gross(round, pid, h) {
    var s = round.scores && round.scores[pid];
    var v = s ? s[h] : null;
    return typeof v === 'number' && v > 0 ? Math.min(v, maxScore(round, h)) : null;
  }

  function strokesMap(round) {
    var m = {};
    round.players.forEach(function (p) {
      m[p.id] = strokesPerHole(p.hcp, round.holes, round.strokeIndex);
    });
    return m;
  }

  function score(round, pid, h, useNet, sm) {
    var g = gross(round, pid, h);
    if (g === null) return null;
    if (!useNet) return g;
    sm = sm || strokesMap(round);
    return g - sm[pid][h];
  }

  /** 파 대비 타수의 이름. par를 주면 파의 두 배(양파)를 '양파'라고 부른다 */
  function toParLabel(diff, par) {
    if (par > 0 && diff === par) return '양파';
    if (diff <= -3) return '알바트로스';
    if (diff === -2) return '이글';
    if (diff === -1) return '버디';
    if (diff === 0) return '파';
    if (diff === 1) return '보기';
    if (diff === 2) return '더블보기';
    if (diff === 3) return '트리플보기';
    return '+' + diff;
  }

  /** toParLabel의 짧은 이름 (좁은 표용): 더블보기 → 더블, 트리플보기 → 트리플. 나머지는 같다 */
  function toParShort(diff, par) {
    var t = toParLabel(diff, par);
    return t === '더블보기' ? '더블' : t === '트리플보기' ? '트리플' : t;
  }

  function fmtToPar(d) {
    if (d === 0) return 'E';
    return d > 0 ? '+' + d : String(d);
  }

  function playerById(round, pid) {
    for (var i = 0; i < round.players.length; i++) if (round.players[i].id === pid) return round.players[i];
    return null;
  }

  /** 팀 목록: [{id:'A', name:'A팀', pids:[...]}] (팀 미지정 선수 제외) */
  function teamsOf(round) {
    var map = {};
    round.players.forEach(function (p) {
      if (!p.team) return;
      if (!map[p.team]) map[p.team] = { id: p.team, name: p.team + '팀', pids: [] };
      map[p.team].pids.push(p.id);
    });
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }

  function holeCompleteFor(round, pids, h) {
    for (var i = 0; i < pids.length; i++) if (gross(round, pids[i], h) === null) return false;
    return true;
  }

  /** 팀 홀 점수: 가장 좋은 count개의 합 (전원 입력 전이면 null) */
  function teamHoleScore(round, pids, h, useNet, count, sm) {
    var arr = [];
    for (var i = 0; i < pids.length; i++) {
      var s = score(round, pids[i], h, useNet, sm);
      if (s === null) return null;
      arr.push(s);
    }
    arr.sort(function (a, b) { return a - b; });
    var n = Math.min(count || 1, arr.length);
    var sum = 0;
    for (var k = 0; k < n; k++) sum += arr[k];
    return sum;
  }

  /**
   * 팀에서 그 홀에 적용된 타수(가장 좋은 타수)와 그 타수를 친 사람들. 전원 입력 전이면 null.
   * 타수는 teamHoleScore(…, count 1)과 같다. 같은 타수를 친 사람이 여럿이면 모두 넣는다. 화면에 보여 주는 데만 쓴다
   */
  function teamHoleBest(round, pids, h, useNet, sm) {
    var best = null, who = [];
    for (var i = 0; i < pids.length; i++) {
      var s = score(round, pids[i], h, useNet, sm);
      if (s === null) return null;
      if (best === null || s < best) { best = s; who = [pids[i]]; }
      else if (s === best) who.push(pids[i]);
    }
    return best === null ? null : { score: best, pids: who };
  }

  /** 송금 생성: 승자(들)에게 패자 각각이 unit씩 지급. 승자 여러 명이면 균등 분배 */
  function makeTransfers(winnerPids, loserPids, amountPerLoser, game, note) {
    var out = [];
    if (!winnerPids.length || !loserPids.length || !amountPerLoser) return out;
    var share = amountPerLoser / winnerPids.length;
    loserPids.forEach(function (from) {
      winnerPids.forEach(function (to) {
        out.push({ from: from, to: to, amount: share, game: game, note: note || '' });
      });
    });
    return out;
  }

  // ───────────────────────── 스트로크 플레이 ─────────────────────────
  function strokePlay(round, opt) {
    opt = opt || {};
    var sm = strokesMap(round);
    var rows = round.players.map(function (p) {
      var g = 0, n = 0, par = 0, played = 0, holesArr = [];
      for (var h = 0; h < round.holes; h++) {
        var gs = gross(round, p.id, h);
        holesArr.push(gs);
        if (gs === null) continue;
        played++;
        g += gs;
        n += gs - sm[p.id][h];
        par += round.pars[h];
      }
      return {
        id: p.id, name: p.name, team: p.team || null, hcp: p.hcp || 0,
        played: played, gross: g, net: n, par: par,
        toPar: g - par, netToPar: n - par, holes: holesArr
      };
    });
    var useNet = !!opt.net;
    var sorted = rows.slice().sort(function (a, b) {
      var ka = useNet ? a.netToPar : a.toPar, kb = useNet ? b.netToPar : b.toPar;
      if (a.played === 0 && b.played === 0) return 0;
      if (a.played === 0) return 1;
      if (b.played === 0) return -1;
      return ka - kb;
    });
    var rank = 0, prev = null;
    sorted.forEach(function (r, i) {
      var key = useNet ? r.netToPar : r.toPar;
      if (r.played === 0) { r.rank = null; return; }
      if (prev === null || key !== prev) { rank = i + 1; prev = key; }
      r.rank = rank;
    });

    // 스트로크 내기: 모두 완료한 홀을 기준으로 타수 차 × 단가 (쌍별)
    var transfers = [];
    var unit = Number(opt.unit) || 0;
    if (unit > 0 && rows.length >= 2) {
      var allPids = round.players.map(function (p) { return p.id; });
      var common = [];
      for (var h = 0; h < round.holes; h++) if (holeCompleteFor(round, allPids, h)) common.push(h);
      var totals = {};
      rows.forEach(function (r) {
        var t = 0;
        common.forEach(function (h) { t += score(round, r.id, h, useNet, sm); });
        totals[r.id] = t;
      });
      for (var i = 0; i < rows.length; i++) {
        for (var j = i + 1; j < rows.length; j++) {
          var a = rows[i], b = rows[j];
          var diff = totals[a.id] - totals[b.id];
          if (diff > 0) transfers.push({ from: a.id, to: b.id, amount: diff * unit, game: 'stroke', note: diff + '타' });
          else if (diff < 0) transfers.push({ from: b.id, to: a.id, amount: -diff * unit, game: 'stroke', note: (-diff) + '타' });
        }
      }
    }
    return { rows: sorted, transfers: transfers, net: useNet };
  }

  // ───────────────────────── 스테이블포드 ─────────────────────────
  function stablefordPoints(diff) {
    if (diff <= -3) return 5;
    if (diff === -2) return 4;
    if (diff === -1) return 3;
    if (diff === 0) return 2;
    if (diff === 1) return 1;
    return 0;
  }

  function stableford(round, opt) {
    opt = opt || {};
    var useNet = opt.net !== false;
    var sm = strokesMap(round);
    var rows = round.players.map(function (p) {
      var total = 0, holesArr = [];
      for (var h = 0; h < round.holes; h++) {
        var s = score(round, p.id, h, useNet, sm);
        if (s === null) { holesArr.push(null); continue; }
        var pts = stablefordPoints(s - round.pars[h]);
        holesArr.push(pts);
        total += pts;
      }
      return { id: p.id, name: p.name, team: p.team || null, points: total, holes: holesArr };
    });
    rows.sort(function (a, b) { return b.points - a.points; });
    var rank = 0, prev = null;
    rows.forEach(function (r, i) {
      if (prev === null || r.points !== prev) { rank = i + 1; prev = r.points; }
      r.rank = rank;
    });
    return { rows: rows, net: useNet };
  }

  // ───────────────────────── 스킨스 ─────────────────────────
  function entrantsFor(round, mode) {
    if (mode === 'team') {
      return teamsOf(round).map(function (t) { return { id: t.id, name: t.name, pids: t.pids, isTeam: true }; });
    }
    return round.players.map(function (p) { return { id: p.id, name: p.name, pids: [p.id], isTeam: false }; });
  }

  function entrantScore(round, e, h, useNet, sm, count) {
    return e.isTeam ? teamHoleScore(round, e.pids, h, useNet, count || 1, sm) : score(round, e.pids[0], h, useNet, sm);
  }

  /**
   * OECD 룰의 벌칙 항목(흔히 '오빠삼삼해'): OB · 벙커 · 해저드 · 3퍼트 · 트리플 이상.
   * OB·벙커·해저드·퍼트 수는 홀별 상세 기록(round.stats)에 입력된 값으로, 트리플은 타수(핸디 적용 전)로 판정한다.
   * 한 홀에서 같은 항목은 여러 번 해도 한 번으로 센다
   */
  var OECD_ITEMS = [['ob', 'OB'], ['bk', '벙커'], ['hz', '해저드'], ['pt3', '3퍼트'], ['tri', '트리플']];
  function oecdFaults(round, pid, h) {
    var st = (round.stats && round.stats[pid] && round.stats[pid][h]) || {}, out = [];
    if (st.ob > 0) out.push('ob');
    if (st.bk > 0) out.push('bk');
    if (st.hz > 0) out.push('hz');
    if (st.pt >= 3) out.push('pt3');
    var g = gross(round, pid, h);
    if (g !== null && g - round.pars[h] >= 3) out.push('tri');
    return out;
  }
  function wonAmount(v) { v = Math.round(Number(v)); return v > 0 ? v : 0; }
  /** 홀을 친 순서. order가 0..holes-1을 한 번씩 담은 배열이면 그대로, 아니면 홀 번호 순 */
  function holeOrder(round, order) {
    var n = round.holes, natural = [], seen = {}, ok = Array.isArray(order) && order.length === n;
    for (var i = 0; i < n; i++) natural.push(i);
    if (ok) order.forEach(function (h) { if (!(h >= 0 && h < n) || h !== Math.floor(h) || seen[h]) ok = false; seen[h] = 1; });
    return ok ? order.slice() : natural;
  }

  /**
   * 스킨스. 홀마다 단독 최저타가 스킨을 따고, 동타면 다음 홀로 이월한다.
   *
   * 돈 계산은 두 가지다.
   *  (가) 서로 주고받기 (기본): 스킨 하나에 다른 사람 각각이 opt.unit을 준다.
   *  (나) 공금(펀드) (opt.fund, 개인전에서만): 각자 opt.stake를 낸 것으로 치고 그 합이 공금이다.
   *      시작할 때 공금에서 플레이어 각각에게 opt.start, 캐디에게 opt.tip을 준다.
   *      홀 상금 opt.prize(이월분 포함)를 공금에서 승자에게 준다.
   *      OECD 룰(opt.oecd): 상금으로 받은 돈에서 낸 벌금을 뺀 금액이 가입 기준(opt.join, 새 라운드는 6만 원) 이상인 사람은 'OECD 가입자'가 되고,
   *      가입한 채로 시작한 홀에서 벌칙 항목에 걸리면 항목마다 opt.fine을 공금에 넣는다 (가진 돈 이상은 내지 않는다).
   *      벌금을 내서 기준 아래로 내려가면 다시 채울 때까지는 가입자가 아니다. 시작 지급은 이 금액에 넣지 않는다.
   *      opt.join이 0이거나 없으면(가입 기준이 생기기 전에 만든 라운드) 예전 기준 그대로다: 공금에서 받은 돈(시작 지급 + 상금 − 벌금)이 낸 돈 이상인 사람(본전을 찾은 사람).
   *      끝나면 공금에 남은 돈으로 캐디피(opt.caddie)를 내고, 모자라면 전원이 똑같이 나눠 내며 남으면 똑같이 돌려받는다.
   *      마지막까지 이월된 스킨의 상금은 공금에 남는다.
   *      사람별 최종 금액 = 시작 지급 + 상금 − 벌금 − 낸 돈 + (남은 돈 − 캐디피) ÷ 인원 (원 단위로 나눈다). 실제로 돈을 미리 걷을 필요는 없다:
   *      송금은 가상 계정 '#pot'(공금)을 거치고, 캐디 몫(시작 지급 + 캐디피)은 '#caddie'가 받는 것으로 낸다
   *      (settle이 손익 표에서는 빼고 송금 정리에는 넣는다).
   * opt.order: 홀을 친 순서(홀 인덱스 배열). 10번홀에서 출발한 라운드는 18번홀의 이월·OECD 가입이 1번홀로 이어진다. 없으면 홀 번호 순
   *   (computeAll은 round.games.skins.playorder가 켜진 라운드에만 순서를 넘긴다)
   */
  function skins(round, opt) {
    opt = opt || {};
    var useNet = !!opt.net;
    var unit = Number(opt.unit) || 0;
    var ents = entrantsFor(round, opt.mode);
    var fundOn = !!opt.fund && opt.mode !== 'team';
    var stake = wonAmount(opt.stake), prize = wonAmount(opt.prize), caddie = wonAmount(opt.caddie), fine = wonAmount(opt.fine);
    var start = wonAmount(opt.start), tip = wonAmount(opt.tip), join = wonAmount(opt.join);
    var oecd = fundOn && !!opt.oecd;
    // 공금을 실제로 걷고 시작 지급도 이미 한 경우: 남은 송금은 걷어 둔 돈에서 나눠 주는 것이 된다.
    // 걷은 돈이 시작 지급보다 많을 때만 뜻이 있다. 각자 내는 돈이 0이거나 시작 지급보다 적으면 걷어 둔 돈이 없으므로 '안 걷음'으로 계산한다
    var collect = fundOn && !!opt.collect && stake * ents.length > start * ents.length + tip;
    var order = holeOrder(round, opt.order);
    var res = { entrants: [], holes: [], carry: 0, transfers: [], error: null, fund: null };
    if (ents.length < 2) { res.error = opt.mode === 'team' ? '팀이 2개 이상 필요합니다' : '플레이어가 2명 이상 필요합니다'; return res; }
    var sm = strokesMap(round);
    var won = {}, got = {}, fined = {};
    ents.forEach(function (e) { won[e.id] = 0; got[e.id] = 0; fined[e.id] = 0; });
    var carry = 0;
    var allPids = [];
    ents.forEach(function (e) { allPids = allPids.concat(e.pids); });
    function held(e) { return start + got[e.id] - fined[e.id]; } // 공금에서 받아 지금 가지고 있는 돈
    // OECD 가입: 가입 기준이 있으면 상금 − 벌금이 그 금액 이상, 없으면(예전 라운드) 공금에서 받은 돈이 낸 돈 이상
    function isMember(e) { return oecd && (join > 0 ? got[e.id] - fined[e.id] >= join : stake > 0 && held(e) >= stake); }

    for (var oi = 0; oi < order.length; oi++) {
      var h = order[oi];
      var scores = ents.map(function (e) { return entrantScore(round, e, h, useNet, sm); });
      if (scores.some(function (s) { return s === null; })) {
        res.holes[h] = { hole: h, winner: null, skins: 0, carry: carry, played: false };
        continue;
      }
      var min = Math.min.apply(null, scores);
      var winners = [];
      scores.forEach(function (s, i) { if (s === min) winners.push(i); });
      // 이 홀을 시작할 때의 OECD 가입자 (이 홀의 상금으로 기준을 채운 사람은 다음 홀부터)
      var members = ents.filter(isMember);
      carry += 1;
      var rec;
      if (winners.length === 1) {
        var w = ents[winners[0]];
        won[w.id] += carry;
        rec = { hole: h, winner: w.id, winnerName: w.name, skins: carry, carry: 0, played: true };
        if (fundOn) { got[w.id] += prize * carry; rec.amount = prize * carry; }
        else {
          var losers = allPids.filter(function (pid) { return w.pids.indexOf(pid) < 0; });
          res.transfers = res.transfers.concat(makeTransfers(w.pids, losers, unit * carry, 'skins', (h + 1) + '번홀 ' + carry + '스킨'));
        }
        carry = 0;
      } else {
        rec = { hole: h, winner: null, skins: 0, carry: carry, played: true, tie: true };
      }
      // OECD 벌금: 걸린 항목마다 펀드에 넣는다
      members.forEach(function (e) {
        var faults = oecdFaults(round, e.pids[0], h);
        var f = Math.min(fine * faults.length, held(e));
        if (!(f > 0)) return;
        fined[e.id] += f;
        var names = faults.map(function (k) { return OECD_ITEMS.filter(function (it) { return it[0] === k; })[0][1]; });
        (rec.oecd = rec.oecd || []).push({ id: e.id, name: e.name, faults: faults, labels: names, fine: f });
      });
      res.holes[h] = rec;
    }
    res.carry = carry;
    res.unit = unit;
    res.net = useNet;
    if (!fundOn) {
      res.entrants = ents.map(function (e) {
        return { id: e.id, name: e.name, pids: e.pids, skins: won[e.id] };
      }).sort(function (a, b) { return b.skins - a.skins; });
      return res;
    }
    // 공금 정산
    var n = ents.length, total = stake * n, paid = 0, fines = 0;
    ents.forEach(function (e) { paid += got[e.id]; fines += fined[e.id]; });
    var startOut = start * n + tip;                       // 시작할 때 나눠 준 돈
    var left = total - startOut - paid + fines;           // 캐디피를 내기 전 공금에 남은 돈
    var rest = left - caddie, share = rest / n;           // 캐디피를 낸 뒤: 남으면(+) 똑같이 돌려받고 모자라면(−) 똑같이 더 낸다
    // 나누어떨어지지 않으면 원 단위로 나눈다: 몫은 내림, 남는 1원들은 앞 사람부터 하나씩. 그래야 사람별 금액의 합이 정확히 맞고
    // 캐디에게 가는 송금 합계가 캐디 몫과 1원도 어긋나지 않는다 (3명이 160,000원을 나누면 53,334 · 53,333 · 53,333)
    var base = Math.floor(rest / n), extra = rest - base * n;
    res.fund = { stake: stake, prize: prize, start: start, tip: tip, caddie: caddie, fine: fine, oecd: oecd, join: join, players: n,
      total: total, startOut: startOut, paid: paid, fines: fines, left: left, rest: rest, share: share, even: extra === 0, caddieTotal: tip + caddie,
      // 끝나고 실제로 오갈 돈: 미리 걷었으면 봉투에 남은 돈(공금 − 시작 지급)에서 나눠 주고 캐디에게는 캐디피만, 안 걷었으면 처음부터 전부
      collect: collect, cash: collect ? total - startOut : 0, caddieDue: collect ? caddie : tip + caddie };
    res.entrants = ents.map(function (e, i) {
      var take = held(e), mine = base + (i < extra ? 1 : 0), fin = take - stake + mine;
      // due: 끝나고 이 사람에게 줄 돈(+) 또는 이 사람이 낼 돈(−). 미리 걷었으면 낸 돈과 시작 지급은 이미 오간 것으로 본다
      return { id: e.id, name: e.name, pids: e.pids, skins: won[e.id], start: start, prize: got[e.id], fines: fined[e.id], take: take, share: mine, final: fin,
        due: collect ? fin + stake - start : fin, oecd: isMember(e) };
    }).sort(function (a, b) { return b.skins - a.skins || b.final - a.final; });
    res.entrants.forEach(function (e) {
      if (e.final > 0) res.transfers.push({ from: '#pot', to: e.pids[0], amount: e.final, game: 'skins', note: '스킨스 공금 정산' });
      else if (e.final < 0) res.transfers.push({ from: e.pids[0], to: '#pot', amount: -e.final, game: 'skins', note: '스킨스 공금 정산' });
    });
    if (tip + caddie > 0) res.transfers.push({ from: '#pot', to: '#caddie', amount: tip + caddie, game: 'skins', note: '캐디 (시작 지급 + 캐디피)' });
    // 미리 걷은 경우: 끝나고 걷어 둔 돈(봉투)으로 할 일을 장부의 "끝나고 나눌 돈" 순서 그대로 적는다 (받을 사람, 더 낼 사람, 캐디피).
    // 정산의 송금 정리가 이 줄들을 그대로 쓰므로 장부와 정산이 언제나 같고, 캐디피는 언제나 공금에서 나간다. 손익은 그대로다
    if (collect) {
      res.payout = [];
      res.entrants.forEach(function (e) {
        var d = Math.round(e.due);
        if (d > 0) res.payout.push({ from: '#pot', to: e.pids[0], amount: d });
        else if (d < 0) res.payout.push({ from: e.pids[0], to: '#pot', amount: -d });
      });
      if (caddie > 0) res.payout.push({ from: '#pot', to: '#caddie', amount: caddie });
    }
    return res;
  }

  // ───────────────────────── 오장 (타당 스트로크 · 배판) ─────────────────────────
  /**
   * 오장: 홀마다 타수 차 × 타당 금액을 서로 주고받는 스트로크 내기 (이름은 기본 금액 5천 원에서 왔다. 금액은 opt.unit으로 정한다).
   * 아래 가운데 하나라도 해당하는 홀은 '배판'으로 그 홀의 금액이 2배다 (여러 개가 겹쳐도 2배).
   *   · 버디 이하가 나온 홀            · 트리플 보기 이상이 한 명이라도 나온 홀
   *   · 파3에서 더블 보기 이상이 나온 홀  · 세 명 이상이 같은 타수인 홀
   *   · opt.carry(기본 켬): 바로 앞 번호 홀에서 전원이 같은 타수였던 홀
   * 타수 차는 opt.net이면 핸디 적용 타수로 계산하고, 배판 조건과 니어·버디는 실제 타수로 본다.
   * opt.near(기본 켬) 파3 니어: 니어리스트(round.extras[h].nearest)가 파 이하로 마치면 다른 사람 각각에게서 1타 금액을 더 받는다.
   *   파를 못 하면 없던 것으로 한다. opt.eraser(보너스 설정의 지우개 룰)가 켜져 있고 그 홀의 니어가 지워졌으면(nearInfo) 그것도 없던 것으로 한다.
   * opt.birdie(기본 켬) 버디값: 버디 이하를 한 사람은 다른 사람 각각에게서 1타 금액을 더 받는다.
   * 니어와 버디값도 그 홀이 배판이면 2배다. 전원이 타수를 입력한 홀만 계산한다.
   * opt.order: 홀을 친 순서(홀 인덱스 배열). '앞 홀'은 이 순서에서 바로 앞에 친 홀이다 (10번홀 출발이면 18번홀 다음이 1번홀). 없으면 홀 번호 순
   */
  function ojang(round, opt) {
    opt = opt || {};
    var unit = Number(opt.unit) || 0, useNet = !!opt.net, sm = strokesMap(round);
    var carryOn = opt.carry !== false, nearOn = opt.near !== false, birdieOn = opt.birdie !== false;
    var pids = round.players.map(function (p) { return p.id; });
    var res = { holes: [], rows: [], transfers: [], unit: unit, net: useNet, error: null, doubles: 0, nextDouble: null };
    if (pids.length < 2) { res.error = '플레이어가 2명 이상 필요합니다'; return res; }
    var money = {};
    pids.forEach(function (pid) { money[pid] = 0; });
    function pay(from, to, amount, note) {
      if (!amount) return;
      money[from] -= amount; money[to] += amount;
      res.transfers.push({ from: from, to: to, amount: amount, game: 'ojang', note: note });
    }
    var prevAllTied = false, order = holeOrder(round, opt.order);
    for (var oi = 0; oi < order.length; oi++) {
      var h = order[oi];
      if (!holeCompleteFor(round, pids, h)) {
        // 아직 다 입력하지 않은 홀: 앞 홀이 전원 동타였다면 이 홀이 배판이 될 차례다 (pendingDouble). nextDouble은 그런 홀 가운데 가장 먼저 칠 홀
        var pend = carryOn && prevAllTied;
        if (pend && res.nextDouble === null) res.nextDouble = h;
        res.holes[h] = { hole: h, played: false, mult: 1, reasons: [], pendingDouble: pend };
        prevAllTied = false;
        continue;
      }
      var par = round.pars[h];
      var g = pids.map(function (pid) { return gross(round, pid, h); });
      var reasons = [];
      if (g.some(function (v) { return v - par <= -1; })) reasons.push('버디');
      if (g.some(function (v) { return v - par >= 3; })) reasons.push('트리플');
      if (par === 3 && g.some(function (v) { return v - par === 2; })) reasons.push('파3 더블');
      var same = {}, most = 0;
      g.forEach(function (v) { same[v] = (same[v] || 0) + 1; if (same[v] > most) most = same[v]; });
      if (most >= 3) reasons.push('동타 ' + most + '명');
      if (carryOn && prevAllTied) reasons.push('앞 홀 전원 동타');
      var mult = reasons.length ? 2 : 1, tag = (h + 1) + '번홀' + (mult === 2 ? ' 배판' : '');
      if (mult === 2) res.doubles++;
      var rec = { hole: h, played: true, mult: mult, reasons: reasons };
      // 타수 차 (둘씩)
      var s = pids.map(function (pid) { return score(round, pid, h, useNet, sm); });
      for (var i = 0; i < pids.length; i++) {
        for (var j = i + 1; j < pids.length; j++) {
          var d = s[i] - s[j];
          if (d > 0) pay(pids[i], pids[j], d * unit * mult, tag + ' ' + d + '타');
          else if (d < 0) pay(pids[j], pids[i], -d * unit * mult, tag + ' ' + (-d) + '타');
        }
      }
      // 파3 니어: 파 이하로 마쳐야 받는다
      var ni = nearOn && par === 3 ? nearInfo(round, h, { eraser: opt.eraser }) : null;
      var np = ni ? ni.raw : null;
      if (np && pids.indexOf(np) >= 0) {
        var ok = !ni.erased && gross(round, np, h) <= par;
        rec.near = { pid: np, ok: ok };
        if (ni.erased) rec.near.erasedBy = ni.eraser; // 지우개: 다른 사람이 그린 밖에서 파 이하로 마쳐 니어가 지워졌다
        if (ok) pids.forEach(function (pid) { if (pid !== np) pay(pid, np, unit * mult, tag + ' 니어'); });
      }
      // 버디값
      if (birdieOn) {
        pids.forEach(function (pid, k) {
          if (g[k] - par > -1) return;
          (rec.birdies = rec.birdies || []).push(pid);
          pids.forEach(function (other) { if (other !== pid) pay(other, pid, unit * mult, tag + ' 버디값'); });
        });
      }
      res.holes[h] = rec;
      prevAllTied = most === pids.length;
    }
    res.rows = round.players.map(function (p) { return { id: p.id, name: p.name, amount: money[p.id] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
    return res;
  }

  // ───────────────────────── 매치 플레이 ─────────────────────────
  /** a,b: 홀별 점수 배열(null 허용). 반환: 상태 */
  function computeMatch(a, b) {
    var n = a.length;
    var up = 0, through = 0, decided = false, decidedAt = -1, remaining = n;
    var holeResults = [];
    for (var h = 0; h < n; h++) {
      if (a[h] === null || b[h] === null) { holeResults.push(null); continue; }
      if (a[h] < b[h]) up++;
      else if (a[h] > b[h]) up--;
      holeResults.push(a[h] < b[h] ? 1 : a[h] > b[h] ? -1 : 0);
      through++;
      remaining = n - (h + 1);
      if (remaining > 0 && Math.abs(up) > remaining) { decided = true; decidedAt = h; break; }
    }
    var finished = decided || through === n;
    var text;
    var mag = Math.abs(up);
    if (decided) text = mag + '&' + remaining;
    else if (finished) text = up === 0 ? 'AS' : mag + 'UP';
    else text = (up === 0 ? 'AS' : mag + 'UP') + (through > 0 ? ' (' + through + '홀)' : '');
    return {
      up: up, through: through, decided: decided, decidedAt: decidedAt, finished: finished,
      remaining: remaining, text: text, margin: mag,
      leader: up > 0 ? 'A' : up < 0 ? 'B' : null, holes: holeResults
    };
  }

  function seriesFor(round, e, useNet, sm, count, from, to) {
    var arr = [];
    for (var h = from; h < to; h++) arr.push(entrantScore(round, e, h, useNet, sm, count));
    return arr;
  }

  function pairings(round, mode) {
    var ents = entrantsFor(round, mode);
    var pairs = [];
    if (mode === 'team') {
      if (ents.length !== 2) return { error: '팀 매치는 정확히 2팀이 필요합니다', pairs: [] };
      pairs.push([ents[0], ents[1]]);
    } else {
      if (ents.length < 2) return { error: '플레이어가 2명 이상 필요합니다', pairs: [] };
      for (var i = 0; i < ents.length; i++) for (var j = i + 1; j < ents.length; j++) pairs.push([ents[i], ents[j]]);
    }
    return { error: null, pairs: pairs };
  }

  function matchPlay(round, opt) {
    opt = opt || {};
    var useNet = !!opt.net;
    var unit = Number(opt.unit) || 0;
    var pr = pairings(round, opt.mode);
    var res = { matches: [], transfers: [], error: pr.error, net: useNet, unit: unit };
    if (pr.error) return res;
    var sm = strokesMap(round);
    pr.pairs.forEach(function (pair) {
      var A = pair[0], B = pair[1];
      var st = computeMatch(seriesFor(round, A, useNet, sm, 1, 0, round.holes), seriesFor(round, B, useNet, sm, 1, 0, round.holes));
      var m = { a: { id: A.id, name: A.name, pids: A.pids }, b: { id: B.id, name: B.name, pids: B.pids }, status: st, money: 0 };
      // 팀 매치: 매치에 들어간 홀마다 두 팀에 적용된 타수와 그 타수를 친 사람 (승부가 난 뒤의 홀은 status.holes처럼 넣지 않는다)
      if (A.isTeam) m.best = st.holes.map(function (v, h) { return v === null ? null : { a: teamHoleBest(round, A.pids, h, useNet, sm), b: teamHoleBest(round, B.pids, h, useNet, sm) }; });
      if (st.finished && st.up !== 0 && unit > 0) {
        var win = st.up > 0 ? A : B, lose = st.up > 0 ? B : A;
        m.money = unit * st.margin;
        res.transfers = res.transfers.concat(makeTransfers(win.pids, lose.pids, m.money, 'match', A.name + ' vs ' + B.name + ' ' + st.text));
      }
      res.matches.push(m);
    });
    return res;
  }

  // ───────────────────────── 나소 (전반/후반/전체) ─────────────────────────
  function nassau(round, opt) {
    opt = opt || {};
    var useNet = !!opt.net;
    var unit = Number(opt.unit) || 0;
    var res = { matches: [], transfers: [], error: null, net: useNet, unit: unit };
    if (round.holes !== 18) { res.error = '나소는 18홀 라운드에서만 가능합니다'; return res; }
    var pr = pairings(round, opt.mode);
    if (pr.error) { res.error = pr.error; return res; }
    var sm = strokesMap(round);
    var segs = [{ key: 'front', name: '전반', from: 0, to: 9 }, { key: 'back', name: '후반', from: 9, to: 18 }, { key: 'total', name: '전체', from: 0, to: 18 }];
    pr.pairs.forEach(function (pair) {
      var A = pair[0], B = pair[1];
      var m = { a: { id: A.id, name: A.name, pids: A.pids }, b: { id: B.id, name: B.name, pids: B.pids }, segments: [] };
      segs.forEach(function (sg) {
        var st = computeMatch(seriesFor(round, A, useNet, sm, 1, sg.from, sg.to), seriesFor(round, B, useNet, sm, 1, sg.from, sg.to));
        var seg = { key: sg.key, name: sg.name, status: st, money: 0 };
        if (st.finished && st.up !== 0 && unit > 0) {
          var win = st.up > 0 ? A : B, lose = st.up > 0 ? B : A;
          seg.money = unit;
          res.transfers = res.transfers.concat(makeTransfers(win.pids, lose.pids, unit, 'nassau', sg.name + ' ' + A.name + ' vs ' + B.name));
        }
        m.segments.push(seg);
      });
      res.matches.push(m);
    });
    return res;
  }

  // ───────────────────────── 베스트볼 (팀) ─────────────────────────
  function bestBall(round, opt) {
    opt = opt || {};
    var useNet = !!opt.net;
    var count = Math.max(1, Number(opt.count) || 1);
    var unit = Number(opt.unit) || 0;
    var teams = teamsOf(round);
    var res = { teams: [], holes: [], transfers: [], error: null, net: useNet, count: count, unit: unit };
    if (teams.length < 2) { res.error = '팀이 2개 이상 필요합니다'; return res; }
    var sm = strokesMap(round);
    var totals = {}, wins = {}, par = {};
    teams.forEach(function (t) { totals[t.id] = 0; wins[t.id] = 0; par[t.id] = 0; });
    var allPids = [];
    teams.forEach(function (t) { allPids = allPids.concat(t.pids); });
    for (var h = 0; h < round.holes; h++) {
      var scores = teams.map(function (t) { return teamHoleScore(round, t.pids, h, useNet, count, sm); });
      var hole = { hole: h, scores: scores, winner: null, played: false };
      if (scores.every(function (s) { return s !== null; })) {
        hole.played = true;
        teams.forEach(function (t, i) { totals[t.id] += scores[i]; par[t.id] += round.pars[h] * count; });
        var min = Math.min.apply(null, scores);
        var ws = [];
        scores.forEach(function (s, i) { if (s === min) ws.push(i); });
        if (ws.length === 1) {
          var w = teams[ws[0]];
          wins[w.id]++;
          hole.winner = w.id;
          var losers = allPids.filter(function (pid) { return w.pids.indexOf(pid) < 0; });
          res.transfers = res.transfers.concat(makeTransfers(w.pids, losers, unit, 'bestball', (h + 1) + '번홀'));
        }
      }
      res.holes.push(hole);
    }
    res.teams = teams.map(function (t) {
      return { id: t.id, name: t.name, pids: t.pids, total: totals[t.id], toPar: totals[t.id] - par[t.id], holesWon: wins[t.id] };
    }).sort(function (a, b) { return a.toPar - b.toPar || b.holesWon - a.holesWon; });
    return res;
  }

  // ───────────────────────── 라스베가스 (2:2) ─────────────────────────
  function vegasNumber(s1, s2, flip) {
    var lo = Math.min(s1, s2), hi = Math.max(s1, s2);
    return flip ? hi * 10 + lo : lo * 10 + hi;
  }

  function vegas(round, opt) {
    opt = opt || {};
    var unit = Number(opt.unit) || 0;
    var useNet = !!opt.net;
    var teams = teamsOf(round);
    var res = { teams: [], holes: [], transfers: [], error: null, unit: unit };
    if (teams.length !== 2 || teams.some(function (t) { return t.pids.length !== 2; })) {
      res.error = '라스베가스는 2명씩 2팀이 필요합니다'; return res;
    }
    var sm = strokesMap(round);
    var pts = {};
    teams.forEach(function (t) { pts[t.id] = 0; });
    for (var h = 0; h < round.holes; h++) {
      var allIn = teams.every(function (t) { return holeCompleteFor(round, t.pids, h); });
      var hole = { hole: h, played: allIn, nums: [null, null], points: 0, winner: null, flips: [false, false] };
      if (allIn) {
        var birdie = teams.map(function (t) {
          return t.pids.some(function (pid) { return gross(round, pid, h) <= round.pars[h] - 1; });
        });
        var flips = [birdie[1] && !birdie[0], birdie[0] && !birdie[1]];
        var nums = teams.map(function (t, i) {
          return vegasNumber(score(round, t.pids[0], h, useNet, sm), score(round, t.pids[1], h, useNet, sm), flips[i]);
        });
        hole.nums = nums; hole.flips = flips;
        var diff = nums[0] - nums[1];
        if (diff !== 0) {
          var wi = diff < 0 ? 0 : 1, li = 1 - wi;
          hole.points = Math.abs(diff);
          hole.winner = teams[wi].id;
          pts[teams[wi].id] += hole.points;
          res.transfers = res.transfers.concat(makeTransfers(teams[wi].pids, teams[li].pids, unit * hole.points, 'vegas', (h + 1) + '번홀 ' + hole.points + '점'));
        }
      }
      res.holes.push(hole);
    }
    res.teams = teams.map(function (t) { return { id: t.id, name: t.name, pids: t.pids, points: pts[t.id] }; });
    return res;
  }

  // ───────────────────────── 니어 · 롱기 판정 (홀 제한과 지우개) ─────────────────────────
  /**
   * 그 홀의 니어리스트 판정. rules(라운드의 보너스 설정): { parthree: 니어는 파3 홀에서만, eraser: 지우개 룰 }
   * 지우개: 파3에서 그린에 올리지 못한 사람이 파 이하로 마치면 니어를 지운다(그 홀의 니어가 없어진다).
   *   누가 지웠는지는 round.extras[h].eraser에 적는다. 지운 사람의 타수가 입력돼 있고 파 이하일 때만 인정하며, 니어를 한 본인은 지울 수 없다.
   * 반환 { raw: 이 홀에서 니어로 볼 수 있는 입력(없거나 홀 제한에 걸리면 null), pid: 인정된 니어(없으면 null),
   *        eraser: 지우개로 적힌 사람(없으면 null), erased: 지우개가 인정됐는가,
   *        why: 지우개가 적혀 있지만 인정되지 않은 이유('noscore' 타수 미입력 | 'over' 파를 못 함), 아니면 null }
   */
  function nearInfo(round, h, rules) {
    rules = rules || {};
    var ex = (round.extras && round.extras[h]) || {}, par = round.pars[h];
    var out = { raw: null, pid: null, eraser: null, erased: false, why: null };
    if (!ex.nearest || !playerById(round, ex.nearest)) return out;
    if (rules.parthree && par !== 3) return out; // 홀 제한: 파3이 아닌 홀에 남아 있는 니어는 세지 않는다
    out.raw = out.pid = ex.nearest;
    if (rules.eraser && par === 3 && ex.eraser && ex.eraser !== ex.nearest && playerById(round, ex.eraser)) {
      out.eraser = ex.eraser;
      var g = gross(round, ex.eraser, h);
      if (g === null) out.why = 'noscore';
      else if (g > par) out.why = 'over';
      else { out.erased = true; out.pid = null; }
    }
    return out;
  }
  /** 그 홀의 롱기스트(없으면 null). rules.parfive: 롱기는 파5 홀에서만 */
  function longOf(round, h, rules) {
    var ex = (round.extras && round.extras[h]) || {};
    if (!ex.longest || !playerById(round, ex.longest)) return null;
    return rules && rules.parfive && round.pars[h] !== 5 ? null : ex.longest;
  }

  // ───────────────────────── 보너스 (니어/롱기/버디) ─────────────────────────
  /**
   * opt.parthree: 니어는 파3 홀에서만, opt.parfive: 롱기는 파5 홀에서만 센다 (다른 홀에 남아 있는 입력은 횟수에도 돈에도 넣지 않는다).
   * opt.eraser: 지우개 룰 (nearInfo). 지워진 니어는 횟수에도 돈에도 넣지 않고, 지운 사람의 '지우개' 횟수로 센다.
   */
  function bonuses(round, opt) {
    opt = opt || {};
    var unit = Number(opt.unit) || 0;
    var res = { events: [], transfers: [], counts: {}, unit: unit,
      enabled: { nearest: !!opt.nearest, longest: !!opt.longest, birdie: !!opt.birdie },
      rules: { parthree: !!opt.parthree, parfive: !!opt.parfive, eraser: !!opt.eraser } };
    var pids = round.players.map(function (p) { return p.id; });
    pids.forEach(function (pid) { res.counts[pid] = { nearest: 0, longest: 0, birdie: 0, eagle: 0, eraser: 0 }; });
    function pay(to, amount, note) {
      res.transfers = res.transfers.concat(makeTransfers([to], pids.filter(function (p) { return p !== to; }), amount, 'bonus', note));
    }
    for (var h = 0; h < round.holes; h++) {
      var ni = nearInfo(round, h, res.rules), lg = longOf(round, h, res.rules);
      if (ni.pid) {
        res.counts[ni.pid].nearest++;
        res.events.push({ hole: h, type: 'nearest', pid: ni.pid });
        if (opt.nearest) pay(ni.pid, unit, (h + 1) + '번홀 니어리스트');
      } else if (ni.erased) {
        res.counts[ni.eraser].eraser++;
        res.events.push({ hole: h, type: 'erased', pid: ni.raw, by: ni.eraser });
      }
      if (lg) {
        res.counts[lg].longest++;
        res.events.push({ hole: h, type: 'longest', pid: lg });
        if (opt.longest) pay(lg, unit, (h + 1) + '번홀 롱기스트');
      }
      pids.forEach(function (pid) {
        var g = gross(round, pid, h);
        if (g === null) return;
        var d = g - round.pars[h];
        if (d === -1) {
          res.counts[pid].birdie++;
          res.events.push({ hole: h, type: 'birdie', pid: pid });
          if (opt.birdie) pay(pid, unit, (h + 1) + '번홀 버디');
        } else if (d <= -2) {
          res.counts[pid].eagle++;
          res.events.push({ hole: h, type: 'eagle', pid: pid });
          if (opt.birdie) pay(pid, unit * 2, (h + 1) + '번홀 이글');
        }
      });
    }
    return res;
  }

  // ───────────────────────── 정산 ─────────────────────────
  /**
   * 송금 목록 → 사람별 손익과 최소 송금 정리.
   * '#'으로 시작하는 id는 가상 계정이다('#pot' 스킨스 펀드, '#caddie' 캐디피). 손익 표(rows)에는 넣지 않고,
   * 송금 정리(payments)에는 그대로 나온다 → 캐디피처럼 사람들 밖으로 나가는 돈도 누가 얼마를 낼지 정리된다
   * fixed: { game, payments } — 이 게임의 돈은 정해진 줄(payments) 그대로 주고받는다 (미리 걷은 스킨스 공금: 걷어 둔 돈에서 나눠 주는 줄).
   *   그 게임은 최소 송금 계산에서 빼고 나머지 게임만 사람끼리 최소 횟수로 정리해 뒤에 붙인다. 손익(rows)은 모든 게임을 합친 그대로다
   */
  function settle(transfers, players, fixed) {
    var net = {}, paid = {}, received = {}, byGame = {}, bal = {};
    // bal(최소 송금으로 정리할 잔액)도 net과 같은 순서로 만든다: 금액이 같은 사람끼리의 짝이 플레이어 순서를 따라 예전 기록의 송금 줄이 그대로 나온다
    players.forEach(function (p) { net[p.id] = 0; paid[p.id] = 0; received[p.id] = 0; byGame[p.id] = {}; bal[p.id] = 0; });
    function pseudo(t) {
      [t.from, t.to].forEach(function (id) {
        if (typeof id === 'string' && id.charAt(0) === '#' && !(id in net)) { net[id] = 0; paid[id] = 0; received[id] = 0; byGame[id] = {}; bal[id] = 0; }
      });
    }
    transfers.forEach(function (t) {
      pseudo(t);
      if (!(t.from in net) || !(t.to in net)) return;
      net[t.from] -= t.amount; net[t.to] += t.amount;
      paid[t.from] += t.amount; received[t.to] += t.amount;
      byGame[t.from][t.game] = (byGame[t.from][t.game] || 0) - t.amount;
      byGame[t.to][t.game] = (byGame[t.to][t.game] || 0) + t.amount;
      // 최소 송금으로 정리할 잔액: 줄이 정해진 게임(fixed)의 돈은 넣지 않는다
      if (fixed && t.game === fixed.game) return;
      bal[t.from] -= t.amount; bal[t.to] += t.amount;
    });
    var payments = (fixed ? fixed.payments.map(function (p) { return { from: p.from, to: p.to, amount: p.amount, fixed: true }; }) : []).concat(simplify(bal));
    var rows = players.map(function (p) {
      return { id: p.id, name: p.name, net: Math.round(net[p.id]), paid: Math.round(paid[p.id]), received: Math.round(received[p.id]), byGame: byGame[p.id] };
    }).sort(function (a, b) { return b.net - a.net; });
    return { rows: rows, payments: payments };
  }

  /** 순손익 맵을 최소 송금 목록으로 단순화 */
  function simplify(netMap) {
    var debtors = [], creditors = [];
    Object.keys(netMap).forEach(function (pid) {
      var v = Math.round(netMap[pid]);
      if (v < 0) debtors.push({ id: pid, amt: -v });
      else if (v > 0) creditors.push({ id: pid, amt: v });
    });
    debtors.sort(function (a, b) { return b.amt - a.amt; });
    creditors.sort(function (a, b) { return b.amt - a.amt; });
    var out = [];
    var i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      var d = debtors[i], c = creditors[j];
      var x = Math.min(d.amt, c.amt);
      if (x > 0) out.push({ from: d.id, to: c.id, amount: x });
      d.amt -= x; c.amt -= x;
      if (d.amt === 0) i++;
      if (c.amt === 0) j++;
    }
    return out;
  }

  /**
   * 모든 게임을 항상 계산한다 (개인 스코어 하나로 모든 버전의 결과가 나오도록).
   * 각 게임의 enabled(정산 포함) 여부는 결과에 표시되며, 정산(transfers)에는 포함된 게임만 반영된다.
   */
  function computeAll(round, ctx) {
    var g = round.games || {};
    var order = ctx && ctx.order; // 홀을 친 순서 (앱이 analysis.js의 playOrder로 넘겨 준다)
    function withOrder(o) { var c = {}; Object.keys(o || {}).forEach(function (k) { c[k] = o[k]; }); c.order = order; return c; }
    var out = { transfers: [] }, fixed = null;
    function add(key, res, included) {
      res.enabled = !!included;
      out[key] = res;
      if (included && res.transfers && !res.error) out.transfers = out.transfers.concat(res.transfers);
      if (included && res.payout && !res.error) fixed = { game: key, payments: res.payout };
    }
    add('stroke', strokePlay(round, g.stroke || {}), true);
    out.stableford = stableford(round, g.stableford || {});
    // 스킨스는 playorder 표시가 있는 라운드만 친 순서를 따른다. 이 표시가 없는 라운드(업데이트 전에 만든 기록)는 예전처럼 홀 번호 순이라
    // 이미 정산한 금액이 바뀌지 않는다. 오장은 새로 생긴 게임이라 언제나 친 순서다
    add('skins', skins(round, g.skins && g.skins.playorder ? withOrder(g.skins) : (g.skins || {})), g.skins && g.skins.enabled);
    var oj = withOrder(g.ojang);
    oj.eraser = !!(g.bonus && g.bonus.eraser); // 지우개로 지워진 니어는 오장에서도 없던 것으로 한다
    add('ojang', ojang(round, oj), g.ojang && g.ojang.enabled);
    add('match', matchPlay(round, g.match || {}), g.match && g.match.enabled);
    if (round.holes === 18) add('nassau', nassau(round, g.nassau || {}), g.nassau && g.nassau.enabled);
    add('bestball', bestBall(round, g.bestball || {}), g.bestball && g.bestball.enabled);
    add('vegas', vegas(round, g.vegas || {}), g.vegas && g.vegas.enabled);
    var b = g.bonus || {};
    var bonus = bonuses(round, b);
    out.bonus = bonus;
    if (b.nearest || b.longest || b.birdie) out.transfers = out.transfers.concat(bonus.transfers);
    out.settlement = settle(out.transfers, round.players, fixed);
    return out;
  }

  return {
    BUILD: 15, // 앱 버전(sw.js의 캐시 번호와 같다). app.js가 파일들의 짝이 맞는지 확인하는 데 쓴다
    defaultStrokeIndex: defaultStrokeIndex,
    defaultPars: defaultPars,
    strokesPerHole: strokesPerHole,
    strokesMap: strokesMap,
    gross: gross,
    maxScore: maxScore,
    score: score,
    toParLabel: toParLabel,
    toParShort: toParShort,
    fmtToPar: fmtToPar,
    playerById: playerById,
    teamsOf: teamsOf,
    teamHoleScore: teamHoleScore,
    stablefordPoints: stablefordPoints,
    computeMatch: computeMatch,
    OECD_ITEMS: OECD_ITEMS,
    oecdFaults: oecdFaults,
    strokePlay: strokePlay,
    stableford: stableford,
    skins: skins,
    ojang: ojang,
    matchPlay: matchPlay,
    teamHoleBest: teamHoleBest,
    nassau: nassau,
    bestBall: bestBall,
    vegas: vegas,
    bonuses: bonuses,
    nearInfo: nearInfo,
    longOf: longOf,
    settle: settle,
    simplify: simplify,
    computeAll: computeAll
  };
});
