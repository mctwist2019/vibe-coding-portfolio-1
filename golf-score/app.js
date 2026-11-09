/* app.js — 골프 스코어 앱 UI (vanilla JS, 상태는 localStorage에 저장, 실시간 공유는 sync.js) */
(function () {
  'use strict';
  var G = window.GolfGames;
  var S = window.GolfSync;
  var KEY = 'golfscore.v1';
  var TEAMS = ['A', 'B', 'C', 'D'];
  var GAME_NAMES = { stroke: '스트로크', stableford: '스테이블포드', skins: '스킨스', match: '매치', nassau: '나소', bestball: '베스트볼', vegas: '라스베가스', bonus: '보너스' };
  var $app = document.getElementById('app');
  var UA = navigator.userAgent || '';
  var IN_APP = /KAKAOTALK|Instagram|FBAN|FBAV|Line\//i.test(UA);
  var IS_ANDROID = /Android/i.test(UA);

  // ───────────────────────── 유틸 ─────────────────────────
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function uid() { return S.randomId(8); }
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
      stableford: { enabled: true, net: true },
      skins: { enabled: false, net: false, mode: 'individual', unit: 1000 },
      match: { enabled: false, net: false, mode: 'individual', unit: 1000 },
      nassau: { enabled: false, net: false, mode: 'individual', unit: 5000 },
      bestball: { enabled: false, net: false, count: 1, unit: 1000 },
      vegas: { enabled: false, net: false, unit: 100 },
      bonus: { nearest: false, longest: false, birdie: false, unit: 1000 }
    };
  }
  function fillGames(g) { var d = defaultGames(); Object.keys(d).forEach(function (k) { g[k] = Object.assign(d[k], g[k] || {}); }); return g; }
  function newPlayer() { return { id: uid(), name: '', hcp: 0, team: '' }; }
  function newDraft() {
    return { name: '', date: today(), holes: 18, players: [newPlayer(), newPlayer(), newPlayer(), newPlayer()], games: defaultGames() };
  }
  var DEFAULTS = { pars: G.defaultPars, strokeIndex: G.defaultStrokeIndex, games: defaultGames };

  // ───────────────────────── 상태 ─────────────────────────
  var state = load();
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY)); } catch (e) { s = null; }
    if (!s || !Array.isArray(s.history)) s = { view: 'home', round: null, history: [], draft: null, boardTab: 'stroke', boardNet: false, readOnly: false, viewRoundId: null };
    s.settings = s.settings || { broker: '' };
    if (!s.clientId || s.clientId.length < 8) s.clientId = S.randomId(10);
    s.me = s.me || null;
    s.meSkipped = s.meSkipped || {};
    if (s.round) { fillGames(s.round.games = s.round.games || {}); s.round.status = s.round.status || 'live'; s.round.rev = s.round.rev || {}; S.ensureScores(s.round); }
    s.joining = null;
    return s;
  }
  var TAB_ID = (function () { try { var t = sessionStorage.getItem('gs.tab'); if (!t) { t = S.randomId(4); sessionStorage.setItem('gs.tab', t); } return t; } catch (e) { return S.randomId(4); } })();

  function getRound() {
    if (state.readOnly) { for (var i = 0; i < state.history.length; i++) if (state.history[i].id === state.viewRoundId) return state.history[i]; return null; }
    return state.round;
  }
  function findRoundByCode(code) {
    var r = state.round;
    if (r && r.share && r.share.code === code) return r;
    for (var i = 0; i < state.history.length; i++) { var h = state.history[i]; if (h.share && h.share.code === code) return h; }
    return null;
  }
  function go(view) { state.view = view; save(); render(); window.scrollTo(0, 0); }
  function holesDone(r) {
    var n = 0;
    for (var h = 0; h < r.holes; h++) if (r.players.every(function (p) { return G.gross(r, p.id, h) !== null; })) n++;
    return n;
  }
  function firstOpenHole(r) {
    for (var h = 0; h < r.holes; h++) if (r.players.some(function (p) { return G.gross(r, p.id, h) === null; })) return h;
    return r.holes - 1;
  }
  function nameOf(r, pid) { var p = G.playerById(r, pid); return p ? p.name : pid; }
  function myPid() { var r = getRound(); return r && state.me && state.me.roundId === r.id ? state.me.pid : null; }
  function myName() { var r = state.round, pid = r ? myPid() : null, p = pid ? G.playerById(r, pid) : null; return p ? p.name : '참여자'; }

  // ───────────────────────── 실시간 공유: 상태 동기화 (저장 시 변경 감지) ─────────────────────────
  var clock = S.createClock();
  clock.observe(state.hlc || 0);
  if (state.round) clock.observe(S.maxRevTs(state.round));
  var baseline = null, baselineRid = null;
  function resetBaseline() { var r = state.round; if (r) { baseline = S.project(r); baselineRid = r.id; } else { baseline = null; baselineRid = null; } }
  /** 저장 직전에 라운드 투영을 비교해 바뀐 키에 rev를 찍고(공유 중이면) 전송 예약 */
  function syncRound() {
    var r = state.round;
    if (!r) { baseline = null; baselineRid = null; return; }
    if (!baseline || baselineRid !== r.id) { resetBaseline(); return; }
    var d = S.diffAndStamp(r, baseline, clock, state.clientId);
    baseline = d.projection;
    if (d.changed.length && session && sharingActive()) session.markDirty(d.changed);
  }
  function save() {
    syncRound();
    state.hlc = clock.peek();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  resetBaseline();

  // ───────────────────────── 실시간 공유: 세션 관리 ─────────────────────────
  var session = null, sessionSeq = 0, syncStatus = 'idle', syncReady = false, peers = [], skewMs = 0, fgAt = 0, graceTimer = null;
  var joinTimer = null, renderPending = false, scan = null;

  function sharingActive() { var r = state.round; return !!(r && r.share && r.share.active && r.share.code); }
  function isHost() { var r = state.round; return !!(r && r.share && r.share.host === state.clientId); }
  function brokerList() { var b = state.settings && state.settings.broker; return b ? [b] : S.BROKERS; }
  function shareLink(code, b) { return location.origin + location.pathname + '#join=' + code + (b ? '&b=' + b : ''); }

  function loadMqtt() {
    if (window.mqtt) return Promise.resolve(window.mqtt);
    if (loadMqtt.p) return loadMqtt.p;
    loadMqtt.p = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = 'vendor/mqtt.min.js'; s.async = true;
      s.onload = function () { if (window.mqtt) resolve(window.mqtt); else { loadMqtt.p = null; reject(new Error('mqtt missing')); } };
      s.onerror = function () { loadMqtt.p = null; reject(new Error('mqtt load failed')); };
      document.head.appendChild(s);
    });
    return loadMqtt.p;
  }

  /** 입력 중이면 재렌더를 미뤄 포커스를 잃지 않게 함 */
  function softRender() {
    var a = document.activeElement;
    if (a && $app.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) { renderPending = true; return; }
    render();
  }
  $app.addEventListener('focusout', function () {
    if (!renderPending) return;
    setTimeout(function () {
      var a = document.activeElement;
      if (a && $app.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
      renderPending = false; render();
    }, 200);
  });

  function openSession(code, brokerUrl, handlers) {
    closeSession();
    var token = ++sessionSeq;
    syncStatus = 'loading'; syncReady = false;
    if (!S.cryptoAvailable()) { syncStatus = 'nocrypto'; softRender(); if (scan) scanFailed('nocrypto'); return; }
    loadMqtt().then(function (mqttLib) {
      if (token !== sessionSeq) return; // 그 사이 다른 세션으로 교체됨
      session = S.createSession({
        mqtt: mqttLib, code: code, broker: brokerUrl, clientId: state.clientId, tabId: TAB_ID, name: myName(), clock: clock,
        getRound: function () { return findRoundByCode(code); },
        onApply: function (changed) { onRemoteApply(code, changed); },
        onSnapshot: handlers && handlers.onSnapshot,
        onStatus: function (s, detail) { onSessionStatus(code, s, detail); },
        onPeers: function (list) { peers = list; softRender(); },
        onReady: function () { syncReady = true; softRender(); },
        onError: function (e) { if (window.console) console.warn('[sync]', e && e.message ? e.message : e); },
        onConflict: function () { state.syncConflict = true; softRender(); },
        onSkew: function (ms) { skewMs = ms; }
      });
      session.start();
    }).catch(function () {
      if (token !== sessionSeq) return;
      syncStatus = 'nolib'; softRender();
      if (scan) scanFailed('nolib');
    });
  }
  function closeSession() {
    sessionSeq++;
    clearTimeout(graceTimer);
    if (session) { try { session.stop(); } catch (e) { /* ignore */ } session = null; }
    syncStatus = 'idle'; syncReady = false; peers = [];
  }
  function onSessionStatus(code, s) {
    syncStatus = s;
    if (s === 'connected') fgAt = 0;
    if (scan && scan.code === code) {
      if (s === 'connected') {
        clearTimeout(scan.timer);
        if (scan.mode === 'host') {
          var r = state.round; if (r && r.share) r.share.broker = scan.idx;
          scan = null; save();
        } else {
          scan.timer = setTimeout(function () { nextBroker('nosnapshot'); }, 7000);
        }
      } else if (s === 'error') { nextBroker('noconnect'); }
    }
    if (state.joining && state.joining.code === code && state.joining.status !== 'timeout' && state.joining.status !== 'noconnect') {
      state.joining.status = s === 'connected' ? 'waiting' : s === 'loading' ? 'loading' : 'connecting';
    }
    softRender();
  }
  function onRemoteApply(code, changed) {
    var r = findRoundByCode(code);
    if (r === state.round) {
      resetBaseline();
      if (changed.indexOf('status') >= 0 && r.status === 'closed' && !isHost()) {
        closeSession(); r.share.active = false; r.status = 'live'; resetBaseline();
        toast('호스트가 공유를 종료했어요. 점수는 내 기기에 남아요.');
      } else if (changed.indexOf('status') >= 0 && r.status === 'finished') {
        toast('라운드가 종료되었어요. 정산을 확인하세요.');
      }
    }
    save(); softRender();
  }
  function ensureSession() {
    if (sharingActive()) {
      if (!session && !scan) { var r = state.round; openSession(r.share.code, brokerList()[Math.min(r.share.broker || 0, brokerList().length - 1)]); }
    } else closeSession();
  }

  // 브로커 스캔: 순서대로 연결을 시도하고 성공한 브로커를 방에 고정
  function beginScan(code, mode, startIdx, handlers) {
    var list = brokerList();
    scan = { code: code, mode: mode, idx: Math.min(Math.max(0, startIdx || 0), list.length - 1), list: list, tried: 0, handlers: handlers || null };
    tryBroker();
  }
  function tryBroker() {
    if (!scan) return;
    var s = scan;
    openSession(s.code, s.list[s.idx], s.handlers);
    clearTimeout(s.timer);
    s.timer = setTimeout(function () { nextBroker('noconnect'); }, 9000);
    softRender();
  }
  function nextBroker(reason) {
    if (!scan) return;
    scan.tried++;
    scan.lastReason = reason;
    if (scan.tried >= scan.list.length) { scanFailed(reason); return; }
    scan.idx = (scan.idx + 1) % scan.list.length;
    tryBroker();
  }
  function scanFailed(reason) {
    var s = scan; scan = null; closeSession();
    if (s && s.mode === 'join') { if (state.joining) state.joining.status = reason === 'nosnapshot' ? 'timeout' : reason === 'nolib' || reason === 'nocrypto' ? reason : 'noconnect'; }
    else syncStatus = reason === 'nolib' || reason === 'nocrypto' ? reason : 'failed';
    render();
  }

  function startSharing() {
    var r = state.round; if (!r) return;
    if (!S.cryptoAvailable()) { alert('이 환경에서는 실시간 공유를 사용할 수 없어요. HTTPS 주소(GitHub Pages 등)로 열어 주세요.'); return; }
    r.share = { code: S.randomCode(), host: state.clientId, active: true, broker: 0 };
    r.status = 'live';
    S.stampAll(r, r.createdAt || (Date.now() - 1), state.clientId);
    resetBaseline(); save();
    beginScan(r.share.code, 'host', 0);
    go('share');
  }
  function retrySharing() {
    var r = state.round; if (!r || !r.share) return;
    r.share.active = true; save();
    beginScan(r.share.code, 'host', r.share.broker || 0);
  }
  function stopSharing() {
    var r = state.round;
    scan = null; closeSession();
    if (r && r.share) r.share.active = false;
    save(); render();
  }
  function endSharingOnServer() {
    var r = state.round; if (!r || !session) { stopSharing(); return; }
    r.status = 'closed'; save();
    var s = session;
    s.flush().then(function () { return s.clearRetained(); }).then(function () {
      r.status = 'live'; stopSharing(); toast('서버의 공유 데이터를 삭제했어요');
    }, function () { r.status = 'live'; stopSharing(); });
  }
  function joinRoom(code, b) {
    code = S.normalizeCode(code);
    if (!S.isValidCode(code)) { alert('코드는 영문/숫자 8자리예요. (예: ABCD-EFGH)'); return; }
    if (!S.cryptoAvailable()) { alert('이 환경에서는 실시간 공유를 사용할 수 없어요. HTTPS 주소로 열어 주세요.'); return; }
    var cur = state.round;
    if (cur && cur.share && cur.share.code === code) { cur.share.active = true; save(); ensureSession(); go('play'); return; }
    if (cur) {
      if (holesDone(cur) === 0 && !sharingActive()) { closeSession(); state.round = null; resetBaseline(); }
      else {
        if (!confirm('진행 중인 라운드(' + (cur.name || '라운드') + ', ' + holesDone(cur) + '/' + cur.holes + '홀)가 있어요.\n참여하면 이 라운드는 지난 라운드에 저장되고 공유 라운드로 바뀝니다.')) return;
        closeSession(); archiveCurrent();
      }
    }
    state.readOnly = false; state.viewRoundId = null;
    state.joining = { code: code, status: 'connecting', b: Number(b) || 0 };
    beginScan(code, 'join', Number(b) || 0, { onSnapshot: function (keys) { adoptSnapshot(code, keys); } });
    go('joining');
  }
  function adoptSnapshot(code, keys) {
    if (!state.joining || state.joining.code !== code) return;
    var r = S.roundFromSnapshot(keys, DEFAULTS);
    if (!r) return;
    fillGames(r.games);
    var idx = scan ? scan.idx : 0;
    if (scan) { clearTimeout(scan.timer); scan = null; }
    r.share = { code: code, host: r.share && r.share.host, active: true, broker: idx };
    // 기록에 같은 라운드가 있으면 로컬 기록과 병합 (더 새로운 값 유지) 후 기록에서 제거
    var dup = null;
    state.history = state.history.filter(function (h) { if (h.id === r.id) { dup = h; return false; } return true; });
    if (dup) S.merge(r, S.exportKeys(dup));
    state.joining = null;
    if (r.status === 'finished') {
      r.finishedAt = r.finishedAt || Date.now(); r.share.active = false;
      closeSession();
      state.history.unshift(r); state.readOnly = true; state.viewRoundId = r.id; state.boardTab = 'settle';
      save(); go('board'); toast('이미 종료된 라운드예요. 결과를 보여드릴게요.');
      return;
    }
    r.currentHole = firstOpenHole(r);
    state.round = r; state.boardTab = 'stroke'; state.me = null;
    resetBaseline();
    if (session) session.setName(myName());
    save(); go('play');
  }
  function cancelJoin() { scan = null; closeSession(); state.joining = null; go('home'); }

  function statusLabel() {
    if (syncStatus === 'connected') return peers.length ? '실시간 연결됨 · 함께 보는 중 ' + (peers.length + 1) + '명' : '실시간 연결됨 · 아직 상대 없음';
    if (syncStatus === 'connecting' || syncStatus === 'loading' || (syncStatus === 'offline' && Date.now() - fgAt < 5000)) return '연결 중…';
    if (syncStatus === 'offline') return '오프라인 — 입력은 저장되고 연결되면 자동으로 맞춰져요';
    if (syncStatus === 'failed') return '연결 실패 — 다시 시도해 주세요';
    if (syncStatus === 'nolib') return '공유 모듈을 불러오지 못했어요 (인터넷 연결 후 새로고침)';
    if (syncStatus === 'nocrypto') return '이 환경에서는 공유를 사용할 수 없어요 (HTTPS 필요)';
    return '대기';
  }
  function statusPill(forView) {
    if (!sharingActive()) {
      return (forView === 'play' && !state.readOnly) ? '<button class="iconbtn" data-action="go" data-view="share">👥 함께</button>' : '';
    }
    var cls, label;
    if (syncStatus === 'connected') { cls = 'connected'; label = '● ' + (peers.length + 1) + '명'; }
    else if (syncStatus === 'connecting' || syncStatus === 'loading' || (syncStatus === 'offline' && Date.now() - fgAt < 5000)) { cls = 'connecting'; label = '○ 연결 중'; }
    else if (syncStatus === 'failed' || syncStatus === 'nolib' || syncStatus === 'nocrypto') { cls = 'offline'; label = '! 연결 실패'; }
    else { cls = 'offline'; label = '✕ 오프라인'; }
    return '<button class="iconbtn pill ' + cls + '" data-action="go" data-view="share" title="' + esc(statusLabel()) + '">' + label + '</button>';
  }
  function finishedBanner(r) {
    if (!r || r.status !== 'finished' || state.readOnly) return '';
    return '<div class="notice"><b>라운드가 종료되었습니다.</b> 함께하는 참여자가 라운드 종료를 눌렀어요. 정산을 확인하고 기록으로 저장하세요. ' +
      '<div class="row" style="margin-top:8px"><button class="btn sm primary" data-action="archive-now">기록으로 저장</button><button class="btn sm" data-action="tab-settle">정산 보기</button></div></div>';
  }
  function inAppBanner(code, b) {
    if (!IN_APP) return '';
    var link = shareLink(code, b);
    return '<div class="notice"><b>메신저 안의 브라우저에서 열렸어요.</b> 여기서도 참여할 수 있지만, 홈 화면에 추가한 앱에서 쓰려면 앱을 열고 코드 <b>' + esc(S.formatCode(code)) + '</b>를 입력하세요.' +
      '<div class="row" style="margin-top:8px;flex-wrap:wrap"><button class="btn sm" data-action="copy" data-text="' + esc(code) + '">코드 복사</button>' +
      (IS_ANDROID ? '<a class="btn sm" href="kakaotalk://web/openExternal?url=' + encodeURIComponent(link) + '">외부 브라우저로 열기</a>' : '') + '</div></div>';
  }
  function meChooser(r) {
    if (!sharingActive() || myPid() || state.meSkipped[r.id]) return '';
    return '<div class="card"><h2>누구로 참여하세요? <span class="hint">내 줄이 강조돼요</span></h2><div class="chips">' + r.players.map(function (p) {
      return '<button class="chip" data-action="set-me" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>';
    }).join('') + '<button class="chip" data-action="skip-me" style="border-style:dashed">건너뛰기</button></div></div>';
  }

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
  function numField(path, value, suffix, step, disabled) {
    return '<span class="inline-num"><input type="number" inputmode="numeric" min="0" step="' + (step || 100) + '" data-bind="' + path + '" data-type="number" value="' + esc(value) + '" ' + (disabled ? 'disabled' : '') + '><span class="small muted">' + esc(suffix || '') + '</span></span>';
  }
  function bottomNav(active) {
    var items = [['play', '✏️', '스코어 입력'], ['board', '🏆', '리더보드'], ['card', '📋', '스코어카드']];
    if (state.readOnly) items = items.slice(1);
    return '<nav class="bottomnav"><div class="inner">' + items.map(function (it) {
      return '<button data-action="go" data-view="' + it[0] + '" class="' + (active === it[0] ? 'active' : '') + '"><span class="ic">' + it[1] + '</span>' + it[2] + '</button>';
    }).join('') + '</div></nav>';
  }
  function moneyChip(key, enabled) {
    if (state.readOnly) return '<span class="chip sm ' + (enabled ? 'active' : '') + '">' + (enabled ? '₩ 정산 포함' : '정산 제외') + '</span>';
    return '<button class="chip sm ' + (enabled ? 'active' : '') + '" data-action="toggle-money" data-key="' + key + '" title="이 게임의 금액을 정산에 포함">' + (enabled ? '₩ 정산 포함' : '정산 제외') + '</button>';
  }
  function teamHint(msg) {
    return '<div class="card"><div class="notice">' + esc(msg) + (state.readOnly ? '' : ' <button class="btn sm" data-action="go" data-view="settings" style="margin-left:6px">설정에서 팀 지정</button>') + '</div></div>';
  }

  // ───────────────────────── 홈 ─────────────────────────
  function viewHome() {
    var r = state.round;
    var html = topbar('골프 스코어', '', '', '');
    html += '<div class="screen">';
    html += '<div class="hero"><div class="logo">⛳</div><h1>골프 스코어 & 게임</h1><p>개인 스코어 하나로 팀 대항 내기까지 자동 계산 · 동반자와 실시간 공유</p></div>';
    if (r) {
      var done = holesDone(r);
      html += '<div class="card"><h2>진행 중인 라운드 <span class="hint">' + esc(r.date) + '</span></h2>' +
        '<div style="font-size:18px;font-weight:800">' + esc(r.name || '라운드') + (sharingActive() ? ' <span class="chip sm active">함께 ' + esc(S.formatCode(r.share.code)) + '</span>' : '') + '</div>' +
        '<div class="muted small">' + r.players.map(function (p) { return esc(p.name); }).join(', ') + ' · ' + done + '/' + r.holes + '홀 입력</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn primary grow" data-action="go" data-view="play">이어하기</button><button class="btn grow" data-action="go" data-view="board">리더보드</button></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn sm grow" data-action="go" data-view="share">👥 ' + (sharingActive() ? '함께 입력 중' : '함께 입력') + '</button><button class="btn sm ghost grow" data-action="finish">라운드 종료</button><button class="btn sm ghost danger" data-action="discard">삭제</button></div></div>';
    }
    html += '<button class="btn primary big block" data-action="new-round">＋ 새 라운드 시작</button>';
    html += '<div class="card"><h2>코드로 참여 <span class="hint">동반자에게 받은 8자리</span></h2>' +
      '<div class="row"><input type="text" id="join-code" class="code-input" placeholder="ABCD-EFGH" maxlength="10" autocapitalize="characters" autocomplete="off" spellcheck="false">' +
      '<button class="btn primary" data-action="join-code">참여</button></div>' +
      '<div class="muted small" style="margin-top:6px">링크로 받았다면 링크만 눌러도 바로 참여돼요.</div></div>';
    if (state.history.length) {
      html += '<div class="card"><h2>지난 라운드</h2>' + state.history.map(function (h) {
        var res = G.strokePlay(h, {});
        var w = res.rows[0];
        return '<div class="histrow"><div class="grow"><div class="t">' + esc(h.name || '라운드') + ' <span class="muted small">' + esc(h.date) + '</span></div>' +
          '<div class="s">' + h.players.length + '명 · ' + h.holes + '홀' + (w && w.played ? ' · 1위 ' + esc(w.name) + ' (' + w.gross + ', ' + G.fmtToPar(w.toPar) + ')' : '') + '</div></div>' +
          '<button class="btn sm" data-action="view-history" data-id="' + esc(h.id) + '">보기</button>' +
          '<button class="btn sm ghost danger" data-action="del-history" data-id="' + esc(h.id) + '">삭제</button></div>';
      }).join('') + '</div>';
    }
    html += '<footer class="note">데이터는 이 기기 브라우저에 저장됩니다. 홈 화면에 추가하면 앱처럼 사용할 수 있어요.</footer>';
    html += '</div>';
    return html;
  }

  // ───────────────────────── 참여 중 화면 ─────────────────────────
  function viewJoining() {
    var j = state.joining;
    if (!j) { state.view = 'home'; return viewHome(); }
    var scanInfo = scan ? ' (서버 ' + (scan.tried + 1) + '/' + scan.list.length + ')' : '';
    var msg = {
      loading: '공유 모듈을 불러오는 중…', connecting: '중계 서버에 연결하는 중…' + scanInfo, waiting: '라운드 정보를 받고 있어요…' + scanInfo,
      offline: '네트워크가 불안정해요. 다시 연결 중…', timeout: '라운드를 찾을 수 없어요.', noconnect: '중계 서버에 연결할 수 없어요.',
      nolib: '공유 모듈을 불러오지 못했어요.', nocrypto: '이 환경에서는 공유를 사용할 수 없어요 (HTTPS 필요).', error: '연결에 실패했어요.'
    }[j.status] || '연결 중…';
    var failed = ['timeout', 'noconnect', 'nolib', 'nocrypto', 'error'].indexOf(j.status) >= 0;
    var hint = j.status === 'timeout' ? '코드가 맞는지 확인하고, 공유한 사람의 앱 화면이 켜져 있어야 해요. (몇 초 뒤 다시 시도해도 좋아요)'
      : j.status === 'noconnect' ? '모바일 데이터 연결을 확인해 주세요. 일부 와이파이는 중계 서버 포트를 막기도 해요.' : '';
    var html = topbar('함께 입력 참여', '', '', '');
    html += '<div class="screen">' + inAppBanner(j.code, j.b) + '<div class="card center" style="padding:28px 16px">' +
      '<div class="code-big">' + esc(S.formatCode(j.code)) + '</div>' +
      (failed ? '' : '<div class="spinner"></div>') +
      '<div style="margin-top:10px;font-weight:600">' + esc(msg) + '</div>' +
      (hint ? '<div class="muted small" style="margin-top:6px">' + esc(hint) + '</div>' : '') +
      '<div class="row" style="margin-top:18px;justify-content:center">' +
      (failed ? '<button class="btn primary" data-action="retry-join">다시 시도</button>' : '') +
      '<button class="btn" data-action="cancel-join">취소</button></div></div></div>';
    return html;
  }

  // ───────────────────────── 공유 화면 ─────────────────────────
  function viewShare() {
    var r = state.round;
    if (!r) { state.view = 'home'; return viewHome(); }
    var html = topbar('함께 입력 (실시간 공유)', '', backBtn('play', '입력'), '');
    html += '<div class="screen">';
    if (sharingActive()) {
      var code = r.share.code, link = shareLink(code, r.share.broker || 0);
      var preparing = !syncReady && (syncStatus === 'connecting' || syncStatus === 'loading' || syncStatus === 'connected' || !!scan);
      var failed = syncStatus === 'failed' || syncStatus === 'nolib' || syncStatus === 'nocrypto';
      html += '<div class="card center"><div class="muted small">방 코드</div><div class="code-big">' + esc(S.formatCode(code)) + '</div>';
      if (failed) {
        html += '<div class="error" style="margin-top:8px;text-align:left">' + esc(statusLabel()) + '<div class="row" style="margin-top:8px"><button class="btn sm primary" data-action="retry-sharing">다시 연결</button><button class="btn sm" data-action="reshare-new-code">새 코드로 다시 공유</button></div></div>';
      } else if (preparing && !syncReady) {
        html += '<div class="spinner"></div><div class="small muted" style="margin-top:8px">공유 준비 중…' + (scan ? ' (서버 ' + (scan.tried + 1) + '/' + scan.list.length + ')' : '') + '</div>';
      } else {
        html += '<div class="row" style="justify-content:center;margin-top:8px;flex-wrap:wrap"><button class="btn sm" data-action="copy" data-text="' + esc(S.formatCode(code)) + '">코드 복사</button>' +
          '<button class="btn sm" data-action="copy" data-text="' + esc(link) + '">링크 복사</button>' +
          (navigator.share ? '<button class="btn sm primary" data-action="share-link">카톡 등으로 보내기</button>' : '') + '</div>' +
          '<div class="muted small" style="margin-top:10px;word-break:break-all">' + esc(link) + '</div>';
      }
      html += '</div>';
      html += '<div class="card"><h2>연결 상태 <span class="hint ' + (syncStatus === 'connected' ? 'pos' : '') + '">' + esc(syncStatus === 'connected' ? '연결됨' : syncStatus === 'offline' ? '오프라인' : failed ? '실패' : '연결 중') + '</span></h2>' +
        '<div class="small">' + esc(statusLabel()) + '</div>' +
        '<div class="small muted" style="margin-top:4px">접속: <b>' + esc(myName()) + ' (나)</b>' + peers.map(function (p) { return ', ' + esc(p.name || '참여자'); }).join('') +
        (session && session.lastSyncAt() ? ' · 마지막 동기화 ' + Math.max(0, Math.round((Date.now() - session.lastSyncAt()) / 1000)) + '초 전' : '') + '</div>' +
        (state.syncConflict ? '<div class="error" style="margin-top:8px">이 코드로 다른 라운드가 공유되고 있어요. 호스트에게 새 코드를 받아 주세요.</div>' : '') +
        (skewMs > 60000 ? '<div class="error" style="margin-top:8px">이 기기의 시간이 다른 기기보다 ' + Math.round(skewMs / 1000) + '초 이상 느려요. 자동 시간 설정을 확인하면 입력 순서가 정확해져요.</div>' : '') +
        '</div>';
      html += '<div class="card"><h2>나는 누구? <span class="hint">내 줄을 강조 표시</span></h2><div class="chips">' + r.players.map(function (p) {
        return '<button class="chip ' + (myPid() === p.id ? 'active' : '') + '" data-action="set-me" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }).join('') + '</div></div>';
      html += '<div class="notice">같은 코드로 들어온 사람은 누구나 점수를 입력할 수 있어요. 각자 자기 점수를 넣으면 모두의 화면에 바로 반영되고, 잠시 연결이 끊겨도 다시 붙으면 자동으로 합쳐집니다.<br><span class="small">공개 중계 서버를 거쳐 암호화되어 전송돼요. 플레이어 이름·점수·금액이 공유되니 실명이나 연락처는 쓰지 마세요.</span></div>';
      html += inAppBanner(code, r.share.broker || 0);
      html += '<div class="stack"><button class="btn block" data-action="stop-sharing">' + (isHost() ? '공유 중지 (내 기기만 끊기)' : '공유에서 나가기 (내 기기만)') + '</button>' +
        (isHost() ? '<button class="btn block danger" data-action="end-sharing">공유 종료 (모두 끊고 서버에서 삭제)</button>' : '') + '</div>';
    } else {
      html += '<div class="card"><h2>👥 동반자와 함께 입력</h2><p class="small muted" style="margin:0 0 10px">이 라운드를 공유하면 8자리 코드가 만들어져요. 동반자가 코드나 링크로 들어오면 모두가 같은 스코어를 보고 각자 입력할 수 있어요.</p>' +
        '<button class="btn primary block" data-action="start-sharing">공유 시작</button></div>';
      html += '<div class="card"><h2>다른 라운드에 참여</h2><div class="row"><input type="text" id="join-code" class="code-input" placeholder="ABCD-EFGH" maxlength="10" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="btn" data-action="join-code">참여</button></div>' +
        '<div class="muted small" style="margin-top:6px">' + (holesDone(r) ? '참여하면 지금 라운드는 기록으로 저장돼요.' : '아직 입력한 홀이 없어 지금 라운드는 그냥 대체돼요.') + '</div></div>';
    }
    html += '<details class="card adv"><summary class="small muted">고급 설정</summary><div class="field" style="margin-top:8px"><label>중계 서버 주소 (비워두면 기본 공개 서버 사용 · 참여자 모두 같은 설정이어야 해요)</label>' +
      '<input type="text" data-bind="settings.broker" value="' + esc(state.settings.broker || '') + '" placeholder="wss://broker.emqx.io:8084/mqtt"></div>' +
      '<div class="muted small" style="margin-top:6px">기본 서버: ' + S.BROKERS.map(function (b) { return esc(S.parseBrokerUrl(b).host); }).join(', ') + '. 바꾼 주소는 다음 연결부터 적용됩니다.</div></details>';
    html += '</div>';
    return html;
  }

  // ───────────────────────── 설정(새 라운드 / 라운드 중 설정) ─────────────────────────
  function playersSection(prefix, players, editable) {
    var html = '<div class="card"><h2>플레이어 <span class="hint">2~8명 · 핸디는 18홀 기준</span></h2>';
    html += '<div class="prow phead"><span>이름</span><span class="center">핸디</span><span class="center">팀</span><span></span></div>';
    html += '<div class="stack" style="margin-top:4px">' + players.map(function (p, i) {
      return '<div class="prow">' +
        '<input type="text" placeholder="플레이어 ' + (i + 1) + '" data-bind="' + prefix + '.players.' + i + '.name" value="' + esc(p.name) + '" maxlength="20">' +
        '<input type="number" inputmode="numeric" min="0" max="54" data-bind="' + prefix + '.players.' + i + '.hcp" data-type="number" value="' + esc(p.hcp || 0) + '">' +
        '<select data-bind="' + prefix + '.players.' + i + '.team"><option value="">없음</option>' + TEAMS.map(function (t) { return '<option value="' + t + '" ' + (p.team === t ? 'selected' : '') + '>' + t + '팀</option>'; }).join('') + '</select>' +
        (editable ? '<button class="del" data-action="del-player" data-i="' + i + '" title="삭제" ' + (players.length <= 2 ? 'disabled' : '') + '>×</button>' : '<span></span>') +
        '</div>';
    }).join('') + '</div>';
    html += '<div class="row" style="margin-top:10px;flex-wrap:wrap">' +
      (editable ? '<button class="btn sm" data-action="add-player" ' + (players.length >= 8 ? 'disabled' : '') + '>＋ 플레이어 추가</button>' : '') +
      '<button class="btn sm" data-action="auto-team" data-prefix="' + prefix + '">팀 자동 배정 (2팀)</button>' +
      '<button class="btn sm ghost" data-action="clear-team" data-prefix="' + prefix + '">팀 해제</button></div>';
    html += '<div class="muted small" style="margin-top:8px">팀을 지정하면 스킨스(팀)·매치(팀)·베스트볼·라스베가스가 자동 계산돼요.</div>';
    html += '</div>';
    return html;
  }

  function gameCard(title, desc, enabledPath, enabled, body, noMoney) {
    return '<div class="card">' +
      (noMoney ? '<h2>' + title + '</h2>' : toggle(enabledPath, enabled, title + ' <span class="muted small" style="font-weight:500">정산 포함</span>')) +
      '<div class="desc" ' + (noMoney ? 'style="margin-left:0"' : '') + '>' + desc + '</div>' +
      (body ? '<div class="opts">' + body + '</div>' : '') + '</div>';
  }

  function gamesSection(prefix, g, holes) {
    var P = prefix + '.games.';
    var html = '<div class="notice">모든 게임은 입력한 개인 스코어로 <b>항상 자동 계산</b>돼요. 토글은 그 게임의 금액을 정산에 넣을지만 정합니다.</div>';
    html += '<div class="card"><h2>스트로크 플레이</h2><div class="desc" style="margin-left:0">총 타수 순위. 금액을 넣으면 타수 차 × 단가로 1:1 정산</div>' +
      '<div class="opts"><span class="lab">타당</span>' + numField(P + 'stroke.unit', g.stroke.unit, '원 (0이면 순위만)') +
      toggle(P + 'stroke.net', g.stroke.net, '네트(핸디 적용) 기준') + '</div></div>';
    html += gameCard('스테이블포드', '홀별 점수 합산: 버디 3 · 파 2 · 보기 1 · 이글 4 · 더블보기 이하 0 (순위만)', null, true,
      toggle(P + 'stableford.net', g.stableford.net, '네트(핸디 적용)'), true);
    html += gameCard('스킨스', '홀마다 단독 최저타가 스킨 획득. 동타면 다음 홀로 이월(캐리오버)', P + 'skins.enabled', g.skins.enabled,
      '<span class="lab">방식</span>' + seg(P + 'skins.mode', g.skins.mode, [['individual', '개인'], ['team', '팀(베스트볼)']]) +
      toggle(P + 'skins.net', g.skins.net, '네트') + '<span class="lab">스킨당</span>' + numField(P + 'skins.unit', g.skins.unit, '원', 100, !g.skins.enabled));
    html += gameCard('매치 플레이', '홀별 승패로 UP/DOWN. 개인은 전원 리그전, 팀은 2팀 베스트볼 대결. 홀 차 × 단가 정산', P + 'match.enabled', g.match.enabled,
      '<span class="lab">방식</span>' + seg(P + 'match.mode', g.match.mode, [['individual', '개인(리그)'], ['team', '팀(2팀)']]) +
      toggle(P + 'match.net', g.match.net, '네트') + '<span class="lab">홀당</span>' + numField(P + 'match.unit', g.match.unit, '원', 100, !g.match.enabled));
    if (holes === 18) html += gameCard('나소 (전반/후반/전체)', '18홀을 전반 9 · 후반 9 · 전체 18 세 판의 매치로 나눠 각각 정산', P + 'nassau.enabled', g.nassau.enabled,
      '<span class="lab">방식</span>' + seg(P + 'nassau.mode', g.nassau.mode, [['individual', '개인'], ['team', '팀(2팀)']]) +
      toggle(P + 'nassau.net', g.nassau.net, '네트') + '<span class="lab">판당</span>' + numField(P + 'nassau.unit', g.nassau.unit, '원', 100, !g.nassau.enabled));
    html += gameCard('베스트볼 (팀 대항)', '홀마다 팀원 중 좋은 점수(1개 또는 2개 합)로 팀 점수. 홀 승리마다 단가 정산', P + 'bestball.enabled', g.bestball.enabled,
      '<span class="lab">팀 점수</span>' + seg(P + 'bestball.count', g.bestball.count, [[1, '베스트 1'], [2, '베스트 2 합']]) +
      toggle(P + 'bestball.net', g.bestball.net, '네트') + '<span class="lab">홀 승리당</span>' + numField(P + 'bestball.unit', g.bestball.unit, '원', 100, !g.bestball.enabled));
    html += gameCard('라스베가스 (2:2)', '팀 두 명 점수를 낮은수·높은수 순으로 붙여 두 자리 수 비교(4·5 → 45). 상대팀 버디면 뒤집힘(54). 점수 차 × 단가', P + 'vegas.enabled', g.vegas.enabled,
      toggle(P + 'vegas.net', g.vegas.net, '네트') + '<span class="lab">점당</span>' + numField(P + 'vegas.unit', g.vegas.unit, '원', 100, !g.vegas.enabled));
    html += '<div class="card"><h2>보너스 <span class="hint">횟수는 항상 집계</span></h2><div class="stack">' +
      toggle(P + 'bonus.nearest', g.bonus.nearest, '니어리스트 (파3) 정산 포함') +
      toggle(P + 'bonus.longest', g.bonus.longest, '롱기스트 정산 포함') +
      toggle(P + 'bonus.birdie', g.bonus.birdie, '버디 보너스 정산 포함 (이글은 2배)') +
      '</div><div class="opts"><span class="lab">1회당 (다른 플레이어 각각 지급)</span>' + numField(P + 'bonus.unit', g.bonus.unit, '원') + '</div></div>';
    return html;
  }

  function viewSetup() {
    var d = state.draft;
    var html = topbar('새 라운드', '', backBtn('home'), '');
    html += '<div class="screen">';
    html += '<div class="card"><h2>라운드 정보</h2><div class="stack">' +
      '<div class="field"><label>라운드 / 골프장 이름</label><input type="text" data-bind="draft.name" value="' + esc(d.name) + '" placeholder="예: 주말 라운딩 @ ○○CC" maxlength="60"></div>' +
      '<div class="row"><div class="field grow"><label>날짜</label><input type="date" data-bind="draft.date" value="' + esc(d.date) + '"></div>' +
      '<div class="field"><label>홀 수</label>' + seg('draft.holes', d.holes, [[9, '9홀'], [18, '18홀']]) + '</div></div>' +
      '<div class="muted small">파/핸디캡 인덱스는 기본값(파72)으로 시작하고, 스코어 입력 화면에서 홀마다 바꿀 수 있어요.</div></div></div>';
    html += playersSection('draft', d.players, true);
    html += '<h2 style="margin:4px 2px -4px;font-size:16px">게임 & 정산</h2>';
    html += gamesSection('draft', d.games, d.holes);
    if (state.setupError) html += '<div class="error">' + state.setupError.map(esc).join('<br>') + '</div>';
    html += '<button class="btn primary big block" data-action="start-round">라운드 시작 🏁</button>';
    html += '</div>';
    return html;
  }

  function viewSettings() {
    var r = state.round;
    var html = topbar('라운드 설정', '', backBtn('play', '입력'), statusPill('settings'));
    html += '<div class="screen">';
    html += '<div class="notice">라운드 중에도 팀·게임·금액을 바꿀 수 있어요. 결과는 즉시 다시 계산되고' + (sharingActive() ? ' <b>함께하는 모든 참가자에게 적용</b>됩니다.' : '.') + '</div>';
    html += '<div class="card"><h2>라운드 정보</h2><div class="field"><label>이름</label><input type="text" data-bind="round.name" value="' + esc(r.name) + '" maxlength="60"></div></div>';
    html += playersSection('round', r.players, false);
    html += gamesSection('round', r.games, r.holes);
    if (state.setupError) html += '<div class="error">' + state.setupError.map(esc).join('<br>') + '</div>';
    html += '<button class="btn primary big block" data-action="go" data-view="play">완료</button>';
    html += '</div>';
    return html;
  }

  function validate(d, strictGames) {
    var errs = [];
    var players = d.players.filter(function (p) { return (p.name || '').trim(); });
    if (players.length < 2) errs.push('플레이어 이름을 2명 이상 입력하세요.');
    if (!strictGames) return errs;
    var teams = {};
    players.forEach(function (p) { if (p.team) teams[p.team] = (teams[p.team] || 0) + 1; });
    var nTeams = Object.keys(teams).length;
    var g = d.games;
    if (g.skins.enabled && g.skins.mode === 'team' && nTeams < 2) errs.push('팀 스킨스 정산: 팀을 2개 이상 지정하세요.');
    if (g.match.enabled && g.match.mode === 'team' && nTeams !== 2) errs.push('팀 매치 정산: 정확히 2팀이 필요합니다.');
    if (g.nassau.enabled && d.holes !== 18) errs.push('나소는 18홀에서만 가능합니다.');
    if (g.nassau.enabled && g.nassau.mode === 'team' && nTeams !== 2) errs.push('팀 나소 정산: 정확히 2팀이 필요합니다.');
    if (g.bestball.enabled && nTeams < 2) errs.push('베스트볼 정산: 팀을 2개 이상 지정하세요.');
    if (g.vegas.enabled && (nTeams !== 2 || Object.keys(teams).some(function (t) { return teams[t] !== 2; }))) errs.push('라스베가스 정산: 2명씩 2팀이 필요합니다.');
    return errs;
  }

  function startRound() {
    var d = state.draft;
    var errs = validate(d, true);
    if (errs.length) { state.setupError = errs; save(); render(); return; }
    var players = d.players.filter(function (p) { return (p.name || '').trim(); }).map(function (p) {
      return { id: p.id || uid(), name: p.name.trim().slice(0, 20), hcp: Math.max(0, Math.min(54, Number(p.hcp) || 0)), team: p.team || '' };
    });
    var scores = {};
    players.forEach(function (p) { scores[p.id] = new Array(d.holes).fill(null); });
    var now = Date.now();
    closeSession();
    state.round = {
      id: uid(), name: (d.name.trim() || ('라운드 ' + d.date)).slice(0, 60), date: d.date, holes: d.holes,
      pars: G.defaultPars(d.holes), strokeIndex: G.defaultStrokeIndex(d.holes),
      players: players, scores: scores, extras: {}, games: clone(d.games), status: 'live', rev: {}, currentHole: 0, createdAt: now
    };
    S.stampAll(state.round, now, state.clientId);
    resetBaseline();
    state.setupError = null; state.readOnly = false; state.viewRoundId = null; state.boardTab = 'stroke'; state.me = null;
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
    var me = myPid();
    var html = topbar(r.name, (h + 1) + '/' + r.holes + '홀', backBtn('home'), statusPill('play') + '<button class="iconbtn" data-action="go" data-view="settings">⚙︎</button>');
    html += '<div class="screen">';
    html += finishedBanner(r);
    html += meChooser(r);
    html += '<div class="card"><div class="holehead"><div class="num">' + (h + 1) + '<small>번홀</small></div><div class="meta">' +
      '<div class="row"><span class="small muted">파</span>' + seg('round.pars.' + h, par, [[3, '3'], [4, '4'], [5, '5']]) +
      '<span class="si" style="margin-left:auto">HCP <input type="number" inputmode="numeric" min="1" max="' + r.holes + '" data-bind="round.strokeIndex.' + h + '" data-type="number" value="' + r.strokeIndex[h] + '"></span></div>' +
      '</div></div>';
    html += '<div class="hole-strip">' + holeStrip(r, h) + '</div>';
    if (!sharingActive() && holesDone(r) < 2 && !state.hintSeen) html += '<div class="muted small" style="margin-top:6px">동반자도 각자 입력하게 하려면 위의 <b>👥 함께</b>를 눌러 코드를 보내세요. <button class="btn sm ghost" data-action="dismiss-hint">닫기</button></div>';
    html += '</div>';
    html += '<div class="card">' + r.players.map(function (p) {
      var s = G.gross(r, p.id, h);
      var st = sm[p.id][h];
      var tot = runningTotal(r, p.id);
      var diff = s === null ? null : s - par;
      var pid = esc(p.id);
      return '<div class="scorerow ' + (me === p.id ? 'mine' : '') + '">' +
        '<div class="who"><div class="name">' + badge(p.team) + '<span>' + esc(p.name) + '</span></div>' +
        '<div class="meta"><span>' + tot.gross + '타</span><span class="tp ' + tpClass(tot.toPar) + '">' + G.fmtToPar(tot.toPar) + '</span>' +
        (p.hcp ? '<span>H' + esc(p.hcp) + '</span>' : '') + (st ? '<span class="dots" title="이 홀 핸디 타수">' + '●'.repeat(st) + '</span>' : '') + '</div></div>' +
        '<button class="pm" data-action="score" data-pid="' + pid + '" data-delta="-1">−</button>' +
        '<button class="scorebox ' + (s !== null ? 'set' : '') + '" data-action="score-tap" data-pid="' + pid + '">' +
        (s === null ? '<span class="v empty">파 ' + par + '</span><span class="l">탭하여 입력</span>'
          : '<span class="v">' + s + '</span><span class="l ' + tpClass(diff) + '">' + G.toParLabel(diff) + '</span><span class="x" data-action="score-clear" data-pid="' + pid + '">×</span>') +
        '</button>' +
        '<button class="pm" data-action="score" data-pid="' + pid + '" data-delta="1">＋</button>' +
        '</div>';
    }).join('');
    html += '<div class="quick" style="margin-top:10px"><button class="btn sm grow" data-action="par-all">전원 파 입력</button><button class="btn sm ghost" data-action="clear-hole">홀 초기화</button></div>';
    html += '</div>';
    var ex = (r.extras && r.extras[h]) || {};
    html += '<div class="card"><h2>니어 / 롱기 <span class="hint">받는 사람 선택 (선택)</span></h2><div class="stack">' +
      '<div class="chips"><span class="small muted blab">니어리스트</span>' + r.players.map(function (p) {
        return '<button class="chip accent ' + (ex.nearest === p.id ? 'active' : '') + '" data-action="extra" data-type="nearest" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>' +
      '<div class="chips"><span class="small muted blab">롱기스트</span>' + r.players.map(function (p) {
        return '<button class="chip accent ' + (ex.longest === p.id ? 'active' : '') + '" data-action="extra" data-type="longest" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>' +
      '</div></div>';
    html += liveSummary(r);
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

  function liveSummary(r) {
    var all = G.computeAll(r), parts = [];
    var top = all.stroke.rows.filter(function (p) { return p.played; }).slice(0, 3);
    if (top.length) parts.push('<div class="kv"><span class="k">순위</span><span>' + top.map(function (p) { return (p.rank || '-') + '위 ' + esc(p.name) + ' <span class="' + tpClass(p.toPar) + '">' + G.fmtToPar(p.toPar) + '</span>'; }).join(' · ') + '</span></div>');
    if (all.skins && !all.skins.error) {
      parts.push('<div class="kv"><span class="k">스킨스' + (all.skins.enabled ? ' ₩' : '') + '</span><span>' + all.skins.entrants.map(function (e) { return esc(e.name) + ' ' + e.skins; }).join(' · ') + (all.skins.carry ? ' <b style="color:#7a5a00">(이월 ' + all.skins.carry + ')</b>' : '') + '</span></div>');
    }
    if (all.match && !all.match.error) {
      parts.push('<div class="kv"><span class="k">매치' + (all.match.enabled ? ' ₩' : '') + '</span><span>' + all.match.matches.map(function (m) {
        var lead = m.status.leader === 'A' ? m.a.name : m.status.leader === 'B' ? m.b.name : null;
        return (lead ? '<b>' + esc(lead) + '</b> ' : '') + m.status.text + ' <span class="muted">(' + esc(m.a.name) + ' vs ' + esc(m.b.name) + ')</span>';
      }).join('<br>') + '</span></div>');
    }
    if (all.vegas && !all.vegas.error) {
      parts.push('<div class="kv"><span class="k">라스베가스' + (all.vegas.enabled ? ' ₩' : '') + '</span><span>' + all.vegas.teams.map(function (t) { return esc(t.name) + ' ' + t.points + '점'; }).join(' · ') + '</span></div>');
    }
    if (all.bestball && !all.bestball.error) {
      parts.push('<div class="kv"><span class="k">베스트볼' + (all.bestball.enabled ? ' ₩' : '') + '</span><span>' + all.bestball.teams.map(function (t) { return esc(t.name) + ' ' + G.fmtToPar(t.toPar) + ' (' + t.holesWon + '홀 승)'; }).join(' · ') + '</span></div>');
    }
    var hasTeams = G.teamsOf(r).length >= 2;
    var foot = hasTeams ? '' : '<div class="muted small" style="margin-top:6px">팀을 지정하면 팀 스킨스·매치·베스트볼·라스베가스도 여기 표시돼요. <button class="btn sm ghost" data-action="go" data-view="settings">설정</button></div>';
    return '<div class="card"><h2>현재 상황 <span class="hint">₩ = 정산 포함</span></h2><div class="stack">' + parts.join('') + '</div>' + foot + '</div>';
  }

  // ───────────────────────── 리더보드 ─────────────────────────
  function viewBoard() {
    var r = getRound();
    if (!r) { state.view = 'home'; return viewHome(); }
    var all = G.computeAll(r);
    var tabs = [['stroke', '종합'], ['stableford', '스테이블포드'], ['skins', '스킨스'], ['match', '매치']];
    if (all.nassau) tabs.push(['nassau', '나소']);
    tabs.push(['bestball', '베스트볼']);
    if (r.players.length === 4) tabs.push(['vegas', '라스베가스']);
    tabs.push(['bonus', '보너스'], ['settle', '💰 정산']);
    var tab = tabs.some(function (t) { return t[0] === state.boardTab; }) ? state.boardTab : 'stroke';
    var html = topbar(r.name, state.readOnly ? '기록' : holesDone(r) + '/' + r.holes + '홀', backBtn('home'), state.readOnly ? '' : statusPill('board') + '<button class="iconbtn" data-action="go" data-view="settings">⚙︎</button>');
    html += '<div class="screen">';
    html += finishedBanner(r);
    html += '<div class="tabs">' + tabs.map(function (t) {
      var en = all[t[0]] && all[t[0]].enabled;
      var inc = t[0] === 'bonus' ? !!(en && (en.nearest || en.longest || en.birdie)) : t[0] === 'stroke' ? r.games.stroke.unit > 0 : !!en;
      return '<button data-action="tab" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'active' : '') + '">' + t[1] + (inc ? ' ₩' : '') + '</button>';
    }).join('') + '</div>';
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
    var me = myPid();
    var html = '<div class="card"><h2>순위' + (hasHcp ? '<span class="hint">' + seg('boardNet', state.boardNet, [[false, '그로스'], [true, '네트']]) + '</span>' : '') + '</h2>';
    html += '<table><thead><tr><th></th><th class="l">플레이어</th><th>홀</th><th>타수</th><th>±파</th>' + (hasHcp ? '<th>네트</th>' : '') + '</tr></thead><tbody>';
    res.rows.forEach(function (p) {
      html += '<tr class="' + (me === p.id ? 'me' : '') + '"><td>' + (p.rank ? '<span class="rank r' + p.rank + '">' + p.rank + '</span>' : '') + '</td><td class="l">' + badge(p.team) + ' ' + esc(p.name) + (p.hcp ? ' <span class="muted small">H' + esc(p.hcp) + '</span>' : '') + '</td>' +
        '<td>' + p.played + '</td><td><b>' + p.gross + '</b></td><td class="' + tpClass(p.toPar) + '"><b>' + G.fmtToPar(p.toPar) + '</b></td>' +
        (hasHcp ? '<td>' + p.net + ' <span class="small ' + tpClass(p.netToPar) + '">(' + G.fmtToPar(p.netToPar) + ')</span></td>' : '') + '</tr>';
    });
    html += '</tbody></table></div>';
    if (r.games.stroke.unit > 0 && all.stroke.transfers.length) {
      html += '<div class="card"><h2>스트로크 내기 <span class="hint">타당 ' + won(r.games.stroke.unit) + ' · 전원 완료 홀 기준</span></h2>' +
        all.stroke.transfers.map(function (t) { return '<div class="payline"><span>' + esc(nameOf(r, t.from)) + ' → ' + esc(nameOf(r, t.to)) + ' <span class="muted small">' + esc(t.note) + '</span></span><span class="amt">' + won(t.amount) + '</span></div>'; }).join('') + '</div>';
    } else if (!state.readOnly) {
      html += '<div class="muted small center">타당 금액을 설정하면 스트로크 내기도 정산돼요.</div>';
    }
    return html;
  }

  function tabStableford(r, all) {
    var res = all.stableford, me = myPid();
    var html = '<div class="card"><h2>스테이블포드 <span class="hint">' + (res.net ? '네트' : '그로스') + ' · 높을수록 좋음</span></h2><table><thead><tr><th></th><th class="l">플레이어</th><th>점수</th></tr></thead><tbody>';
    res.rows.forEach(function (p) {
      html += '<tr class="' + (me === p.id ? 'me' : '') + '"><td><span class="rank r' + p.rank + '">' + p.rank + '</span></td><td class="l">' + badge(p.team) + ' ' + esc(p.name) + '</td><td><b style="font-size:18px">' + p.points + '</b></td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="card"><h2>홀별 점수</h2><div class="tablewrap"><table class="scorecard"><thead><tr><th></th>' + holeHeaders(r) + '<th class="sum">합</th></tr></thead><tbody>';
    res.rows.forEach(function (p) {
      html += '<tr><td>' + esc(p.name) + '</td>' + p.holes.map(function (v, i) { return '<td>' + (v === null ? '' : v) + '</td>' + (i === 8 && r.holes === 18 ? '<td class="sum">' + sumRange(p.holes, 0, 9) + '</td>' : ''); }).join('') + '<td class="sum">' + p.points + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  function tabSkins(r, all) {
    var res = all.skins;
    var head = '<h2>스킨스 ' + moneyChip('skins', res.enabled) + '<span class="hint">' + (r.games.skins.mode === 'team' ? '팀' : '개인') + (res.unit ? ' · 스킨당 ' + won(res.unit) : '') + (res.net ? ' · 네트' : '') + '</span></h2>';
    if (res.error) return '<div class="card">' + head + '</div>' + teamHint(res.error + '. 설정에서 "방식"을 개인으로 바꾸거나 팀을 지정하세요.');
    var html = '<div class="card">' + head + '<table><thead><tr><th class="l">' + (r.games.skins.mode === 'team' ? '팀' : '플레이어') + '</th><th>스킨</th><th>금액</th></tr></thead><tbody>';
    var money = {};
    res.transfers.forEach(function (t) { money[t.to] = (money[t.to] || 0) + t.amount; money[t.from] = (money[t.from] || 0) - t.amount; });
    res.entrants.forEach(function (e) {
      var m = e.pids.reduce(function (a, pid) { return a + (money[pid] || 0); }, 0);
      html += '<tr><td class="l"><b>' + esc(e.name) + '</b>' + (e.pids.length > 1 ? ' <span class="muted small">' + e.pids.map(function (pid) { return esc(nameOf(r, pid)); }).join(', ') + '</span>' : '') + '</td><td><b style="font-size:18px">' + e.skins + '</b></td><td class="' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '">' + (res.enabled && res.unit ? signedWon(m) : '<span class="muted">-</span>') + '</td></tr>';
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
    var head = '<h2>매치 플레이 ' + moneyChip('match', res.enabled) + '<span class="hint">' + (r.games.match.mode === 'team' ? '팀' : '개인 리그') + (res.unit ? ' · 홀당 ' + won(res.unit) : '') + (res.net ? ' · 네트' : '') + '</span></h2>';
    if (res.error) return '<div class="card">' + head + '</div>' + teamHint(res.error + '. 설정에서 "방식"을 개인으로 바꾸거나 2팀을 지정하세요.');
    return '<div class="card">' + head + '<div class="stack">' +
      res.matches.map(function (m) { return matchBox(m, m.status, m.money && res.enabled ? won(m.money) : null); }).join('') +
      '</div><div class="muted small" style="margin-top:8px"><span style="color:var(--team-A)">■</span> 왼쪽 승 &nbsp;<span style="color:var(--team-B)">■</span> 오른쪽 승 &nbsp;<span style="color:#cbd5d0">■</span> 무승부. 금액은 매치 종료 시 홀 차 × 단가로 확정됩니다.</div></div>';
  }

  function tabNassau(r, all) {
    var res = all.nassau;
    var head = '<h2>나소 ' + moneyChip('nassau', res.enabled) + '<span class="hint">' + (r.games.nassau.mode === 'team' ? '팀' : '개인') + (res.unit ? ' · 판당 ' + won(res.unit) : '') + '</span></h2>';
    if (res.error) return '<div class="card">' + head + '</div>' + teamHint(res.error + '.');
    return '<div class="card">' + head + '</div>' + res.matches.map(function (m) {
      return '<div class="card"><h2>' + esc(m.a.name) + ' vs ' + esc(m.b.name) + '</h2><div class="stack">' +
        m.segments.map(function (s) { return '<div class="small muted" style="margin-bottom:-4px">' + esc(s.name) + '</div>' + matchBox(m, s.status, s.money && res.enabled ? won(s.money) : null); }).join('') + '</div></div>';
    }).join('');
  }

  function tabBestball(r, all) {
    var res = all.bestball;
    var head = '<h2>베스트볼 ' + moneyChip('bestball', res.enabled) + '<span class="hint">베스트 ' + res.count + (res.net ? ' · 네트' : '') + (res.unit ? ' · 홀당 ' + won(res.unit) : '') + '</span></h2>';
    if (res.error) return '<div class="card">' + head + '</div>' + teamHint(res.error + '.');
    var html = '<div class="card">' + head + '<table><thead><tr><th class="l">팀</th><th>팀 타수</th><th>±파</th><th>홀 승</th></tr></thead><tbody>';
    res.teams.forEach(function (t) {
      html += '<tr><td class="l">' + badge(t.id) + ' <span class="muted small">' + t.pids.map(function (pid) { return esc(nameOf(r, pid)); }).join(', ') + '</span></td><td><b>' + t.total + '</b></td><td class="' + tpClass(t.toPar) + '"><b>' + G.fmtToPar(t.toPar) + '</b></td><td>' + t.holesWon + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="card"><h2>홀별 팀 점수</h2><div class="tablewrap"><table class="scorecard"><thead><tr><th></th>' + holeHeaders(r) + (r.holes === 18 ? '<th class="sum">IN</th>' : '') + '<th class="sum">TOT</th></tr></thead><tbody>';
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
    var head = '<h2>라스베가스 ' + moneyChip('vegas', res.enabled) + '<span class="hint">' + (res.unit ? '점당 ' + won(res.unit) : '') + '</span></h2>';
    if (res.error) return '<div class="card">' + head + '</div>' + teamHint(res.error + '.');
    var html = '<div class="card">' + head + '<div class="row" style="justify-content:space-around;text-align:center">' +
      res.teams.map(function (t, i) {
        var m = (t.points - res.teams[1 - i].points) * res.unit;
        return '<div>' + badge(t.id) + '<div class="small muted">' + t.pids.map(function (pid) { return esc(nameOf(r, pid)); }).join(' · ') + '</div><div style="font-size:30px;font-weight:800">' + t.points + '</div>' +
          (res.enabled ? '<div class="small ' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '">' + signedWon(m) + '</div>' : '') + '</div>';
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
    var res = all.bonus, g = r.games.bonus, en = res.enabled, me = myPid();
    var money = {};
    res.transfers.forEach(function (t) { money[t.to] = (money[t.to] || 0) + t.amount; money[t.from] = (money[t.from] || 0) - t.amount; });
    var anyMoney = en.nearest || en.longest || en.birdie;
    var chip = function (type, label) {
      if (state.readOnly) return '<span class="chip sm ' + (en[type] ? 'active' : '') + '">' + label + '</span>';
      return '<button class="chip sm ' + (en[type] ? 'active' : '') + '" data-action="toggle-bonus" data-type="' + type + '">' + label + (en[type] ? ' ₩' : '') + '</button>';
    };
    var html = '<div class="card"><h2>보너스 <span class="hint">1회당 ' + won(g.unit) + '</span></h2>' +
      '<div class="chips" style="margin-bottom:10px">' + chip('nearest', '니어리스트') + chip('longest', '롱기스트') + chip('birdie', '버디/이글') + '</div>' +
      '<table><thead><tr><th class="l">플레이어</th><th>니어</th><th>롱기</th><th>버디</th><th>이글+</th>' + (anyMoney ? '<th>금액</th>' : '') + '</tr></thead><tbody>';
    r.players.forEach(function (p) {
      var c = res.counts[p.id], m = money[p.id] || 0;
      html += '<tr class="' + (me === p.id ? 'me' : '') + '"><td class="l">' + badge(p.team) + ' ' + esc(p.name) + '</td><td>' + c.nearest + '</td><td>' + c.longest + '</td><td>' + c.birdie + '</td><td>' + c.eagle + '</td>' +
        (anyMoney ? '<td class="' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '">' + signedWon(m) + '</td>' : '') + '</tr>';
    });
    html += '</tbody></table><div class="muted small" style="margin-top:6px">칩을 눌러 정산에 포함할 보너스를 고르세요. 니어/롱기 받는 사람은 스코어 입력 화면에서 홀마다 선택해요.</div></div>';
    return html;
  }

  function tabSettle(r, all) {
    var s = all.settlement, me = myPid();
    var included = ['skins', 'match', 'nassau', 'bestball', 'vegas'].filter(function (k) { return all[k] && all[k].enabled && !all[k].error; }).map(function (k) { return GAME_NAMES[k]; });
    if (r.games.stroke.unit > 0) included.unshift('스트로크');
    var b = r.games.bonus; if (b.nearest || b.longest || b.birdie) included.push('보너스');
    var html = '<div class="card"><h2>개인별 손익 <span class="hint">' + (included.length ? '포함: ' + esc(included.join(', ')) : '정산에 포함된 게임 없음') + '</span></h2><table><thead><tr><th class="l">플레이어</th><th>손익</th><th class="l">내역</th></tr></thead><tbody>';
    s.rows.forEach(function (p) {
      var parts = Object.keys(p.byGame).filter(function (k) { return Math.round(p.byGame[k]) !== 0; }).map(function (k) { return GAME_NAMES[k] + ' ' + signedWon(p.byGame[k]); });
      html += '<tr class="' + (me === p.id ? 'me' : '') + '"><td class="l">' + badge((G.playerById(r, p.id) || {}).team) + ' ' + esc(p.name) + '</td><td class="' + (p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : '') + '" style="font-size:16px">' + signedWon(p.net) + '</td><td class="l small muted" style="white-space:normal">' + esc(parts.join(', ')) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="card"><h2>송금 정리 <span class="hint">최소 횟수로 정산</span></h2>' +
      (s.payments.length ? s.payments.map(function (p) { return '<div class="payline"><span><b>' + esc(nameOf(r, p.from)) + '</b> → <b>' + esc(nameOf(r, p.to)) + '</b></span><span class="amt">' + won(p.amount) + '</span></div>'; }).join('') : '<div class="muted">정산할 금액이 없습니다.' + (included.length ? '' : ' 각 게임 탭의 "정산 포함"을 켜거나 설정에서 금액을 정하세요.') + '</div>') +
      '</div>';
    if (!state.readOnly && holesDone(r) < r.holes) html += '<div class="notice">아직 ' + (r.holes - holesDone(r)) + '홀이 남았어요. 매치/나소 금액은 매치가 끝나야 확정됩니다.</div>';
    html += '<button class="btn block" data-action="share-text">결과 복사 / 공유</button>';
    return html;
  }

  function holeHeaders(r) {
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
    var hasHcp = r.players.some(function (p) { return p.hcp; });
    var me = myPid();
    var html = topbar(r.name, '스코어카드', backBtn('home'), state.readOnly ? '' : statusPill('card'));
    html += '<div class="screen"><div class="card"><div class="tablewrap"><table class="scorecard"><thead><tr><th>홀</th>';
    for (var i = 0; i < r.holes; i++) { html += '<th>' + (i + 1) + '</th>'; if (i === 8 && r.holes === 18) html += '<th class="sum">OUT</th>'; }
    html += (r.holes === 18 ? '<th class="sum">IN</th>' : '') + '<th class="sum">TOT</th><th class="sum">±</th>' + (hasHcp ? '<th class="sum">NET</th>' : '') + '</tr></thead><tbody>';
    html += '<tr><td>파</td>';
    for (i = 0; i < r.holes; i++) { html += '<td>' + r.pars[i] + '</td>'; if (i === 8 && r.holes === 18) html += '<td class="sum">' + sumRange(r.pars, 0, 9) + '</td>'; }
    html += (r.holes === 18 ? '<td class="sum">' + sumRange(r.pars, 9, 18) + '</td>' : '') + '<td class="sum">' + sumRange(r.pars, 0, r.holes) + '</td><td class="sum"></td>' + (hasHcp ? '<td class="sum"></td>' : '') + '</tr>';
    html += '<tr><td class="muted small">HCP</td>';
    for (i = 0; i < r.holes; i++) { html += '<td class="muted small">' + r.strokeIndex[i] + '</td>'; if (i === 8 && r.holes === 18) html += '<td class="sum"></td>'; }
    html += (r.holes === 18 ? '<td class="sum"></td>' : '') + '<td class="sum"></td><td class="sum"></td>' + (hasHcp ? '<td class="sum"></td>' : '') + '</tr>';
    rows.forEach(function (p) {
      html += '<tr class="' + (me === p.id ? 'me' : '') + '"><td>' + badge(p.team) + ' ' + esc(p.name) + '</td>';
      for (var i = 0; i < r.holes; i++) {
        var s = p.holes[i];
        var cls = '';
        if (s !== null) { var d = s - r.pars[i]; cls = d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'dbl' : ''; }
        html += '<td>' + (s === null ? '' : '<span class="sc ' + cls + '">' + s + '</span>') + '</td>';
        if (i === 8 && r.holes === 18) html += '<td class="sum">' + (sumRange(p.holes, 0, 9) || '') + '</td>';
      }
      html += (r.holes === 18 ? '<td class="sum">' + (sumRange(p.holes, 9, 18) || '') + '</td>' : '') + '<td class="sum">' + (p.gross || '') + '</td><td class="sum ' + tpClass(p.toPar) + '">' + (p.played ? G.fmtToPar(p.toPar) : '') + '</td>' +
        (hasHcp ? '<td class="sum">' + (p.played ? p.net : '') + '</td>' : '') + '</tr>';
    });
    html += '</tbody></table></div><div class="muted small" style="margin-top:8px">○ 버디 &nbsp;◎ 이글 이상 &nbsp;□ 보기 &nbsp;▣ 더블보기 이상</div></div>';
    html += '<button class="btn block" data-action="share-text">결과 복사 / 공유</button>';
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
  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg || '복사했어요'); }, function () { prompt('복사하세요', text); });
    } else prompt('복사하세요', text);
  }
  function shareResults() {
    var r = getRound(); if (!r) return;
    var text = shareText(r);
    if (navigator.share) { navigator.share({ title: r.name, text: text }).catch(function () { }); return; }
    copyText(text, '결과를 클립보드에 복사했어요');
  }
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  // ───────────────────────── 렌더 & 이벤트 ─────────────────────────
  function render() {
    var views = { home: viewHome, setup: viewSetup, settings: viewSettings, play: viewPlay, board: viewBoard, card: viewCard, share: viewShare, joining: viewJoining };
    if (!views[state.view]) state.view = 'home';
    if ((state.view === 'play' || state.view === 'settings' || state.view === 'share') && !state.round) state.view = 'home';
    if (state.view === 'joining' && !state.joining) state.view = 'home';
    if (state.view === 'setup' && !state.draft) state.draft = newDraft();
    var y = window.scrollY;
    $app.innerHTML = views[state.view]();
    window.scrollTo(0, y);
    var strip = $app.querySelector('.hole-strip'), cur = strip && strip.querySelector('.cur');
    if (cur) strip.scrollLeft = Math.max(0, cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2);
  }

  function finishRound() {
    var r = state.round; if (!r) return;
    var left = r.holes - holesDone(r);
    if (!confirm((left ? '아직 ' + left + '홀이 미입력이에요. ' : '') + '라운드를 종료하고 기록으로 저장할까요?' + (sharingActive() ? '\n함께하는 모든 참가자에게 종료가 표시돼요.' : ''))) return;
    r.status = 'finished'; r.finishedAt = Date.now();
    save(); // 변경 감지 → status 전송 예약
    var finished = false;
    var done = function () {
      if (finished) return; finished = true;
      var wasShared = sharingActive();
      archiveCurrent();
      // 공유 중이던 라운드는 잠시 연결을 유지해 늦게 들어오는 수정(마지막 홀 등)을 기록에 반영
      if (wasShared && session) { clearTimeout(graceTimer); graceTimer = setTimeout(function () { closeSession(); }, 90000); }
      else closeSession();
      state.readOnly = true; state.viewRoundId = state.history[0].id; state.boardTab = 'settle';
      go('board');
    };
    if (session && sharingActive()) {
      var t = setTimeout(done, 3000);
      session.flush().then(function () { clearTimeout(t); done(); }, function () { clearTimeout(t); done(); });
    } else done();
  }
  function archiveCurrent() {
    var r = state.round; if (!r) return;
    r.finishedAt = r.finishedAt || Date.now();
    state.history = state.history.filter(function (h) { return h.id !== r.id; });
    state.history.unshift(r);
    if (state.history.length > 50) state.history.length = 50;
    state.round = null;
    resetBaseline();
    save();
  }

  var actions = {
    go: function (d) {
      if (d.view === 'home') { state.readOnly = false; state.viewRoundId = null; }
      if (d.view === 'play' && state.readOnly) { state.readOnly = false; state.viewRoundId = null; }
      if (state.view === 'settings' && d.view !== 'settings' && state.round) {
        var errs = validate(state.round, false);
        if (errs.length) { state.setupError = errs; save(); render(); return; }
        state.round.players.forEach(function (p) { if (!(p.name || '').trim()) p.name = '플레이어'; });
      }
      state.setupError = null;
      go(d.view);
    },
    'new-round': function () {
      if (state.round && !confirm('진행 중인 라운드가 있어요. 새 라운드를 시작하면 현재 라운드는 기록으로 저장됩니다. 계속할까요?')) return;
      if (state.round) { closeSession(); archiveCurrent(); }
      var prev = state.history[0];
      state.draft = newDraft();
      if (prev) { // 지난 라운드 플레이어/게임 설정 재사용
        state.draft.players = prev.players.map(function (p) { return { id: uid(), name: p.name, hcp: p.hcp, team: p.team }; });
        state.draft.games = fillGames(clone(prev.games || {}));
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
      setPath(state, d.path, v);
      save(); render();
    },
    'toggle-money': function (d) {
      var r = state.round; if (!r || state.readOnly || !r.games[d.key]) return;
      r.games[d.key].enabled = !r.games[d.key].enabled; save(); render();
    },
    'toggle-bonus': function (d) {
      var r = state.round; if (!r || ['nearest', 'longest', 'birdie'].indexOf(d.type) < 0) return;
      r.games.bonus[d.type] = !r.games.bonus[d.type]; save(); render();
    },
    tab: function (d) { state.boardTab = d.tab; save(); render(); },
    'tab-settle': function () { state.boardTab = 'settle'; go('board'); },
    hole: function (d) { var i = Number(d.i); if (i >= 0 && i < state.round.holes) { state.round.currentHole = i; save(); render(); } },
    score: function (d) {
      var r = state.round, h = r.currentHole, delta = Number(d.delta);
      if (!r.scores[d.pid]) return;
      var cur = r.scores[d.pid][h];
      var v = cur === null || cur === undefined ? r.pars[h] + delta : cur + delta;
      r.scores[d.pid][h] = Math.min(15, Math.max(1, v));
      save(); render();
    },
    'score-tap': function (d) {
      var r = state.round, h = r.currentHole;
      if (!r.scores[d.pid]) return;
      if (r.scores[d.pid][h] === null || r.scores[d.pid][h] === undefined) { r.scores[d.pid][h] = r.pars[h]; save(); render(); }
    },
    'score-clear': function (d, el, ev) { ev.stopPropagation(); var r = state.round; if (!r.scores[d.pid]) return; r.scores[d.pid][r.currentHole] = null; save(); render(); },
    'par-all': function () {
      var r = state.round, h = r.currentHole;
      r.players.forEach(function (p) { if (r.scores[p.id][h] === null) r.scores[p.id][h] = r.pars[h]; });
      save(); render();
    },
    'clear-hole': function () {
      var r = state.round, h = r.currentHole;
      r.players.forEach(function (p) { r.scores[p.id][h] = null; });
      if (r.extras && r.extras[h]) delete r.extras[h];
      save(); render();
    },
    extra: function (d) {
      var r = state.round, h = r.currentHole;
      if (!G.playerById(r, d.pid) || (d.type !== 'nearest' && d.type !== 'longest')) return;
      r.extras = r.extras || {}; r.extras[h] = r.extras[h] || {};
      r.extras[h][d.type] = r.extras[h][d.type] === d.pid ? null : d.pid;
      if (!r.extras[h].nearest && !r.extras[h].longest) delete r.extras[h];
      save(); render();
    },
    finish: finishRound,
    'archive-now': function () { var wasShared = sharingActive(); archiveCurrent(); if (wasShared && session) { clearTimeout(graceTimer); graceTimer = setTimeout(closeSession, 90000); } else closeSession(); state.readOnly = true; state.viewRoundId = state.history[0].id; state.boardTab = 'settle'; go('board'); },
    discard: function () { if (confirm('진행 중인 라운드를 삭제할까요? 복구할 수 없어요.' + (sharingActive() ? '\n(다른 참가자의 기기에는 남아 있어요)' : ''))) { scan = null; closeSession(); state.round = null; resetBaseline(); go('home'); } },
    'view-history': function (d) { state.readOnly = true; state.viewRoundId = d.id; state.boardTab = 'stroke'; go('board'); },
    'del-history': function (d) { if (confirm('이 기록을 삭제할까요?')) { state.history = state.history.filter(function (h) { return h.id !== d.id; }); save(); render(); } },
    'share-text': shareResults,
    'dismiss-hint': function () { state.hintSeen = true; save(); render(); },
    // 실시간 공유
    'start-sharing': startSharing,
    'retry-sharing': retrySharing,
    'reshare-new-code': function () { if (confirm('새 코드를 만들어 다시 공유할까요? 이미 들어온 참가자는 새 코드로 다시 참여해야 해요.')) { scan = null; closeSession(); startSharing(); } },
    'stop-sharing': function () {
      if (!confirm(isHost() ? '내 기기의 연결만 끊어요. 다른 참가자는 계속 함께 입력할 수 있어요. 중지할까요?' : '공유에서 나갈까요? 지금까지의 점수는 내 기기에 남아요.')) return;
      stopSharing();
    },
    'end-sharing': function () {
      if (!confirm('모든 참가자의 연결을 끊고 중계 서버의 데이터를 삭제할까요? 각자 기기의 점수는 그대로 남아요.')) return;
      endSharingOnServer();
    },
    'join-code': function () { var el = document.getElementById('join-code'); joinRoom(el ? el.value : '', 0); },
    'retry-join': function () { var j = state.joining; state.joining = null; if (j) joinRoom(j.code, j.b); },
    'cancel-join': cancelJoin,
    'set-me': function (d) {
      var r = getRound(); if (!r || !G.playerById(r, d.pid)) return;
      state.me = (state.me && state.me.roundId === r.id && state.me.pid === d.pid) ? null : { roundId: r.id, pid: d.pid };
      if (session) session.setName(myName());
      save(); render();
    },
    'skip-me': function () { var r = state.round; if (r) { state.meSkipped[r.id] = true; save(); render(); } },
    copy: function (d) { copyText(d.text, '복사했어요'); },
    'share-link': function () {
      var r = state.round; if (!r || !sharingActive()) return;
      var text = '⛳ ' + r.name + ' 스코어 함께 입력\n코드: ' + S.formatCode(r.share.code) + '\n' + shareLink(r.share.code, r.share.broker || 0);
      if (navigator.share) navigator.share({ title: r.name, text: text }).catch(function () { });
      else copyText(text, '링크를 복사했어요');
    }
  };

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
    if (/\.hcp$/.test(path)) v = Math.min(54, Math.max(0, v));
    if (getPath(state, path) === v) return;
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
  $app.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'join-code') { ev.preventDefault(); joinRoom(ev.target.value, 0); }
  });
  function wakeSession() {
    fgAt = Date.now();
    setTimeout(function () { if (session && sharingActive()) { session.wake(); softRender(); } }, 400);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') wakeSession(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) wakeSession(); });
  window.addEventListener('online', wakeSession);
  window.addEventListener('beforeunload', function () { if (session) session.stop(); });
  setInterval(function () { if (sharingActive() && state.view === 'share') softRender(); }, 10000); // '마지막 동기화 n초 전' 갱신

  // ───────────────────────── 시작: URL 파라미터(참여 링크) 처리 ─────────────────────────
  var pendingJoin = null;
  function handleUrl() {
    var out = null;
    try {
      var hash = location.hash && location.hash.charAt(0) === '#' ? location.hash.slice(1) : '';
      var q = new URLSearchParams(location.search);
      var hq = new URLSearchParams(hash);
      var broker = hq.get('broker') || q.get('broker');
      if (broker !== null) { state.settings.broker = /^wss?:\/\//.test(broker) ? broker : ''; }
      var join = hq.get('join') || q.get('join');
      if (join) out = { code: S.normalizeCode(join), b: Number(hq.get('b') || q.get('b')) || 0 };
      if (join || broker !== null) history.replaceState(null, '', location.pathname);
    } catch (e) { /* ignore */ }
    return out;
  }
  pendingJoin = handleUrl();
  // 이미 열린 앱에서 참여 링크가 눌린 경우 (해시만 바뀌어 새로고침이 없을 때)
  window.addEventListener('hashchange', function () { var j = handleUrl(); if (j) joinRoom(j.code, j.b); });
  if (state.view === 'joining' || state.view === 'share') state.view = state.round ? 'play' : 'home';
  save();
  render();
  if (pendingJoin) setTimeout(function () { joinRoom(pendingJoin.code, pendingJoin.b); }, 50);
  else ensureSession();
})();
