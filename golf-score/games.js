/*
 * games.js — 골프 스코어 / 내기 게임 계산 로직 (순수 함수)
 * 브라우저(window.GolfGames)와 Node(require) 양쪽에서 사용 가능.
 */
(function (root, factory) {
  var api = factory();
  root.GolfGames = api;
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

  function gross(round, pid, h) {
    var s = round.scores && round.scores[pid];
    var v = s ? s[h] : null;
    return typeof v === 'number' && v > 0 ? v : null;
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

  function toParLabel(diff) {
    if (diff <= -3) return '알바트로스';
    if (diff === -2) return '이글';
    if (diff === -1) return '버디';
    if (diff === 0) return '파';
    if (diff === 1) return '보기';
    if (diff === 2) return '더블보기';
    if (diff === 3) return '트리플보기';
    return '+' + diff;
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

  function skins(round, opt) {
    opt = opt || {};
    var useNet = !!opt.net;
    var unit = Number(opt.unit) || 0;
    var ents = entrantsFor(round, opt.mode);
    var res = { entrants: [], holes: [], carry: 0, transfers: [], error: null };
    if (ents.length < 2) { res.error = opt.mode === 'team' ? '팀이 2개 이상 필요합니다' : '플레이어가 2명 이상 필요합니다'; return res; }
    var sm = strokesMap(round);
    var won = {};
    ents.forEach(function (e) { won[e.id] = 0; });
    var carry = 0;
    var allPids = [];
    ents.forEach(function (e) { allPids = allPids.concat(e.pids); });

    for (var h = 0; h < round.holes; h++) {
      var scores = ents.map(function (e) { return entrantScore(round, e, h, useNet, sm); });
      if (scores.some(function (s) { return s === null; })) {
        res.holes.push({ hole: h, winner: null, skins: 0, carry: carry, played: false });
        continue;
      }
      var min = Math.min.apply(null, scores);
      var winners = [];
      scores.forEach(function (s, i) { if (s === min) winners.push(i); });
      carry += 1;
      if (winners.length === 1) {
        var w = ents[winners[0]];
        won[w.id] += carry;
        var losers = allPids.filter(function (pid) { return w.pids.indexOf(pid) < 0; });
        res.transfers = res.transfers.concat(makeTransfers(w.pids, losers, unit * carry, 'skins', (h + 1) + '번홀 ' + carry + '스킨'));
        res.holes.push({ hole: h, winner: w.id, winnerName: w.name, skins: carry, carry: 0, played: true });
        carry = 0;
      } else {
        res.holes.push({ hole: h, winner: null, skins: 0, carry: carry, played: true, tie: true });
      }
    }
    res.carry = carry;
    res.entrants = ents.map(function (e) {
      return { id: e.id, name: e.name, pids: e.pids, skins: won[e.id] };
    }).sort(function (a, b) { return b.skins - a.skins; });
    res.unit = unit;
    res.net = useNet;
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

  // ───────────────────────── 보너스 (니어/롱기/버디) ─────────────────────────
  function bonuses(round, opt) {
    opt = opt || {};
    var unit = Number(opt.unit) || 0;
    var res = { events: [], transfers: [], counts: {}, unit: unit,
      enabled: { nearest: !!opt.nearest, longest: !!opt.longest, birdie: !!opt.birdie } };
    var pids = round.players.map(function (p) { return p.id; });
    pids.forEach(function (pid) { res.counts[pid] = { nearest: 0, longest: 0, birdie: 0, eagle: 0 }; });
    var extras = round.extras || {};
    function pay(to, amount, note) {
      res.transfers = res.transfers.concat(makeTransfers([to], pids.filter(function (p) { return p !== to; }), amount, 'bonus', note));
    }
    for (var h = 0; h < round.holes; h++) {
      var ex = extras[h] || {};
      if (ex.nearest && res.counts[ex.nearest]) {
        res.counts[ex.nearest].nearest++;
        res.events.push({ hole: h, type: 'nearest', pid: ex.nearest });
        if (opt.nearest) pay(ex.nearest, unit, (h + 1) + '번홀 니어리스트');
      }
      if (ex.longest && res.counts[ex.longest]) {
        res.counts[ex.longest].longest++;
        res.events.push({ hole: h, type: 'longest', pid: ex.longest });
        if (opt.longest) pay(ex.longest, unit, (h + 1) + '번홀 롱기스트');
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
  function settle(transfers, players) {
    var net = {}, paid = {}, received = {}, byGame = {};
    players.forEach(function (p) { net[p.id] = 0; paid[p.id] = 0; received[p.id] = 0; byGame[p.id] = {}; });
    transfers.forEach(function (t) {
      if (!(t.from in net) || !(t.to in net)) return;
      net[t.from] -= t.amount; net[t.to] += t.amount;
      paid[t.from] += t.amount; received[t.to] += t.amount;
      byGame[t.from][t.game] = (byGame[t.from][t.game] || 0) - t.amount;
      byGame[t.to][t.game] = (byGame[t.to][t.game] || 0) + t.amount;
    });
    var payments = simplify(net);
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
  function computeAll(round) {
    var g = round.games || {};
    var out = { transfers: [] };
    function add(key, res, included) {
      res.enabled = !!included;
      out[key] = res;
      if (included && res.transfers && !res.error) out.transfers = out.transfers.concat(res.transfers);
    }
    add('stroke', strokePlay(round, g.stroke || {}), true);
    out.stableford = stableford(round, g.stableford || {});
    add('skins', skins(round, g.skins || {}), g.skins && g.skins.enabled);
    add('match', matchPlay(round, g.match || {}), g.match && g.match.enabled);
    if (round.holes === 18) add('nassau', nassau(round, g.nassau || {}), g.nassau && g.nassau.enabled);
    add('bestball', bestBall(round, g.bestball || {}), g.bestball && g.bestball.enabled);
    add('vegas', vegas(round, g.vegas || {}), g.vegas && g.vegas.enabled);
    var b = g.bonus || {};
    var bonus = bonuses(round, b);
    out.bonus = bonus;
    if (b.nearest || b.longest || b.birdie) out.transfers = out.transfers.concat(bonus.transfers);
    out.settlement = settle(out.transfers, round.players);
    return out;
  }

  return {
    defaultStrokeIndex: defaultStrokeIndex,
    defaultPars: defaultPars,
    strokesPerHole: strokesPerHole,
    strokesMap: strokesMap,
    gross: gross,
    score: score,
    toParLabel: toParLabel,
    fmtToPar: fmtToPar,
    playerById: playerById,
    teamsOf: teamsOf,
    teamHoleScore: teamHoleScore,
    stablefordPoints: stablefordPoints,
    computeMatch: computeMatch,
    strokePlay: strokePlay,
    stableford: stableford,
    skins: skins,
    matchPlay: matchPlay,
    nassau: nassau,
    bestBall: bestBall,
    vegas: vegas,
    bonuses: bonuses,
    settle: settle,
    simplify: simplify,
    computeAll: computeAll
  };
});
