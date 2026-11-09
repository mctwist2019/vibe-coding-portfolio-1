/* app.js — 골프 스코어 앱 UI (vanilla JS, 상태는 localStorage에 저장) */
(function () {
  'use strict';
  var G = window.GolfGames;
  var KEY = 'golfscore.v1';
  var TEAMS = ['A', 'B', 'C', 'D'];
  var $app = document.getElementById('app');

  // ───────────────────────── 유틸 ─────────────────────────
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function won(n) { n = Math.round(n); return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ko-KR') + '원'; }
  function signedWon(n) { n = Math.round(n); return (n > 0 ? '+' : '') + won(n); }
  function tpClass(d) { return d < 0 ? 'under' : d > 0 ? 'over' : 'even'; }
  function badge(team) { return team ? '<span class="badge team-' + esc(team) + '">' + esc(team) + '</span>' : ''; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function setPath(obj, path, val) {
    var parts = path.split('.'); var o = obj;
    for (var i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = val;
  }
  function getPath(obj, path) {
    var parts = path.split('.'); var o = obj;
    for (var i = 0; i < parts.length; i++) { if (o == null) return undefined; o = o[parts[i]]; }
    return o;
  }

  // ───────────────────────── 기본값 ─────────────────────────
  function defaultGames() {
    return {
      stroke: { enabled: true, net: false, unit: 0 },
      stableford: { enabled: false, net: true },
      skins: { enabled: false, net: false, mode: 'individual', unit: 1000 },
      match: { enabled: false, net: false, mode: 'individual', unit: 1000 },
      nassau: { enabled: false, net: false, mode: 'individual', unit: 5000 },
      bestball: { enabled: false, net: false, count: 1, unit: 1000 },
      vegas: { enabled: false, net: false, unit: 100 },
      bonus: { nearest: false, longest: false, birdie: false, unit: 1000 }
    };
  }
  function newPlayer(i) { return { id: uid(), name: '', hcp: 0, team: '' }; }
  function newDraft() {
    return { name: '', date: today(), holes: 18, players: [newPlayer(), newPlayer(), newPlayer(), newPlayer()], games: defaultGames() };
  }

  // ───────────────────────── 상태 ─────────────────────────
  var state = load();
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.history)) return s; } catch (e) { /* ignore */ }
    return { view: 'home', round: null, history: [], draft: null, boardTab: 'stroke', boardNet: false, readOnly: false, viewRoundId: null };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  function getRound() {
    if (state.readOnly) { for (var i = 0; i < state.history.length; i++) if (state.history[i].id === state.viewRoundId) return state.history[i]; return null; }
    return state.round;
  }
  function go(view) { state.view = view; save(); render(); window.scrollTo(0, 0); }

  // ───────────────────────── 공통 UI 조각 ─────────────────────────
  function topbar(title, sub, left, right) {
    return '<div class="topbar">' + (left || '') + '<h1>' + esc(title) + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</h1>' + (right || '') + '</div>';
  }
  function backBtn(view, label) { return '<button class="iconbtn" data-action="go" data-view="' + view + '">‹ ' + esc(label || '홈') + '</button>'; }
  function toggle(path, checked, label) {
    return '<label class="switch"><input type="checkbox" data-bind="' + path + '" data-type="bool" ' + (checked ? 'checked' : '') + '><span class="track"></span><span class="lbl">' + label + '</span></label>';
  }
  function seg(path, value, options, cls) {
    return '<div class="seg ' + (cls || '') + '">' + options.map(function (o) {
      return '<button type="button" data-action="set" data-path="' + path + '" data-value="' + esc(o[0]) + '" data-type="' + (typeof o[0] === 'number' ? 'number' : 'string') + '" class="' + (String(o[0]) === String(value) ? 'active' : '') + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function numField(path, value, suffix, step) {
    return '<span class="inline-num"><input type="number" inputmode="numeric" min="0" step="' + (step || 100) + '" data-bind="' + path + '" data-type="number" value="' + esc(value) + '"><span class="small muted">' + esc(suffix || '') + '</span></span>';
  }
  function bottomNav(active) {
    var items = [['play', '✏️', '스코어 입력'], ['board', '🏆', '리더보드'], ['card', '📋', '스코어카드']];
    if (state.readOnly) items = items.slice(1);
    return '<nav class="bottomnav"><div class="inner">' + items.map(function (it) {
      return '<button data-action="go" data-view="' + it[0] + '" class="' + (active === it[0] ? 'active' : '') + '"><span class="ic">' + it[1] + '</span>' + it[2] + '</button>';
    }).join('') + '</div></nav>';
  }

  // ───────────────────────── 홈 ─────────────────────────
  function viewHome() {
    var r = state.round;
    var html = topbar('골프 스코어', '', '', '');
    html += '<div class="screen">';
    html += '<div class="hero"><div class="logo">⛳</div><h1>골프 스코어 & 게임</h1><p>개인 스코어부터 팀 대항 내기까지 한 번에 정산</p></div>';
    if (r) {
      var done = holesDone(r);
      html += '<div class="card"><h2>진행 중인 라운드 <span class="hint">' + esc(r.date) + '</span></h2>' +
        '<div style="font-size:18px;font-weight:800">' + esc(r.name || '라운드') + '</div>' +
        '<div class="muted small">' + r.players.map(function (p) { return esc(p.name); }).join(', ') + ' · ' + done + '/' + r.holes + '홀 입력</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn primary grow" data-action="go" data-view="play">이어하기</button><button class="btn grow" data-action="go" data-view="board">리더보드</button></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn sm ghost grow" data-action="finish">라운드 종료</button><button class="btn sm ghost danger grow" data-action="discard">삭제</button></div></div>';
    }
    html += '<button class="btn primary big block" data-action="new-round">＋ 새 라운드 시작</button>';
    if (state.history.length) {
      html += '<div class="card"><h2>지난 라운드</h2>' + state.history.map(function (h) {
        var res = G.strokePlay(h, {});
        var w = res.rows[0];
        return '<div class="histrow"><div class="grow"><div class="t">' + esc(h.name || '라운드') + ' <span class="muted small">' + esc(h.date) + '</span></div>' +
          '<div class="s">' + h.players.length + '명 · ' + h.holes + '홀' + (w && w.played ? ' · 1위 ' + esc(w.name) + ' (' + w.gross + ', ' + G.fmtToPar(w.toPar) + ')' : '') + '</div></div>' +
          '<button class="btn sm" data-action="view-history" data-id="' + h.id + '">보기</button>' +
          '<button class="btn sm ghost danger" data-action="del-history" data-id="' + h.id + '">삭제</button></div>';
      }).join('') + '</div>';
    }
    html += '<footer class="note">데이터는 이 기기 브라우저에만 저장됩니다. 홈 화면에 추가하면 앱처럼 사용할 수 있어요.</footer>';
    html += '</div>';
    return html;
  }

  function holesDone(r) {
    var n = 0;
    for (var h = 0; h < r.holes; h++) if (r.players.every(function (p) { return G.gross(r, p.id, h) !== null; })) n++;
    return n;
  }

  // ───────────────────────── 설정(새 라운드 / 라운드 중 설정) ─────────────────────────
  function playersSection(prefix, players, editable) {
    var html = '<div class="card"><h2>플레이어 <span class="hint">2~8명 · 핸디는 18홀 기준</span></h2>';
    html += '<div class="prow phead"><span>이름</span><span class="center">핸디</span><span class="center">팀</span><span></span></div>';
    html += '<div class="stack" style="margin-top:4px">' + players.map(function (p, i) {
      return '<div class="prow">' +
        '<input type="text" placeholder="플레이어 ' + (i + 1) + '" data-bind="' + prefix + '.players.' + i + '.name" value="' + esc(p.name) + '" maxlength="12">' +
        '<input type="number" inputmode="numeric" min="0" max="54" data-bind="' + prefix + '.players.' + i + '.hcp" data-type="number" value="' + esc(p.hcp || 0) + '">' +
        '<select data-bind="' + prefix + '.players.' + i + '.team"><option value="">없음</option>' + TEAMS.map(function (t) { return '<option value="' + t + '" ' + (p.team === t ? 'selected' : '') + '>' + t + '팀</option>'; }).join('') + '</select>' +
        (editable ? '<button class="del" data-action="del-player" data-i="' + i + '" title="삭제" ' + (players.length <= 2 ? 'disabled' : '') + '>×</button>' : '<span></span>') +
        '</div>';
    }).join('') + '</div>';
    html += '<div class="row" style="margin-top:10px;flex-wrap:wrap">' +
      (editable ? '<button class="btn sm" data-action="add-player" ' + (players.length >= 8 ? 'disabled' : '') + '>＋ 플레이어 추가</button>' : '') +
      '<button class="btn sm" data-action="auto-team" data-prefix="' + prefix + '">팀 자동 배정 (2팀)</button>' +
      '<button class="btn sm ghost" data-action="clear-team" data-prefix="' + prefix + '">팀 해제</button></div>';
    html += '</div>';
    return html;
  }

  function gameCard(key, title, desc, enabledPath, enabled, body) {
    return '<div class="card">' + toggle(enabledPath, enabled, title) + '<div class="desc">' + desc + '</div>' + (enabled ? '<div class="opts">' + body + '</div>' : '') + '</div>';
  }

  function gamesSection(prefix, g, holes) {
    var P = prefix + '.games.';
    var html = '';
    html += '<div class="card">' + toggle(P + 'stroke.enabled', true, '스트로크 플레이 (기본)') +
      '<div class="desc">총 타수로 순위. 금액을 넣으면 타수 차 × 단가로 1:1 정산</div>' +
      '<div class="opts"><span class="lab">타당</span>' + numField(P + 'stroke.unit', g.stroke.unit, '원') +
      toggle(P + 'stroke.net', g.stroke.net, '네트(핸디 적용) 기준') + '</div></div>';
    html += gameCard('stableford', '스테이블포드', '홀별 점수 합산: 버디 3 · 파 2 · 보기 1 · 이글 4 · 더블보기 이하 0', P + 'stableford.enabled', g.stableford.enabled,
      toggle(P + 'stableford.net', g.stableford.net, '네트(핸디 적용)'));
    html += gameCard('skins', '스킨스', '홀마다 단독 최저타가 스킨 획득. 동타면 다음 홀로 이월(캐리오버)', P + 'skins.enabled', g.skins.enabled,
      '<span class="lab">방식</span>' + seg(P + 'skins.mode', g.skins.mode, [['individual', '개인'], ['team', '팀(베스트볼)']]) +
      '<span class="lab">스킨당</span>' + numField(P + 'skins.unit', g.skins.unit, '원') + toggle(P + 'skins.net', g.skins.net, '네트'));
    html += gameCard('match', '매치 플레이', '홀별 승패로 UP/DOWN. 개인은 전원 리그전, 팀은 2팀 베스트볼 대결. 홀 차 × 단가 정산', P + 'match.enabled', g.match.enabled,
      '<span class="lab">방식</span>' + seg(P + 'match.mode', g.match.mode, [['individual', '개인(리그)'], ['team', '팀(2팀)']]) +
      '<span class="lab">홀당</span>' + numField(P + 'match.unit', g.match.unit, '원') + toggle(P + 'match.net', g.match.net, '네트'));
    html += gameCard('nassau', '나소 (전반/후반/전체)', '18홀을 전반 9 · 후반 9 · 전체 18 세 판의 매치로 나눠 각각 정산' + (holes !== 18 ? ' <b>(18홀 전용)</b>' : ''), P + 'nassau.enabled', g.nassau.enabled,
      '<span class="lab">방식</span>' + seg(P + 'nassau.mode', g.nassau.mode, [['individual', '개인'], ['team', '팀(2팀)']]) +
      '<span class="lab">판당</span>' + numField(P + 'nassau.unit', g.nassau.unit, '원') + toggle(P + 'nassau.net', g.nassau.net, '네트'));
    html += gameCard('bestball', '베스트볼 (팀 대항)', '홀마다 팀원 중 좋은 점수(1개 또는 2개 합)로 팀 점수. 홀 승리마다 단가 정산', P + 'bestball.enabled', g.bestball.enabled,
      '<span class="lab">팀 점수</span>' + seg(P + 'bestball.count', g.bestball.count, [[1, '베스트 1'], [2, '베스트 2 합']]) +
      '<span class="lab">홀 승리당</span>' + numField(P + 'bestball.unit', g.bestball.unit, '원') + toggle(P + 'bestball.net', g.bestball.net, '네트'));
    html += gameCard('vegas', '라스베가스 (2:2)', '팀 두 명 점수를 낮은수·높은수 순으로 붙여 두 자리 수 비교(4·5 → 45). 상대팀 버디면 뒤집힘(54). 점수 차 × 단가', P + 'vegas.enabled', g.vegas.enabled,
      '<span class="lab">점당</span>' + numField(P + 'vegas.unit', g.vegas.unit, '원', 100) + toggle(P + 'vegas.net', g.vegas.net, '네트'));
    html += '<div class="card"><h2>보너스</h2><div class="stack">' +
      toggle(P + 'bonus.nearest', g.bonus.nearest, '니어리스트 (파3)') +
      toggle(P + 'bonus.longest', g.bonus.longest, '롱기스트') +
      toggle(P + 'bonus.birdie', g.bonus.birdie, '버디 보너스 (이글은 2배)') +
      '</div><div class="opts"><span class="lab">1회당 (다른 플레이어 각각 지급)</span>' + numField(P + 'bonus.unit', g.bonus.unit, '원') + '</div></div>';
    return html;
  }

  function viewSetup() {
    var d = state.draft;
    var html = topbar('새 라운드', '', backBtn('home'), '');
    html += '<div class="screen">';
    html += '<div class="card"><h2>라운드 정보</h2><div class="stack">' +
      '<div class="field"><label>라운드 / 골프장 이름</label><input type="text" data-bind="draft.name" value="' + esc(d.name) + '" placeholder="예: 주말 라운딩 @ ○○CC"></div>' +
      '<div class="row"><div class="field grow"><label>날짜</label><input type="date" data-bind="draft.date" value="' + esc(d.date) + '"></div>' +
      '<div class="field"><label>홀 수</label>' + seg('draft.holes', d.holes, [[9, '9홀'], [18, '18홀']]) + '</div></div>' +
      '<div class="muted small">파/핸디캡 인덱스는 기본값(파72)으로 시작하고, 스코어 입력 화면에서 홀마다 바꿀 수 있어요.</div></div></div>';
    html += playersSection('draft', d.players, true);
    html += '<h2 style="margin:4px 2px -4px;font-size:16px">게임 선택</h2>';
    html += gamesSection('draft', d.games, d.holes);
    if (state.setupError) html += '<div class="error">' + state.setupError.map(esc).join('<br>') + '</div>';
    html += '<button class="btn primary big block" data-action="start-round">라운드 시작 🏁</button>';
    html += '</div>';
    return html;
  }

  function viewSettings() {
    var r = state.round;
    var html = topbar('라운드 설정', '', backBtn('play', '입력'), '');
    html += '<div class="screen">';
    html += '<div class="notice">라운드 중에도 게임과 금액을 바꿀 수 있어요. 결과는 즉시 다시 계산됩니다.</div>';
    html += '<div class="card"><h2>라운드 정보</h2><div class="field"><label>이름</label><input type="text" data-bind="round.name" value="' + esc(r.name) + '"></div></div>';
    html += playersSection('round', r.players, false);
    html += gamesSection('round', r.games, r.holes);
    if (state.setupError) html += '<div class="error">' + state.setupError.map(esc).join('<br>') + '</div>';
    html += '<button class="btn primary big block" data-action="go" data-view="play">완료</button>';
    html += '</div>';
    return html;
  }

  function validate(d) {
    var errs = [];
    var players = d.players.filter(function (p) { return (p.name || '').trim(); });
    if (players.length < 2) errs.push('플레이어 이름을 2명 이상 입력하세요.');
    var teams = {};
    players.forEach(function (p) { if (p.team) teams[p.team] = (teams[p.team] || 0) + 1; });
    var nTeams = Object.keys(teams).length;
    var g = d.games;
    if (g.skins.enabled && g.skins.mode === 'team' && nTeams < 2) errs.push('팀 스킨스: 팀을 2개 이상 지정하세요.');
    if (g.match.enabled && g.match.mode === 'team' && nTeams !== 2) errs.push('팀 매치: 정확히 2팀이 필요합니다.');
    if (g.nassau.enabled && d.holes !== 18) errs.push('나소는 18홀에서만 가능합니다.');
    if (g.nassau.enabled && g.nassau.mode === 'team' && nTeams !== 2) errs.push('팀 나소: 정확히 2팀이 필요합니다.');
    if (g.bestball.enabled && nTeams < 2) errs.push('베스트볼: 팀을 2개 이상 지정하세요.');
    if (g.vegas.enabled && (nTeams !== 2 || Object.keys(teams).some(function (t) { return teams[t] !== 2; }))) errs.push('라스베가스: 2명씩 2팀이 필요합니다.');
    return errs;
  }

  function startRound() {
    var d = state.draft;
    var errs = validate(d);
    if (errs.length) { state.setupError = errs; save(); render(); return; }
    var players = d.players.filter(function (p) { return (p.name || '').trim(); }).map(function (p) {
      return { id: p.id || uid(), name: p.name.trim(), hcp: Math.max(0, Number(p.hcp) || 0), team: p.team || '' };
    });
    var scores = {};
    players.forEach(function (p) { scores[p.id] = new Array(d.holes).fill(null); });
    state.round = {
      id: uid(), name: d.name.trim() || ('라운드 ' + d.date), date: d.date, holes: d.holes,
      pars: G.defaultPars(d.holes), strokeIndex: G.defaultStrokeIndex(d.holes),
      players: players, scores: scores, extras: {}, games: clone(d.games), currentHole: 0, createdAt: Date.now()
    };
    state.setupError = null; state.readOnly = false; state.viewRoundId = null; state.boardTab = 'stroke';
    go('play');
  }

  // ───────────────────────── 스코어 입력 ─────────────────────────
  function viewPlay() {
    var r = state.round;
    if (!r) { state.view = 'home'; return viewHome(); }
    var h = Math.min(Math.max(0, r.currentHole || 0), r.holes - 1);
    r.currentHole = h;
    var par = r.pars[h];
    var sm = G.strokesMap(r);
    var allIn = r.players.every(function (p) { return G.gross(r, p.id, h) !== null; });
    var g = r.games;
    var html = topbar(r.name, (h + 1) + '/' + r.holes + '홀', backBtn('home'), '<button class="iconbtn" data-action="go" data-view="settings">⚙︎</button>');
    html += '<div class="screen">';
    // hole header
    html += '<div class="card"><div class="holehead"><div class="num">' + (h + 1) + '<small>번홀</small></div><div class="meta">' +
      '<div class="row"><span class="small muted">파</span>' + seg('round.pars.' + h, par, [[3, '3'], [4, '4'], [5, '5']]) +
      '<span class="si" style="margin-left:auto">HCP <input type="number" inputmode="numeric" min="1" max="' + r.holes + '" data-bind="round.strokeIndex.' + h + '" data-type="number" value="' + r.strokeIndex[h] + '"></span></div>' +
      '</div></div>';
    html += '<div class="hole-strip">' + holeStrip(r, h) + '</div></div>';
    // players
    html += '<div class="card">' + r.players.map(function (p) {
      var s = G.gross(r, p.id, h);
      var st = sm[p.id][h];
      var tot = runningTotal(r, p.id);
      var diff = s === null ? null : s - par;
      return '<div class="scorerow">' +
        '<div class="who"><div class="name">' + badge(p.team) + '<span>' + esc(p.name) + '</span></div>' +
        '<div class="meta"><span>' + tot.gross + '타</span><span class="tp ' + tpClass(tot.toPar) + '">' + G.fmtToPar(tot.toPar) + '</span>' +
        (p.hcp ? '<span>H' + p.hcp + '</span>' : '') + (st ? '<span class="dots" title="이 홀 핸디 타수">' + '●'.repeat(st) + '</span>' : '') + '</div></div>' +
        '<button class="pm" data-action="score" data-pid="' + p.id + '" data-delta="-1">−</button>' +
        '<button class="scorebox ' + (s !== null ? 'set' : '') + '" data-action="score-tap" data-pid="' + p.id + '">' +
        (s === null ? '<span class="v empty">파 ' + par + '</span><span class="l">탭하여 입력</span>'
          : '<span class="v">' + s + '</span><span class="l ' + tpClass(diff) + '">' + G.toParLabel(diff) + '</span><span class="x" data-action="score-clear" data-pid="' + p.id + '">×</span>') +
        '</button>' +
        '<button class="pm" data-action="score" data-pid="' + p.id + '" data-delta="1">＋</button>' +
        '</div>';
    }).join('');
    html += '<div class="quick" style="margin-top:10px"><button class="btn sm grow" data-action="par-all">전원 파 입력</button><button class="btn sm ghost" data-action="clear-hole">홀 초기화</button></div>';
    html += '</div>';
    // bonuses
    if (g.bonus && (g.bonus.nearest || g.bonus.longest)) {
      var ex = (r.extras && r.extras[h]) || {};
      html += '<div class="card"><h2>보너스 <span class="hint">받는 사람 선택</span></h2><div class="stack">';
      if (g.bonus.nearest) html += '<div class="chips"><span class="small muted blab">니어리스트</span>' + r.players.map(function (p) {
        return '<button class="chip accent ' + (ex.nearest === p.id ? 'active' : '') + '" data-action="extra" data-type="nearest" data-pid="' + p.id + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>';
      if (g.bonus.longest) html += '<div class="chips"><span class="small muted blab">롱기스트</span>' + r.players.map(function (p) {
        return '<button class="chip accent ' + (ex.longest === p.id ? 'active' : '') + '" data-action="extra" data-type="longest" data-pid="' + p.id + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>';
      html += '</div></div>';
    }
    // live summary of active games
    html += liveSummary(r, h);
    // nav
    html += '<div class="navbtns"><button class="btn" data-action="hole" data-i="' + (h - 1) + '" ' + (h === 0 ? 'disabled' : '') + '>‹ 이전 홀</button>' +
      (h === r.holes - 1 ? '<button class="btn primary" data-action="finish">라운드 종료 🏁</button>'
        : '<button class="btn ' + (allIn ? 'primary' : '') + '" data-action="hole" data-i="' + (h + 1) + '">다음 홀 ›</button>') + '</div>';
    html += '</div>';
    html += bottomNav('play');
    return html;
  }

  function holeStrip(r, cur) {
    var out = '';
    for (var i = 0; i < r.holes; i++) {
      var n = r.players.filter(function (p) { return G.gross(r, p.id, i) !== null; }).length;
      var cls = i === cur ? 'cur' : n === r.players.length ? 'done' : n > 0 ? 'partial' : '';
      if (i === 9) out += '<span class="sep"></span>';
      out += '<button class="' + cls + '" data-action="hole" data-i="' + i + '">' + (i + 1) + '</button>';
    }
    return out;
  }

  function runningTotal(r, pid) {
    var g = 0, par = 0, played = 0;
    for (var h = 0; h < r.holes; h++) { var s = G.gross(r, pid, h); if (s === null) continue; g += s; par += r.pars[h]; played++; }
    return { gross: g, toPar: g - par, played: played };
  }

  function liveSummary(r, h) {
    var g = r.games, all = G.computeAll(r), parts = [];
    if (all.skins && !all.skins.error) {
      var lead = all.skins.entrants.map(function (e) { return esc(e.name) + ' ' + e.skins; }).join(' · ');
      parts.push('<div class="kv"><span class="k">스킨스</span><span>' + lead + (all.skins.carry ? ' <b style="color:#7a5a00">(이월 ' + all.skins.carry + ')</b>' : '') + '</span></div>');
    }
    if (all.match && !all.match.error) {
      parts.push('<div class="kv"><span class="k">매치</span><span>' + all.match.matches.map(function (m) {
        var lead = m.status.leader === 'A' ? m.a.name : m.status.leader === 'B' ? m.b.name : null;
        return (lead ? '<b>' + esc(lead) + '</b> ' : '') + m.status.text + ' <span class="muted">(' + esc(m.a.name) + ' vs ' + esc(m.b.name) + ')</span>';
      }).join('<br>') + '</span></div>');
    }
    if (all.vegas && !all.vegas.error) {
      parts.push('<div class="kv"><span class="k">라스베가스</span><span>' + all.vegas.teams.map(function (t) { return esc(t.name) + ' ' + t.points + '점'; }).join(' · ') + '</span></div>');
    }
    if (all.bestball && !all.bestball.error) {
      parts.push('<div class="kv"><span class="k">베스트볼</span><span>' + all.bestball.teams.map(function (t) { return esc(t.name) + ' ' + G.fmtToPar(t.toPar) + ' (' + t.holesWon + '홀 승)'; }).join(' · ') + '</span></div>');
    }
    if (!parts.length) return '';
    return '<div class="card"><h2>현재 상황</h2><div class="stack">' + parts.join('') + '</div></div>';
  }

  // ───────────────────────── 리더보드 ─────────────────────────
  function viewBoard() {
    var r = getRound();
    if (!r) { state.view = 'home'; return viewHome(); }
    var all = G.computeAll(r);
    var tabs = [['stroke', '종합']];
    if (all.stableford) tabs.push(['stableford', '스테이블포드']);
    if (all.skins) tabs.push(['skins', '스킨스']);
    if (all.match) tabs.push(['match', '매치']);
    if (all.nassau) tabs.push(['nassau', '나소']);
    if (all.bestball) tabs.push(['bestball', '베스트볼']);
    if (all.vegas) tabs.push(['vegas', '라스베가스']);
    if (all.bonus) tabs.push(['bonus', '보너스']);
    tabs.push(['settle', '💰 정산']);
    var tab = tabs.some(function (t) { return t[0] === state.boardTab; }) ? state.boardTab : 'stroke';
    var html = topbar(r.name, state.readOnly ? '기록' : holesDone(r) + '/' + r.holes + '홀', backBtn('home'), state.readOnly ? '' : '<button class="iconbtn" data-action="go" data-view="settings">⚙︎</button>');
    html += '<div class="screen">';
    html += '<div class="tabs">' + tabs.map(function (t) { return '<button data-action="tab" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'active' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    html += ({
      stroke: tabStroke, stableford: tabStableford, skins: tabSkins, match: tabMatch, nassau: tabNassau,
      bestball: tabBestball, vegas: tabVegas, bonus: tabBonus, settle: tabSettle
    })[tab](r, all);
    html += '</div>' + bottomNav('board');
    return html;
  }

  function tabStroke(r, all) {
    var res = G.strokePlay(r, { net: state.boardNet, unit: r.games.stroke.unit });
    var hasHcp = r.players.some(function (p) { return p.hcp > 0; });
    var html = '<div class="card"><h2>순위' + (hasHcp ? '<span class="hint">' + seg('boardNet', state.boardNet, [[false, '그로스'], [true, '네트']]) + '</span>' : '') + '</h2>';
    html += '<table><thead><tr><th></th><th class="l">플레이어</th><th>홀</th><th>타수</th><th>±파</th>' + (hasHcp ? '<th>네트</th>' : '') + '</tr></thead><tbody>';
    res.rows.forEach(function (p) {
      html += '<tr><td>' + (p.rank ? '<span class="rank r' + p.rank + '">' + p.rank + '</span>' : '') + '</td><td class="l">' + badge(p.team) + ' ' + esc(p.name) + (p.hcp ? ' <span class="muted small">H' + p.hcp + '</span>' : '') + '</td>' +
        '<td>' + p.played + '</td><td><b>' + p.gross + '</b></td><td class="' + tpClass(p.toPar) + '"><b>' + G.fmtToPar(p.toPar) + '</b></td>' +
        (hasHcp ? '<td>' + p.net + ' <span class="small ' + tpClass(p.netToPar) + '">(' + G.fmtToPar(p.netToPar) + ')</span></td>' : '') + '</tr>';
    });
    html += '</tbody></table></div>';
    if (r.games.stroke.unit > 0 && all.stroke.transfers.length) {
      html += '<div class="card"><h2>스트로크 내기 <span class="hint">타당 ' + won(r.games.stroke.unit) + ' · 전원 완료 홀 기준</span></h2>' +
        all.stroke.transfers.map(function (t) { return '<div class="payline"><span>' + esc(nameOf(r, t.from)) + ' → ' + esc(nameOf(r, t.to)) + ' <span class="muted small">' + esc(t.note) + '</span></span><span class="amt">' + won(t.amount) + '</span></div>'; }).join('') + '</div>';
    }
    return html;
  }

  function tabStableford(r, all) {
    var res = all.stableford;
    var html = '<div class="card"><h2>스테이블포드 <span class="hint">' + (res.net ? '네트' : '그로스') + ' · 높을수록 좋음</span></h2><table><thead><tr><th></th><th class="l">플레이어</th><th>점수</th></tr></thead><tbody>';
    res.rows.forEach(function (p) {
      html += '<tr><td><span class="rank r' + p.rank + '">' + p.rank + '</span></td><td class="l">' + badge(p.team) + ' ' + esc(p.name) + '</td><td><b style="font-size:18px">' + p.points + '</b></td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="card"><h2>홀별 점수</h2><div class="tablewrap"><table class="scorecard"><thead><tr><th></th>' + holeHeaders(r, false) + '<th class="sum">합</th></tr></thead><tbody>';
    res.rows.forEach(function (p) {
      html += '<tr><td>' + esc(p.name) + '</td>' + p.holes.map(function (v, i) { return '<td>' + (v === null ? '' : v) + '</td>' + (i === 8 && r.holes === 18 ? '<td class="sum">' + sumRange(p.holes, 0, 9) + '</td>' : ''); }).join('') + '<td class="sum">' + p.points + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  function tabSkins(r, all) {
    var res = all.skins;
    if (res.error) return '<div class="error">' + esc(res.error) + '</div>';
    var html = '<div class="card"><h2>스킨스 <span class="hint">' + (res.unit ? '스킨당 ' + won(res.unit) : '') + (res.net ? ' · 네트' : '') + '</span></h2><table><thead><tr><th class="l">' + (r.games.skins.mode === 'team' ? '팀' : '플레이어') + '</th><th>스킨</th><th>금액</th></tr></thead><tbody>';
    var money = {};
    res.transfers.forEach(function (t) { money[t.to] = (money[t.to] || 0) + t.amount; money[t.from] = (money[t.from] || 0) - t.amount; });
    res.entrants.forEach(function (e) {
      var m = e.pids.reduce(function (a, pid) { return a + (money[pid] || 0); }, 0);
      html += '<tr><td class="l"><b>' + esc(e.name) + '</b>' + (e.pids.length > 1 ? ' <span class="muted small">' + e.pids.map(function (pid) { return esc(nameOf(r, pid)); }).join(', ') + '</span>' : '') + '</td><td><b style="font-size:18px">' + e.skins + '</b></td><td class="' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '">' + (res.unit ? signedWon(m) : '-') + '</td></tr>';
    });
    html += '</tbody></table>' + (res.carry ? '<div class="notice" style="margin-top:10px">' + (holesDone(r) === r.holes ? '마지막 홀까지 이월된 ' + res.carry + '스킨은 정산에 포함되지 않습니다' : '현재 ' + res.carry + '스킨 이월 중 — 다음 홀 단독 승자가 가져갑니다') + '</div>' : '') + '</div>';
    html += '<div class="card"><h2>홀별 결과</h2><div class="skinlist">' + res.holes.map(function (h) {
      var cls = h.winner ? 'won' : (h.played && h.tie) ? 'carry' : '';
      return '<div class="' + cls + '">' + (h.hole + 1) + '홀<b>' + (h.winner ? esc(h.winnerName) + ' ' + h.skins : h.played ? '이월' : '-') + '</b></div>';
    }).join('') + '</div></div>';
    return html;
  }

  function matchBox(m, st, extra) {
    var a = st.leader === 'A', b = st.leader === 'B';
    return '<div class="matchbox"><div class="side ' + (a ? 'lead' : '') + '">' + esc(m.a.name) + (a ? ' ▲' : '') + '</div>' +
      '<div class="st">' + esc(st.text) + '<small>' + (extra || (st.finished ? '종료' : '진행 중')) + '</small></div>' +
      '<div class="side r ' + (b ? 'lead' : '') + '">' + (b ? '▲ ' : '') + esc(m.b.name) + '</div>' +
      '<div class="holedots">' + st.holes.map(function (v) { return '<span class="' + (v === 1 ? 'a' : v === -1 ? 'b' : v === 0 ? 't' : '') + '">·</span>'; }).join('') + '</div></div>';
  }

  function tabMatch(r, all) {
    var res = all.match;
    if (res.error) return '<div class="error">' + esc(res.error) + '</div>';
    return '<div class="card"><h2>매치 플레이 <span class="hint">' + (res.unit ? '홀당 ' + won(res.unit) : '') + (res.net ? ' · 네트' : '') + '</span></h2><div class="stack">' +
      res.matches.map(function (m) { return matchBox(m, m.status, m.money ? won(m.money) : null); }).join('') +
      '</div><div class="muted small" style="margin-top:8px"><span style="color:var(--team-A)">■</span> 왼쪽 승 &nbsp;<span style="color:var(--team-B)">■</span> 오른쪽 승 &nbsp;<span style="color:#cbd5d0">■</span> 무승부. 금액은 매치 종료 시 홀 차 × 단가로 확정됩니다.</div></div>';
  }

  function tabNassau(r, all) {
    var res = all.nassau;
    if (res.error) return '<div class="error">' + esc(res.error) + '</div>';
    return res.matches.map(function (m) {
      return '<div class="card"><h2>' + esc(m.a.name) + ' vs ' + esc(m.b.name) + ' <span class="hint">판당 ' + won(res.unit) + '</span></h2><div class="stack">' +
        m.segments.map(function (s) { return '<div class="small muted" style="margin-bottom:-4px">' + esc(s.name) + '</div>' + matchBox(m, s.status, s.money ? won(s.money) : null); }).join('') + '</div></div>';
    }).join('');
  }

  function tabBestball(r, all) {
    var res = all.bestball;
    if (res.error) return '<div class="error">' + esc(res.error) + '</div>';
    var html = '<div class="card"><h2>베스트볼 <span class="hint">베스트 ' + res.count + (res.net ? ' · 네트' : '') + (res.unit ? ' · 홀당 ' + won(res.unit) : '') + '</span></h2><table><thead><tr><th class="l">팀</th><th>팀 타수</th><th>±파</th><th>홀 승</th></tr></thead><tbody>';
    res.teams.forEach(function (t, i) {
      html += '<tr><td class="l">' + badge(t.id) + ' <span class="muted small">' + t.pids.map(function (pid) { return esc(nameOf(r, pid)); }).join(', ') + '</span></td><td><b>' + t.total + '</b></td><td class="' + tpClass(t.toPar) + '"><b>' + G.fmtToPar(t.toPar) + '</b></td><td>' + t.holesWon + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="card"><h2>홀별 팀 점수</h2><div class="tablewrap"><table class="scorecard"><thead><tr><th></th>' + holeHeaders(r, false) + (r.holes === 18 ? '<th class="sum">IN</th>' : '') + '<th class="sum">TOT</th></tr></thead><tbody>';
    G.teamsOf(r).forEach(function (t, idx) {
      var vals = res.holes.map(function (h) { return h.scores[idx]; });
      html += '<tr><td>' + badge(t.id) + '</td>' + res.holes.map(function (h, i) {
        var v = h.scores[idx];
        return '<td class="' + (h.winner === t.id ? 'pos' : '') + '">' + (v === null ? '' : v) + '</td>' + (i === 8 && r.holes === 18 ? '<td class="sum">' + (sumRange(vals, 0, 9) || '') + '</td>' : '');
      }).join('') + (r.holes === 18 ? '<td class="sum">' + (sumRange(vals, 9, 18) || '') + '</td>' : '') + '<td class="sum">' + (sumRange(vals, 0, r.holes) || '') + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  function tabVegas(r, all) {
    var res = all.vegas;
    if (res.error) return '<div class="error">' + esc(res.error) + '</div>';
    var html = '<div class="card"><h2>라스베가스 <span class="hint">점당 ' + won(res.unit) + '</span></h2><div class="row" style="justify-content:space-around;text-align:center">' +
      res.teams.map(function (t, i) {
        var m = (t.points - res.teams[1 - i].points) * res.unit;
        return '<div>' + badge(t.id) + '<div class="small muted">' + t.pids.map(function (pid) { return esc(nameOf(r, pid)); }).join(' · ') + '</div><div style="font-size:30px;font-weight:800">' + t.points + '</div><div class="small ' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '">' + signedWon(m) + '</div></div>';
      }).join('<div style="font-size:22px;color:#aaa">vs</div>') + '</div></div>';
    html += '<div class="card"><h2>홀별</h2><table><thead><tr><th>홀</th><th>' + badge(res.teams[0].id) + '</th><th>' + badge(res.teams[1].id) + '</th><th>차</th></tr></thead><tbody>';
    res.holes.forEach(function (h) {
      if (!h.played) return;
      html += '<tr><td>' + (h.hole + 1) + '</td><td class="' + (h.winner === res.teams[0].id ? 'pos' : '') + '">' + h.nums[0] + (h.flips[0] ? ' ↻' : '') + '</td><td class="' + (h.winner === res.teams[1].id ? 'pos' : '') + '">' + h.nums[1] + (h.flips[1] ? ' ↻' : '') + '</td><td>' + (h.points || '-') + '</td></tr>';
    });
    html += '</tbody></table><div class="muted small" style="margin-top:6px">↻ 상대 버디로 숫자 뒤집힘</div></div>';
    return html;
  }

  function tabBonus(r, all) {
    var res = all.bonus, g = r.games.bonus;
    var money = {};
    res.transfers.forEach(function (t) { money[t.to] = (money[t.to] || 0) + t.amount; money[t.from] = (money[t.from] || 0) - t.amount; });
    var html = '<div class="card"><h2>보너스 <span class="hint">1회당 ' + won(g.unit) + '</span></h2><table><thead><tr><th class="l">플레이어</th>' + (g.nearest ? '<th>니어</th>' : '') + (g.longest ? '<th>롱기</th>' : '') + (g.birdie ? '<th>버디</th><th>이글+</th>' : '') + '<th>금액</th></tr></thead><tbody>';
    r.players.forEach(function (p) {
      var c = res.counts[p.id], m = money[p.id] || 0;
      html += '<tr><td class="l">' + badge(p.team) + ' ' + esc(p.name) + '</td>' + (g.nearest ? '<td>' + c.nearest + '</td>' : '') + (g.longest ? '<td>' + c.longest + '</td>' : '') + (g.birdie ? '<td>' + c.birdie + '</td><td>' + c.eagle + '</td>' : '') + '<td class="' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '">' + signedWon(m) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  function tabSettle(r, all) {
    var s = all.settlement;
    var gameNames = { stroke: '스트로크', skins: '스킨스', match: '매치', nassau: '나소', bestball: '베스트볼', vegas: '라스베가스', bonus: '보너스' };
    var html = '<div class="card"><h2>개인별 손익</h2><table><thead><tr><th class="l">플레이어</th><th>손익</th><th class="l">내역</th></tr></thead><tbody>';
    s.rows.forEach(function (p) {
      var parts = Object.keys(p.byGame).filter(function (k) { return Math.round(p.byGame[k]) !== 0; }).map(function (k) { return gameNames[k] + ' ' + signedWon(p.byGame[k]); });
      html += '<tr><td class="l">' + badge((G.playerById(r, p.id) || {}).team) + ' ' + esc(p.name) + '</td><td class="' + (p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : '') + '" style="font-size:16px">' + signedWon(p.net) + '</td><td class="l small muted" style="white-space:normal">' + esc(parts.join(', ')) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="card"><h2>송금 정리 <span class="hint">최소 횟수로 정산</span></h2>' +
      (s.payments.length ? s.payments.map(function (p) { return '<div class="payline"><span><b>' + esc(nameOf(r, p.from)) + '</b> → <b>' + esc(nameOf(r, p.to)) + '</b></span><span class="amt">' + won(p.amount) + '</span></div>'; }).join('') : '<div class="muted">정산할 금액이 없습니다.</div>') +
      '</div>';
    if (!state.readOnly && holesDone(r) < r.holes) html += '<div class="notice">아직 ' + (r.holes - holesDone(r)) + '홀이 남았어요. 매치/나소 금액은 매치가 끝나야 확정됩니다.</div>';
    if (!state.readOnly) html += '<button class="btn block" data-action="share">결과 복사 / 공유</button>';
    return html;
  }

  function nameOf(r, pid) { var p = G.playerById(r, pid); return p ? p.name : pid; }
  function holeHeaders(r, withPar) {
    var out = '';
    for (var i = 0; i < r.holes; i++) { out += '<th>' + (i + 1) + '</th>'; if (i === 8 && r.holes === 18) out += '<th class="sum">OUT</th>'; }
    return out;
  }
  function sumRange(arr, a, b) { var s = 0; for (var i = a; i < b; i++) if (arr[i] !== null) s += arr[i]; return s; }

  // ───────────────────────── 스코어카드 ─────────────────────────
  function viewCard() {
    var r = getRound();
    if (!r) { state.view = 'home'; return viewHome(); }
    var res = G.strokePlay(r, {});
    var rows = r.players.map(function (p) { return res.rows.filter(function (x) { return x.id === p.id; })[0]; });
    var html = topbar(r.name, '스코어카드', backBtn('home'), '');
    html += '<div class="screen"><div class="card"><div class="tablewrap"><table class="scorecard"><thead><tr><th>홀</th>';
    for (var i = 0; i < r.holes; i++) { html += '<th>' + (i + 1) + '</th>'; if (i === 8 && r.holes === 18) html += '<th class="sum">OUT</th>'; }
    html += (r.holes === 18 ? '<th class="sum">IN</th>' : '') + '<th class="sum">TOT</th><th class="sum">±</th>' + (r.players.some(function (p) { return p.hcp; }) ? '<th class="sum">NET</th>' : '') + '</tr></thead><tbody>';
    // par row
    html += '<tr><td>파</td>';
    for (i = 0; i < r.holes; i++) { html += '<td>' + r.pars[i] + '</td>'; if (i === 8 && r.holes === 18) html += '<td class="sum">' + sumRange(r.pars, 0, 9) + '</td>'; }
    html += (r.holes === 18 ? '<td class="sum">' + sumRange(r.pars, 9, 18) + '</td>' : '') + '<td class="sum">' + sumRange(r.pars, 0, r.holes) + '</td><td class="sum"></td>' + (r.players.some(function (p) { return p.hcp; }) ? '<td class="sum"></td>' : '') + '</tr>';
    html += '<tr><td class="muted small">HCP</td>';
    for (i = 0; i < r.holes; i++) { html += '<td class="muted small">' + r.strokeIndex[i] + '</td>'; if (i === 8 && r.holes === 18) html += '<td class="sum"></td>'; }
    html += (r.holes === 18 ? '<td class="sum"></td>' : '') + '<td class="sum"></td><td class="sum"></td>' + (r.players.some(function (p) { return p.hcp; }) ? '<td class="sum"></td>' : '') + '</tr>';
    rows.forEach(function (p) {
      html += '<tr><td>' + badge(p.team) + ' ' + esc(p.name) + '</td>';
      for (var i = 0; i < r.holes; i++) {
        var s = p.holes[i];
        var cls = '';
        if (s !== null) { var d = s - r.pars[i]; cls = d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'dbl' : ''; }
        html += '<td>' + (s === null ? '' : '<span class="sc ' + cls + '">' + s + '</span>') + '</td>';
        if (i === 8 && r.holes === 18) html += '<td class="sum">' + (sumRange(p.holes, 0, 9) || '') + '</td>';
      }
      html += (r.holes === 18 ? '<td class="sum">' + (sumRange(p.holes, 9, 18) || '') + '</td>' : '') + '<td class="sum">' + (p.gross || '') + '</td><td class="sum ' + tpClass(p.toPar) + '">' + (p.played ? G.fmtToPar(p.toPar) : '') + '</td>' +
        (r.players.some(function (x) { return x.hcp; }) ? '<td class="sum">' + (p.played ? p.net : '') + '</td>' : '') + '</tr>';
    });
    html += '</tbody></table></div><div class="muted small" style="margin-top:8px">○ 버디 &nbsp;◎ 이글 이상 &nbsp;□ 보기 &nbsp;▣ 더블보기 이상</div></div>';
    html += '<button class="btn block" data-action="share">결과 복사 / 공유</button>';
    html += '</div>' + bottomNav('card');
    return html;
  }

  // ───────────────────────── 공유 텍스트 ─────────────────────────
  function shareText(r) {
    var all = G.computeAll(r);
    var lines = ['⛳ ' + r.name + ' (' + r.date + ')', ''];
    all.stroke.rows.forEach(function (p) { if (p.played) lines.push((p.rank || '-') + '위 ' + p.name + ': ' + p.gross + '타 (' + G.fmtToPar(p.toPar) + ')' + (p.hcp ? ' / 네트 ' + p.net : '')); });
    if (all.skins && !all.skins.error) lines.push('', '🎯 스킨스: ' + all.skins.entrants.map(function (e) { return e.name + ' ' + e.skins; }).join(', '));
    if (all.match && !all.match.error) { lines.push('', '⚔️ 매치:'); all.match.matches.forEach(function (m) { lines.push('  ' + m.a.name + ' vs ' + m.b.name + ' — ' + m.status.text + (m.status.leader ? ' (' + (m.status.leader === 'A' ? m.a.name : m.b.name) + ')' : '')); }); }
    if (all.vegas && !all.vegas.error) lines.push('', '🎰 라스베가스: ' + all.vegas.teams.map(function (t) { return t.name + ' ' + t.points + '점'; }).join(' vs '));
    if (all.bestball && !all.bestball.error) lines.push('', '👥 베스트볼: ' + all.bestball.teams.map(function (t) { return t.name + ' ' + t.total + '(' + G.fmtToPar(t.toPar) + ')'; }).join(' vs '));
    if (all.settlement.payments.length) {
      lines.push('', '💰 정산:');
      all.settlement.rows.forEach(function (p) { lines.push('  ' + p.name + ' ' + signedWon(p.net)); });
      lines.push('  송금:');
      all.settlement.payments.forEach(function (p) { lines.push('  ' + nameOf(r, p.from) + ' → ' + nameOf(r, p.to) + ' ' + won(p.amount)); });
    }
    return lines.join('\n');
  }

  function share() {
    var r = getRound(); if (!r) return;
    var text = shareText(r);
    if (navigator.share) { navigator.share({ title: r.name, text: text }).catch(function () { }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { alert('결과를 클립보드에 복사했어요.'); }, function () { prompt('복사하세요', text); });
    } else prompt('복사하세요', text);
  }

  // ───────────────────────── 렌더 & 이벤트 ─────────────────────────
  function render() {
    var views = { home: viewHome, setup: viewSetup, settings: viewSettings, play: viewPlay, board: viewBoard, card: viewCard };
    if (!views[state.view]) state.view = 'home';
    if ((state.view === 'play' || state.view === 'settings') && !state.round) state.view = 'home';
    if (state.view === 'setup' && !state.draft) state.draft = newDraft();
    var y = window.scrollY;
    $app.innerHTML = views[state.view]();
    window.scrollTo(0, y);
    var strip = $app.querySelector('.hole-strip'), cur = strip && strip.querySelector('.cur');
    if (cur) strip.scrollLeft = Math.max(0, cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2);
  }

  var actions = {
    go: function (d) {
      if (d.view === 'home') { state.readOnly = false; state.viewRoundId = null; }
      if (d.view === 'play' && state.readOnly) { state.readOnly = false; state.viewRoundId = null; }
      if (state.view === 'settings' && d.view === 'play') {
        var errs = validate(state.round);
        if (errs.length) { state.setupError = errs; save(); render(); return; }
        state.round.players.forEach(function (p) { if (!(p.name || '').trim()) p.name = '플레이어'; p.hcp = Math.max(0, Number(p.hcp) || 0); });
      }
      state.setupError = null;
      go(d.view);
    },
    'new-round': function () {
      if (state.round && !confirm('진행 중인 라운드가 있어요. 새 라운드를 시작하면 현재 라운드는 기록으로 저장됩니다. 계속할까요?')) return;
      if (state.round) archiveCurrent();
      var prev = state.history[0];
      state.draft = newDraft();
      if (prev) { // 지난 라운드 플레이어/게임 설정 재사용
        state.draft.players = prev.players.map(function (p) { return { id: uid(), name: p.name, hcp: p.hcp, team: p.team }; });
        state.draft.games = clone(prev.games);
        state.draft.holes = prev.holes;
      }
      state.setupError = null;
      go('setup');
    },
    'start-round': startRound,
    'add-player': function () { if (state.draft.players.length < 8) { state.draft.players.push(newPlayer()); save(); render(); } },
    'del-player': function (d) { if (state.draft.players.length > 2) { state.draft.players.splice(Number(d.i), 1); save(); render(); } },
    'auto-team': function (d) {
      var list = getPath(state, d.prefix + '.players');
      list.forEach(function (p, i) { p.team = i % 2 === 0 ? 'A' : 'B'; });
      save(); render();
    },
    'clear-team': function (d) { getPath(state, d.prefix + '.players').forEach(function (p) { p.team = ''; }); save(); render(); },
    set: function (d) {
      var v = d.type === 'number' ? Number(d.value) : d.value;
      if (d.path === 'boardNet') v = d.value === 'true';
      setPath(state, d.path, v); save(); render();
    },
    tab: function (d) { state.boardTab = d.tab; save(); render(); },
    hole: function (d) { var i = Number(d.i); if (i >= 0 && i < state.round.holes) { state.round.currentHole = i; save(); render(); } },
    score: function (d) {
      var r = state.round, h = r.currentHole, cur = r.scores[d.pid][h], delta = Number(d.delta);
      var v = cur === null || cur === undefined ? r.pars[h] + delta : cur + delta;
      r.scores[d.pid][h] = Math.min(15, Math.max(1, v));
      save(); render();
    },
    'score-tap': function (d) {
      var r = state.round, h = r.currentHole;
      if (r.scores[d.pid][h] === null || r.scores[d.pid][h] === undefined) { r.scores[d.pid][h] = r.pars[h]; save(); render(); }
    },
    'score-clear': function (d, el, ev) { ev.stopPropagation(); var r = state.round; r.scores[d.pid][r.currentHole] = null; save(); render(); },
    'par-all': function () { var r = state.round, h = r.currentHole; r.players.forEach(function (p) { if (r.scores[p.id][h] === null) r.scores[p.id][h] = r.pars[h]; }); save(); render(); },
    'clear-hole': function () { var r = state.round, h = r.currentHole; r.players.forEach(function (p) { r.scores[p.id][h] = null; }); if (r.extras) delete r.extras[h]; save(); render(); },
    extra: function (d) {
      var r = state.round, h = r.currentHole;
      r.extras = r.extras || {}; r.extras[h] = r.extras[h] || {};
      r.extras[h][d.type] = r.extras[h][d.type] === d.pid ? null : d.pid;
      save(); render();
    },
    finish: function () {
      var r = state.round; if (!r) return;
      var left = r.holes - holesDone(r);
      if (!confirm(left ? '아직 ' + left + '홀이 미입력이에요. 라운드를 종료하고 기록으로 저장할까요?' : '라운드를 종료하고 기록으로 저장할까요?')) return;
      archiveCurrent();
      state.readOnly = true; state.viewRoundId = state.history[0].id; state.boardTab = 'settle';
      go('board');
    },
    discard: function () { if (confirm('진행 중인 라운드를 삭제할까요? 복구할 수 없어요.')) { state.round = null; go('home'); } },
    'view-history': function (d) { state.readOnly = true; state.viewRoundId = d.id; state.boardTab = 'stroke'; go('board'); },
    'del-history': function (d) { if (confirm('이 기록을 삭제할까요?')) { state.history = state.history.filter(function (h) { return h.id !== d.id; }); save(); render(); } },
    share: share
  };

  function archiveCurrent() {
    var r = state.round; if (!r) return;
    r.finishedAt = Date.now();
    state.history.unshift(r);
    if (state.history.length > 50) state.history.length = 50;
    state.round = null;
    save();
  }

  $app.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-action]');
    if (!el || !$app.contains(el)) return;
    var fn = actions[el.dataset.action];
    if (fn) fn(el.dataset, el, ev);
  });

  function bindInput(el, rerender) {
    var path = el.dataset.bind; if (!path) return;
    var v;
    if (el.dataset.type === 'bool') v = el.checked;
    else if (el.dataset.type === 'number') { v = el.value === '' ? 0 : Number(el.value); if (isNaN(v)) v = 0; }
    else v = el.value;
    if (path.indexOf('.pars.') > 0) v = Math.min(6, Math.max(3, v || 4));
    if (path.indexOf('.strokeIndex.') > 0) { var r = state.round; v = Math.min(r.holes, Math.max(1, v || 1)); }
    setPath(state, path, v);
    save();
    if (rerender) render();
  }
  $app.addEventListener('input', function (ev) {
    var el = ev.target; if (!el.dataset || !el.dataset.bind) return;
    if (el.type === 'checkbox' || el.tagName === 'SELECT') return; // change 이벤트에서 처리
    bindInput(el, false);
  });
  $app.addEventListener('change', function (ev) {
    var el = ev.target; if (!el.dataset || !el.dataset.bind) return;
    // 숫자/텍스트 입력은 blur 시점에 change가 발생하므로 재렌더하면 다음 탭이 유실됨 → 체크박스/셀렉트만 재렌더
    bindInput(el, el.type === 'checkbox' || el.tagName === 'SELECT');
  });

  render();
})();
