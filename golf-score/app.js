/* app.js — 골프 스코어 앱 UI (vanilla JS, 상태는 localStorage에 저장, 실시간 공유는 sync.js) */
(function () {
  'use strict';
  var G = window.GolfGames;
  var S = window.GolfSync;
  var A = window.GolfAnalysis;
  var BUILTIN_COURSES = Array.isArray(window.GolfCourses) ? window.GolfCourses : [];
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
    return { name: '', course: '', date: today(), holes: 18, players: [newPlayer(), newPlayer(), newPlayer(), newPlayer()], games: defaultGames() };
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
  var baseline = null, baselineRid = null, saveFailed = false;
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
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveFailed = false; }
    catch (e) { if (!saveFailed) { saveFailed = true; setTimeout(function () { toast('기기 저장 공간이 부족해 저장하지 못했어요. 홈에서 오래된 기록을 지워 주세요.'); }, 0); } }
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

  /** 입력 중이면 전체 재렌더를 미뤄 포커스를 잃지 않게 한다. 그동안에도 입력란이 들어 있지 않은 영역(data-region)은 새 내용으로 바꿔서
   *  점수·순위가 낡은 채로 보이지 않게 한다 (코스 메모를 적는 동안 동반자가 넣은 점수 등) */
  function softRender() {
    var a = document.activeElement;
    if (a && $app.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) { renderPending = true; patchRegions(a); return; }
    render();
  }
  function patchRegions(focused) {
    var tmp = document.createElement('div');
    tmp.innerHTML = viewHtml();
    var fresh = tmp.querySelectorAll('[data-region]');
    for (var i = 0; i < fresh.length; i++) {
      var old = $app.querySelector('[data-region="' + fresh[i].getAttribute('data-region') + '"]');
      if (old && !old.contains(focused) && old.innerHTML !== fresh[i].innerHTML) old.innerHTML = fresh[i].innerHTML;
    }
    centerHoleStrip();
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
        // 참여 중(스냅샷을 기다리는 동안)에는 기록에 남은 옛 사본을 세션에 노출하지 않음 → hello 요청/스냅샷 채택 경로가 정상 동작
        getRound: function () { return state.joining && state.joining.code === code ? null : findRoundByCode(code); },
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
    syncStatus = 'idle'; syncReady = false; peers = []; skewMs = 0;
  }
  function onSessionStatus(code, s) {
    syncStatus = s;
    if (s === 'connected') { fgAt = 0; skewMs = 0; }
    if (scan && scan.code === code) {
      if (s === 'connected') {
        clearTimeout(scan.timer);
        if (scan.mode === 'host') {
          var r = state.round; if (r && r.share) r.share.broker = scan.idx;
          clearScan(); save();
        } else {
          var sc = scan;
          sc.timer = setTimeout(function () { if (scan === sc) nextBroker('nosnapshot'); }, 7000);
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
  function clearScan() { if (scan) clearTimeout(scan.timer); scan = null; }
  function beginScan(code, mode, startIdx, handlers) {
    clearScan();
    var list = brokerList();
    scan = { code: code, mode: mode, idx: Math.min(Math.max(0, startIdx || 0), list.length - 1), list: list, tried: 0, handlers: handlers || null };
    tryBroker();
  }
  function tryBroker() {
    if (!scan) return;
    var s = scan;
    openSession(s.code, s.list[s.idx], s.handlers);
    clearTimeout(s.timer);
    s.timer = setTimeout(function () { if (scan === s) nextBroker('noconnect'); }, 9000);
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
    var s = scan; clearScan(); closeSession();
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
    clearScan(); closeSession();
    if (r && r.share) r.share.active = false;
    save(); render();
  }
  function endSharingOnServer() {
    var r = state.round; if (!r || !session) { stopSharing(); return; }
    if (!session.connected()) { toast('연결된 상태에서만 서버의 데이터를 삭제할 수 있어요. 연결 후 다시 시도해 주세요.'); return; }
    r.status = 'closed'; save();
    var s = session;
    var fail = function () { r.status = 'live'; save(); softRender(); toast('서버 삭제에 실패했어요. 연결 상태를 확인하고 다시 시도해 주세요.'); };
    s.flush().then(function (ok) { if (!ok) throw new Error('offline'); return s.clearRetained(); })
      .then(function (ok) { if (!ok) throw new Error('offline'); r.status = 'live'; stopSharing(); toast('서버의 공유 데이터를 삭제했어요'); }, fail);
  }
  function joinRoom(code, b) {
    code = S.normalizeCode(code);
    if (!S.isValidCode(code)) { alert('코드는 영문/숫자 8자리예요. (예: ABCD-EFGH)'); return; }
    if (!S.cryptoAvailable()) { alert('이 환경에서는 실시간 공유를 사용할 수 없어요. HTTPS 주소로 열어 주세요.'); return; }
    var cur = state.round;
    if (cur && cur.share && cur.share.code === code) { state.readOnly = false; state.viewRoundId = null; cur.share.active = true; save(); ensureSession(); go('play'); return; }
    if (cur) {
      if (holesDone(cur) === 0 && !sharingActive()) { clearScan(); closeSession(); state.round = null; resetBaseline(); }
      else {
        if (!confirm('진행 중인 라운드(' + (cur.name || '라운드') + ', ' + holesDone(cur) + '/' + cur.holes + '홀)가 있어요.\n참여하면 이 라운드는 지난 라운드에 저장되고 공유 라운드로 바뀝니다.')) return;
        clearScan(); closeSession(); archiveCurrent();
      }
    }
    state.readOnly = false; state.viewRoundId = null; state.joining = null;
    // 같은 코드의 라운드가 기록에 있으면(종료/보관 후 링크를 다시 누른 경우) 서버를 뒤지지 않고 그 라운드를 복원해 다시 연결
    var hist = findRoundByCode(code);
    if (hist) {
      state.history = state.history.filter(function (h) { return h.id !== hist.id; });
      hist.share = Object.assign({}, hist.share || {}, { code: code, active: true });
      hist.currentHole = firstOpenHole(hist);
      state.round = hist; resetBaseline(); save();
      clearScan(); ensureSession();
      if (hist.status === 'finished') { state.boardTab = 'settle'; go('board'); toast('이미 종료된 라운드예요. 늦은 수정이 있으면 반영돼요.'); }
      else go('play');
      return;
    }
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
    clearScan();
    r.share = { code: code, host: r.share && r.share.host, active: true, broker: idx };
    // 기록에 같은 라운드가 있으면 로컬 기록과 병합 (더 새로운 값 유지) 후 기록에서 제거
    var dup = null;
    state.history = state.history.filter(function (h) { if (h.id === r.id) { dup = h; return false; } return true; });
    if (dup) S.merge(r, S.exportKeys(dup));
    if (r.status === 'closed') { // 호스트가 서버에서 삭제했지만 retained 스냅샷만 남은 경우
      closeSession();
      state.joining = { code: code, status: 'timeout', b: idx };
      save(); render(); toast('호스트가 이미 종료한 공유예요.');
      return;
    }
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
  function cancelJoin() { clearScan(); closeSession(); state.joining = null; go('home'); }

  function statusLabel() {
    if (navigator.onLine === false) return '오프라인 — 입력은 저장되고 연결되면 자동으로 맞춰져요';
    if (syncStatus === 'error') return '연결 오류 — 다시 시도해 주세요';
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
    if (navigator.onLine === false) { cls = 'offline'; label = '✕ 오프라인'; }
    else if (syncStatus === 'connected') { cls = 'connected'; label = '● ' + (peers.length + 1) + '명'; }
    else if (syncStatus === 'connecting' || syncStatus === 'loading' || (syncStatus === 'offline' && Date.now() - fgAt < 5000)) { cls = 'connecting'; label = '○ 연결 중'; }
    else if (syncStatus === 'failed' || syncStatus === 'nolib' || syncStatus === 'nocrypto' || syncStatus === 'error') { cls = 'offline'; label = '! 연결 실패'; }
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

  // ───────────────────────── 입력 범위(내 점수만 / 모두) · 상세 기록 ─────────────────────────
  /** 'mine' = 내 줄만 입력(다른 사람 점수는 보기만), 'all' = 모두 입력. 기기별 설정이며 공유되지 않음 */
  function entryMode(r) {
    // 공유 중일 때만 의미가 있음: 공유를 멈추면 전환 버튼도 사라지므로 항상 '모두 입력'으로 돌아감
    return sharingActive() && r === state.round && myPid() && state.entry && state.entry.roundId === r.id && state.entry.mode === 'mine' ? 'mine' : 'all';
  }
  function canEdit(r, pid) { return !state.readOnly && r === state.round && (entryMode(r) === 'all' || pid === myPid()); }
  function setStat(r, pid, h, f, v) { return S.setKey(r, 'st:' + pid + ':' + h + ':' + f, v); }
  /** 이 홀에 기록된 OB·해저드·3퍼트를 이름 아래에 작은 표시로 보여 줌 (상세 기록을 켜지 않은 기기에서도 보임) */
  function statTags(r, pid, h) {
    var ob = A.stat(r, pid, h, 'ob'), hz = A.stat(r, pid, h, 'hz'), pt = A.stat(r, pid, h, 'pt'), out = '';
    if (ob) out += '<span class="tag">OB' + (ob > 1 ? ' ' + ob : '') + '</span>';
    if (hz) out += '<span class="tag">해저드' + (hz > 1 ? ' ' + hz : '') + '</span>';
    if (pt !== null && pt >= 3) out += '<span class="tag">' + (pt >= 4 ? '4퍼트+' : '3퍼트') + '</span>';
    return out;
  }
  function entryBar(r, me, mode) {
    if (!sharingActive() || !me) return '';
    return '<div class="entrybar"><span class="small muted">입력</span><div class="seg sm">' +
      '<button type="button" data-action="entry-mode" data-mode="mine" class="' + (mode === 'mine' ? 'active' : '') + '">내 점수만</button>' +
      '<button type="button" data-action="entry-mode" data-mode="all" class="' + (mode === 'all' ? 'active' : '') + '">모두 입력</button></div>' +
      '<span class="small muted who">나: <b>' + esc(nameOf(r, me)) + '</b></span></div>';
  }
  /** 한 플레이어의 이 홀 상세 기록(OB·해저드·벙커·페어웨이·퍼트). 접힌 상태에서는 요약 한 줄만 보임 */
  function detailBlock(r, p, h, par, open) {
    var pid = esc(p.id);
    function v(f) { return A.stat(r, p.id, h, f); }
    var sum = [];
    if (v('ob')) sum.push('OB ' + v('ob'));
    if (v('hz')) sum.push('해저드 ' + v('hz'));
    if (v('bk')) sum.push('벙커 ' + v('bk'));
    if (v('fw') !== null && par >= 4) sum.push(v('fw') === 1 ? '페어웨이 ○' : v('fw') === 2 ? '티샷 좌' : '티샷 우');
    if (v('pt') !== null) sum.push('퍼트 ' + v('pt'));
    var head = '<button class="detail-head" data-action="detail-open" data-pid="' + pid + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="caret">' + (open ? '▾' : '▸') + '</span><span class="ttl">상세 기록</span>' +
      (sum.length ? '<span class="sumtxt">' + esc(sum.join(' · ')) + '</span>' : '<span class="sumtxt none">OB · 해저드 · 퍼트</span>') + '</button>';
    if (!open) return '<div class="detail' + (myPid() === p.id ? ' mine' : '') + '">' + head + '</div>';
    function stepper(f, label) {
      var n = v(f) || 0;
      return '<div class="stp"><span class="lab">' + label + '</span>' +
        '<button class="mini" data-action="stat" data-pid="' + pid + '" data-f="' + f + '" data-delta="-1" ' + (n ? '' : 'disabled') + ' aria-label="' + label + ' 줄이기">−</button>' +
        '<span class="n ' + (n ? 'on' : '') + '">' + n + '</span>' +
        '<button class="mini" data-action="stat" data-pid="' + pid + '" data-f="' + f + '" data-delta="1" aria-label="' + label + ' 늘리기">＋</button></div>';
    }
    var pt = v('pt'), fw = v('fw');
    var putts = '<div class="stp wide"><span class="lab">퍼트</span><div class="chips">' + [0, 1, 2, 3, 4].map(function (k) {
      var on = pt !== null && (pt === k || (k === 4 && pt >= 4));
      return '<button class="chip tap num ' + (on ? 'active' : '') + '" data-action="stat-set" data-pid="' + pid + '" data-f="pt" data-v="' + k + '">' + (k === 4 ? '4+' : k) + '</button>';
    }).join('') + '</div></div>';
    var fairway = par >= 4 ? '<div class="stp wide"><span class="lab">티샷</span><div class="chips">' + [[2, '← 좌'], [1, '페어웨이'], [3, '우 →']].map(function (o) {
      return '<button class="chip tap ' + (fw === o[0] ? 'active' : '') + '" data-action="stat-set" data-pid="' + pid + '" data-f="fw" data-v="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div></div>' : '';
    return '<div class="detail open' + (myPid() === p.id ? ' mine' : '') + '">' + head + '<div class="detail-body">' +
      stepper('ob', 'OB') + stepper('hz', '해저드') + stepper('bk', '벙커') + fairway + putts + '</div></div>';
  }
  // ───────────────────────── 코스 정보: 홀 약도 · 공략 · 입력 ─────────────────────────
  function setHoleInfo(r, h, f, v) { return S.setKey(r, 'hi:' + h + ':' + f, v); }
  /** 입력한 정보로 그리는 홀 약도. 실제 지형이 아니라 홀의 형태와 위험 요소의 위치만 나타낸다 */
  function holeMap(info, par) {
    var L = info.shape === 'L', R = info.shape === 'R', hz = info.haz;
    var gx = L ? 36 : R ? 84 : 60, gy = 34;
    var path = (L || R) ? 'M60 170 L60 96 Q60 56 ' + gx + ' ' + (gy + 14) : 'M60 170 L60 ' + (gy + 14);
    var s = '<rect width="120" height="190" rx="10" fill="#dcecdf"/>';
    if (hz & 1) s += '<rect x="4" y="14" width="7" height="162" rx="3" fill="#ffffff" stroke="#e34948" stroke-width="1"/><text x="7.5" y="100" class="ob" transform="rotate(-90 7.5 100)">OB</text>';
    if (hz & 2) s += '<rect x="109" y="14" width="7" height="162" rx="3" fill="#ffffff" stroke="#e34948" stroke-width="1"/><text x="112.5" y="100" class="ob" transform="rotate(90 112.5 100)">OB</text>';
    s += '<path d="' + path + '" fill="none" stroke="#a9d6b3" stroke-width="' + (par <= 3 ? 14 : 26) + '" stroke-linecap="round" stroke-linejoin="round"/>';
    if (hz & 4) s += '<ellipse cx="27" cy="112" rx="10" ry="22" fill="#86b6ef"/>';
    if (hz & 8) s += '<ellipse cx="93" cy="112" rx="10" ry="22" fill="#86b6ef"/>';
    if (hz & 32) s += '<ellipse cx="40" cy="' + (L ? 128 : 116) + '" rx="7" ry="5" fill="#f1e3b3" stroke="#d9c88e" stroke-width="1"/>';
    if (hz & 64) s += '<ellipse cx="80" cy="' + (R ? 128 : 116) + '" rx="7" ry="5" fill="#f1e3b3" stroke="#d9c88e" stroke-width="1"/>';
    if (hz & 16) s += '<ellipse cx="' + gx + '" cy="' + (gy + 26) + '" rx="19" ry="6" fill="#86b6ef"/>';
    s += '<ellipse cx="' + gx + '" cy="' + gy + '" rx="15" ry="12" fill="#6fbf82"/>';
    if (hz & 128) s += '<ellipse cx="' + (gx - 17) + '" cy="' + (gy + 4) + '" rx="5" ry="4" fill="#f1e3b3" stroke="#d9c88e" stroke-width="1"/><ellipse cx="' + (gx + 16) + '" cy="' + (gy - 5) + '" rx="5" ry="4" fill="#f1e3b3" stroke="#d9c88e" stroke-width="1"/>';
    s += '<line x1="' + gx + '" y1="' + gy + '" x2="' + gx + '" y2="' + (gy - 16) + '" stroke="#16211b" stroke-width="1.2"/><path d="M' + gx + ' ' + (gy - 16) + ' l9 3.5 l-9 3.5 z" fill="#e34948"/>';
    s += '<rect x="53" y="168" width="14" height="6" rx="2" fill="#1d6b3a"/>';
    s += '<text x="60" y="185" class="cap">파' + par + (info.dist ? ' · ' + info.dist + 'm' : '') + '</text>';
    return '<svg class="holemap" viewBox="0 0 120 190" role="img" aria-label="홀 약도">' + s + '</svg>';
  }
  /**
   * 홀 카드 맨 아래의 코스 요약(두 줄 고정): 첫 줄은 '352m · 좌 도그렉 · OB 우', 둘째 줄은 메모(없으면 첫 공략 팁).
   * 내용이 길거나 없어도 높이가 같다 → 동반자가 코스 정보를 넣거나 팁이 바뀌어도 아래 점수 칸이 밀리지 않는다.
   * 누르면 아래 코스 정보 카드(약도·공략 전체)로 이동한다.
   */
  function courseSumInner(r, h) {
    var labels = A.holeLabels(r, h), memo = A.holeInfo(r, h).memo;
    var line1 = labels.join(' · '), line2 = memo ? '📝 ' + memo : '';
    if (!line2 && labels.length) { var tips = A.holeTips(r, h, myPid()); if (tips.length) line2 = '🧭 ' + tips[0]; }
    var none = !line1 && !line2;
    if (none) { line1 = r.course ? r.course : '코스 정보 입력'; line2 = '거리·위험 요소·메모를 넣으면 약도와 공략 팁이 나와요'; }
    else if (!line1) line1 = r.course || (h + 1) + '번홀 메모';
    return '<span class="ic">🗺️</span><span class="txt"><span class="l1' + (none ? ' none' : '') + '">' + esc(line1) + '</span><span class="l2">' + esc(line2) + '</span></span><span class="go">›</span>';
  }
  /** 코스 저장 · 네이버 지도 버튼 줄. 코스 이름을 입력하는 동안에도 따로 다시 그려 링크가 현재 이름을 따라가게 한다 */
  function courseActions(r) {
    var q = (r.course || '').trim();
    return '<button class="btn sm" data-action="course-save">이 코스 저장</button>' +
      (q ? '<a class="btn sm ghost" target="_blank" rel="noopener" href="https://map.naver.com/p/search/' + encodeURIComponent(q + ' 골프') + '">네이버 지도에서 보기 ↗</a>' : '');
  }
  /** 코스 정보 중 입력란이 없는 부분(메모·공략·약도). 입력하는 동안이나 동반자가 고쳤을 때 이 영역만 다시 그린다 */
  function courseLive(r, h, par) {
    var info = A.holeInfo(r, h), open = !!state.courseOpen;
    var tips = A.holeTips(r, h, myPid());
    var notes = '';
    if (info.memo) notes += '<div class="coachline"><span class="ic">📝</span><span>' + esc(info.memo) + '</span></div>';
    notes += tips.map(function (t) { return '<div class="coachline"><span class="ic">🧭</span><span>' + esc(t) + '</span></div>'; }).join('');
    // 펼친 동안에는 약도 영역을 항상 같은 높이로 그린다(공략 글은 약도 높이 안에서 스크롤) → 위험 요소를 누르거나 거리를 적어도
    // 바로 아래 입력란이 밀리지 않는다. 접은 상태에서는 홀 형태나 위험 요소가 있을 때만 약도를 보여 주고 글은 전부 펼친다
    if (open || info.shape || info.haz) {
      return '<div class="course-view' + (open ? ' fixed' : '') + '">' + holeMap(info, par) + '<div class="stack grow">' + (notes || '<div class="muted small">위험 요소나 거리를 입력하면 공략 팁이 여기에 나와요.</div>') +
        '<div class="muted small">약도는 입력한 정보로 그린 그림이에요. 실제 지형과 다를 수 있어요.</div></div></div>';
    }
    return notes ? '<div class="stack course-notes">' + notes + '</div>' : '';
  }
  /**
   * 코스 정보 카드. 점수 칸 '아래'에 둔다: 이 카드는 내용에 따라 높이가 변하는데(공략 팁, 동반자가 실시간으로 넣는 정보, 약도),
   * 점수 칸 위에 있으면 높이가 변할 때마다 ＋/− 버튼이 손가락 밑에서 밀려 다른 사람 점수를 누르게 된다.
   * 펼쳤을 때는 미리보기(약도·공략)를 높이가 고정된 영역으로 입력란 바로 위에 둔다: 입력 결과가 바로 보이면서 입력란은 움직이지 않는다.
   */
  function courseBlock(r, h, par) {
    var info = A.holeInfo(r, h), open = !!state.courseOpen;
    var html = '<div class="card course" id="course-card">' +
      '<button class="detail-head course-head" data-action="course-toggle" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="caret">' + (open ? '▾' : '▸') + '</span><span class="ttl">🗺️ ' + (h + 1) + '번홀 코스 정보</span>' +
      '<span class="sumtxt' + (r.course ? '' : ' none') + '" id="course-headsum">' + esc(r.course || '거리 · 형태 · 위험 요소 · 메모') + '</span></button>';
    html += '<div id="course-live" data-region="course-live">' + courseLive(r, h, par) + '</div>';
    if (open) {
      html += '<div class="course-edit">' +
        '<div class="field"><label>코스 이름 <span class="muted">(모든 홀 공통)</span></label><input type="text" data-course="name" value="' + esc(r.course || '') + '" maxlength="' + S.COURSE_MAX + '" placeholder="예: 베어크리크 포천 · 베어" autocomplete="off"></div>' +
        '<div class="row top"><div class="field"><label>' + (h + 1) + '번홀 거리 (m)</label><input type="number" inputmode="numeric" min="0" max="999" data-hi="dist" value="' + (info.dist || '') + '" placeholder="예: 350" class="short"></div>' +
        '<div class="field grow"><label>홀 형태</label><div class="seg sm">' + [['L', '좌 도그렉'], ['S', '직선'], ['R', '우 도그렉']].map(function (o) {
          return '<button type="button" data-action="hi-shape" data-v="' + o[0] + '" class="' + (info.shape === o[0] ? 'active' : '') + '">' + o[1] + '</button>';
        }).join('') + '</div></div></div>' +
        '<div class="field"><label>위험 요소 <span class="muted">(해당하는 것 모두)</span></label><div class="chips">' + A.HAZ_LABELS.map(function (e) {
          return '<button class="chip tap ' + (info.haz & e[0] ? 'active' : '') + '" data-action="hi-haz" data-bit="' + e[0] + '">' + e[1] + '</button>';
        }).join('') + '</div></div>' +
        '<div class="field"><label>공략 메모</label><input type="text" data-hi="memo" value="' + esc(info.memo) + '" maxlength="' + S.MEMO_MAX + '" placeholder="예: 티샷은 우측 벙커 방향, 그린 뒤는 내리막" autocomplete="off"></div>' +
        '<div class="row" id="course-actions" style="flex-wrap:wrap">' + courseActions(r) + '</div></div>';
    }
    if (open) html += '<div class="muted small" style="margin-top:8px">입력한 내용은 함께 입력 중인 동반자 화면에도 바로 반영돼요. 라운드를 마치면 고친 내용이 코스에 저장돼 다음 라운드에서 그대로 불러올 수 있어요.</div>';
    return html + '</div>';
  }
  /** 코스 이름·거리·메모 입력: 저장하고, 입력란은 그대로 둔 채 요약 줄·공략·약도(이름이면 버튼 줄도)만 다시 그린다 */
  function courseInput(el) {
    var r = state.round; if (!r || state.readOnly) return;
    var h = r.currentHole, isName = el.dataset.course === 'name';
    if (isName) S.setKey(r, 'course', el.value);
    else if (el.dataset.hi === 'dist') setHoleInfo(r, h, 'dist', el.value === '' ? null : Number(el.value));
    else if (el.dataset.hi === 'memo') setHoleInfo(r, h, 'memo', el.value);
    else return;
    save();
    var set = function (id, html) { var n = document.getElementById(id); if (n) n.innerHTML = html; return n; };
    set('course-live', courseLive(r, h, r.pars[h]));
    set('course-sum', courseSumInner(r, h));
    if (isName) {
      set('course-actions', courseActions(r));
      var hs = set('course-headsum', esc(r.course || '거리 · 형태 · 위험 요소 · 메모'));
      if (hs) hs.className = 'sumtxt' + (r.course ? '' : ' none');
    }
  }
  /** 기기에 코스 저장 (이름 + 홀 수 기준으로 덮어씀). 새 라운드에서 같은 이름을 고르면 파·핸디캡·홀 정보가 채워진다 */
  function saveCourse(r) {
    var name = (r.course || '').trim(); if (!name) return false;
    state.courses = (state.courses || []).filter(function (c) { return !(c.name === name && c.holes === r.holes); });
    state.courses.unshift({ name: name, holes: r.holes, pars: r.pars.slice(), strokeIndex: r.strokeIndex.slice(), holeInfo: clone(r.holeInfo || {}), updatedAt: Date.now() });
    if (state.courses.length > 30) state.courses.length = 30;
    return true;
  }
  function savedCourse(name, holes) {
    name = (name || '').trim();
    return (state.courses || []).filter(function (c) { return c && c.name === name && c.holes === holes; })[0] || null;
  }
  function builtinCourse(name, holes) {
    name = (name || '').trim();
    return BUILTIN_COURSES.filter(function (c) { return c.name === name && c.holes === holes; })[0] || null;
  }
  /** 파·핸디캡·홀 정보가 같은지 비교하기 위한 서명 */
  function courseSig(c) {
    var out = [], pars = c.pars || [], si = c.strokeIndex || [];
    for (var h = 0; h < c.holes; h++) { var i = A.holeInfo(c, h); out.push([Number(pars[h]), Number(si[h]), i.dist, i.shape, i.haz, i.memo]); }
    return JSON.stringify(out);
  }
  /**
   * 라운드를 기록으로 보낼 때의 자동 저장. '이 코스 저장' 버튼과 달리 저장해 둔 코스를 통째로 덮어쓰지 않는다.
   *  - 같은 이름으로 저장한 코스가 없으면 새로 저장한다. 단, 기본 제공 코스와 내용이 같으면 사본을 만들지 않는다
   *    (사본이 생기면 기본 제공 코스를 가려서, 나중에 기본 코스가 바로잡혀도 반영되지 않는다).
   *  - 저장한 코스가 있으면 이번 라운드에서 실제로 고친 칸만 반영한다 (그 칸의 수정 시각이 라운드 생성 시각보다 뒤인 것).
   *    코스를 불러오지 않고 이름만 적은 라운드나 다른 사람이 만든 라운드에 참여한 경우에도 내가 저장해 둔 파·거리·메모가 지워지지 않는다.
   */
  function autoSaveCourse(r) {
    var name = (r.course || '').trim(); if (!name) return;
    var old = savedCourse(name, r.holes);
    if (!old || !Array.isArray(old.pars) || old.pars.length !== r.holes || !Array.isArray(old.strokeIndex) || old.strokeIndex.length !== r.holes) {
      var bi = old ? null : builtinCourse(name, r.holes);
      if (bi && courseSig(bi) === courseSig(r)) return;
      saveCourse(r); return;
    }
    var rev = r.rev || {}, t0 = r.createdAt || 0, n = 0;
    function edited(k) { return !!rev[k] && rev[k].ts > t0; }
    old.holeInfo = old.holeInfo || {};
    for (var h = 0; h < r.holes; h++) {
      if (edited('par:' + h) && old.pars[h] !== r.pars[h]) { old.pars[h] = r.pars[h]; n++; }
      if (edited('si:' + h) && old.strokeIndex[h] !== r.strokeIndex[h]) { old.strokeIndex[h] = r.strokeIndex[h]; n++; }
      var cur = A.holeInfo(r, h), info = Object.assign({}, old.holeInfo[h] || {}), before = JSON.stringify(info);
      S.HOLE_FIELDS.forEach(function (f) { if (edited('hi:' + h + ':' + f)) { if (cur[f]) info[f] = cur[f]; else delete info[f]; } });
      var mask = A.holeInfo(old, h).haz;
      S.HAZ_BITS.forEach(function (bit) { if (edited('hi:' + h + ':z' + bit)) mask = (cur.haz & bit) ? (mask | bit) : (mask & ~bit); });
      if (mask) info.haz = mask; else delete info.haz;
      if (JSON.stringify(info) === before) continue;
      n++;
      if (Object.keys(info).length) old.holeInfo[h] = info; else delete old.holeInfo[h];
    }
    if (n) old.updatedAt = Date.now();
    state.courses = [old].concat(state.courses.filter(function (c) { return c !== old; })); // 최근에 친 코스가 앞에 오도록
  }
  /** 고를 수 있는 코스: 내가 저장한 코스가 먼저, 그다음 기본 제공 코스(같은 이름을 저장했다면 내 것이 우선) */
  function courseList(holes) {
    var mine = (state.courses || []).filter(function (c) { return c && c.holes === holes; });
    var names = {}; mine.forEach(function (c) { names[c.name] = 1; });
    return mine.concat(BUILTIN_COURSES.filter(function (c) { return c.holes === holes && !names[c.name]; }));
  }
  function isBuiltinCourse(name, holes) {
    name = (name || '').trim();
    return !(state.courses || []).some(function (c) { return c.name === name && c.holes === holes; }) && BUILTIN_COURSES.some(function (c) { return c.name === name && c.holes === holes; });
  }
  function findCourse(name, holes) {
    name = (name || '').trim();
    var list = courseList(holes);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.name === name && c.holes === holes && Array.isArray(c.pars) && c.pars.length === holes && Array.isArray(c.strokeIndex) && c.strokeIndex.length === holes) return c;
    }
    return null;
  }

  /** 입력 화면의 코치 카드: 내가 누구인지 정했으면 내 메시지, 아니면 플레이어별 한 줄 */
  function coachCard(r) {
    if (!r.players.some(function (p) { return runningTotal(r, p.id).played > 0; })) return '';
    var stt = A.roundStatus(r), me = myPid(), body;
    if (me) {
      var c = A.coach(r, me, stt);
      body = '<div class="coachline"><span class="ic">👏</span><span>' + esc(c.cheer) + '</span></div>' +
        (c.tips[0] ? '<div class="coachline"><span class="ic">💡</span><span>' + esc(c.tips[0]) + '</span></div>' : '');
    } else {
      body = r.players.filter(function (p) { return stt.stats[p.id].played > 0; }).map(function (p) {
        return '<div class="coachline"><span class="who">' + esc(p.name) + '</span><span>' + esc(A.coach(r, p.id, stt).lead) + '</span></div>';
      }).join('');
    }
    return '<div class="card coach"><h2>🧢 코치 한마디 <span class="hint">' + (me ? esc(nameOf(r, me)) + '님께' : '플레이어별') + '</span></h2><div class="stack">' + body + '</div>' +
      '<button class="btn sm ghost" style="margin-top:8px" data-action="go" data-view="analysis">📊 경기 분석 보기</button></div>';
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
    var items = [['play', '✏️', '스코어 입력'], ['board', '🏆', '리더보드'], ['analysis', '📊', '분석'], ['card', '📋', '스코어카드']];
    if (state.readOnly) items = items.slice(1);
    return '<nav class="bottomnav"><div class="inner">' + items.map(function (it) {
      return '<button data-action="go" data-view="' + it[0] + '" class="' + (active === it[0] ? 'active' : '') + '"><span class="ic">' + it[1] + '</span>' + it[2] + '</button>';
    }).join('') + '</div></nav>';
  }
  function moneyChip(key, enabled, blocked) {
    // blocked: 켜져 있지만 조건(팀 구성 등)이 맞지 않아 정산에 실제로는 반영되지 않는 상태
    var label = enabled ? (blocked ? '정산 포함 (조건 미충족)' : '₩ 정산 포함') : '정산 제외';
    var cls = 'chip sm ' + (enabled && !blocked ? 'active' : '');
    if (state.readOnly) return '<span class="' + cls + '">' + label + '</span>';
    return '<button class="' + cls + '" data-action="toggle-money" data-key="' + key + '" title="이 게임의 금액을 정산에 포함">' + label + '</button>';
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
      var failed = syncStatus === 'failed' || syncStatus === 'nolib' || syncStatus === 'nocrypto' || syncStatus === 'error';
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
        (isHost() ? '<button class="btn block danger" data-action="end-sharing" ' + (syncStatus === 'connected' ? '' : 'disabled title="연결된 상태에서만 가능"') + '>공유 종료 (모두 끊고 서버에서 삭제)</button>' : '') + '</div>';
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
      '<div class="field"><label>코스 <span class="muted">(선택)</span></label><input type="text" data-bind="draft.course" value="' + esc(d.course || '') + '" placeholder="예: 베어크리크 포천 · 베어" maxlength="' + S.COURSE_MAX + '" autocomplete="off">' +
      (function () {
        var list = courseList(d.holes);
        if (!list.length) return '';
        return '<div class="chips" style="margin-top:6px"><span class="small muted">코스 불러오기</span>' + list.map(function (c) {
          return '<button class="chip tap ' + ((d.course || '').trim() === c.name ? 'active' : '') + '" data-action="pick-course" data-name="' + esc(c.name) + '">' + esc(c.name) + '</button>';
        }).join('') + '</div>';
      })() + '</div>' +
      '<div class="muted small">' + (findCourse(d.course, d.holes) ? (isBuiltinCourse(d.course, d.holes) ? '공개 자료를 정리한 기본 제공 코스예요. 파·핸디캡·거리(화이트티)가 채워지고, 현장 스코어카드와 다르면 입력 화면에서 바로 고칠 수 있어요.' : '내가 저장한 코스의 파·핸디캡·홀 정보로 시작해요. <button class="btn sm ghost" data-action="del-course">' + (builtinCourse(d.course, d.holes) ? '기본 제공 값으로 되돌리기' : '저장한 코스 삭제') + '</button>') : '파/핸디캡 인덱스는 기본값(파72)으로 시작하고, 스코어 입력 화면에서 홀마다 파·거리·위험 요소·메모를 넣을 수 있어요.') + '</div></div></div>';
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
      return { id: p.id || uid(), name: p.name.trim().slice(0, 20), hcp: Math.max(0, Math.min(54, Math.round(Number(p.hcp)) || 0)), team: p.team || '' };
    });
    var scores = {};
    players.forEach(function (p) { scores[p.id] = new Array(d.holes).fill(null); });
    var now = Date.now();
    clearScan(); closeSession();
    var txt = function (s) { return String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(); }; // 붙여 넣은 글에 섞인 탭 등 제어 문자는 공백으로
    var cname = txt(d.course).slice(0, S.COURSE_MAX), saved = findCourse(cname, d.holes); // 저장된 코스면 파·핸디캡·홀 정보를 불러옴
    state.round = {
      id: uid(), name: (txt(d.name) || cname || ('라운드 ' + d.date)).slice(0, 60), date: d.date, holes: d.holes,
      pars: saved ? saved.pars.slice() : G.defaultPars(d.holes), strokeIndex: saved ? saved.strokeIndex.slice() : G.defaultStrokeIndex(d.holes),
      course: cname, holeInfo: saved ? clone(saved.holeInfo || {}) : {}, stats: {},
      players: players, scores: scores, extras: {}, games: clone(d.games), status: 'live', rev: {}, currentHole: 0, createdAt: now
    };
    if (saved) state.round.courseFrom = cname; // 이 기기에서 불러온 코스로 시작함 (기기 전용 표시, 공유되지 않음)
    // 처음 넣는 값(이름·코스·불러온 파/핸디캡/홀 정보)도 공유 수신 측(setKey)과 같은 규칙으로 정규화 → 호스트와 참여자가 같은 값을 갖도록
    S.allKeys(state.round).forEach(function (k) { if (k === 'meta') return; var v = S.getKey(state.round, k); if (v !== undefined) S.setKey(state.round, k, v); });
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
    // data-region: 입력란에 커서가 있는 동안에도 따로 갱신할 수 있는 영역 (softRender → patchRegions)
    var html = '<div data-region="top" style="display:contents">' + topbar(r.name, (h + 1) + '/' + r.holes + '홀', backBtn('home'), statusPill('play') + '<button class="iconbtn" data-action="go" data-view="settings">⚙︎</button>') + '</div>';
    html += '<div class="screen">';
    html += '<div data-region="banner" style="display:contents">' + finishedBanner(r) + meChooser(r) + '</div>';
    // 점수 칸 위쪽은 내용이 바뀌어도 높이가 변하지 않게 유지한다 (높이가 변하면 ＋/− 버튼이 밀려 다른 사람 점수를 누르게 됨)
    html += '<div class="card" data-region="head"><div class="holehead"><div class="num">' + (h + 1) + '<small>번홀</small></div><div class="meta">' +
      '<div class="row"><span class="small muted">파</span>' + seg('round.pars.' + h, par, [[3, '3'], [4, '4'], [5, '5']]) +
      '<span class="si" style="margin-left:auto">HCP <input type="number" inputmode="numeric" min="1" max="' + r.holes + '" data-bind="round.strokeIndex.' + h + '" data-type="number" value="' + r.strokeIndex[h] + '"></span></div>' +
      '</div></div>';
    html += '<div class="hole-strip">' + holeStrip(r, h) + '</div>';
    html += '<button class="course-sum" id="course-sum" data-action="course-jump" aria-label="이 홀 코스 정보 보기">' + courseSumInner(r, h) + '</button>';
    html += '</div>';
    var mode = entryMode(r), open = state.detailOpen || {};
    html += '<div class="card" data-region="scores">' + entryBar(r, me, mode) + r.players.map(function (p) {
      var s = G.gross(r, p.id, h);
      var st = sm[p.id][h];
      var tot = runningTotal(r, p.id);
      var diff = s === null ? null : s - par;
      var pid = esc(p.id);
      var editable = canEdit(r, p.id);
      var tags = statTags(r, p.id, h); // 줄 높이에 영향을 주지 않도록 이름·누적 타수 아래 여백에 겹쳐 그린다
      var row = '<div class="scorerow ' + (me === p.id ? 'mine' : '') + (editable ? '' : ' locked') + '">' +
        '<div class="who"><div class="name">' + badge(p.team) + '<span>' + esc(p.name) + '</span></div>' +
        '<div class="meta"><span>' + tot.gross + '타</span><span class="tp ' + tpClass(tot.toPar) + '">' + G.fmtToPar(tot.toPar) + '</span>' +
        (p.hcp ? '<span>H' + esc(p.hcp) + '</span>' : '') + (st ? '<span class="dots" title="이 홀 핸디 타수">' + '●'.repeat(st) + '</span>' : '') + '</div>' + (tags ? '<div class="tags">' + tags + '</div>' : '') + '</div>';
      if (editable) {
        row += '<button class="pm" data-action="score" data-pid="' + pid + '" data-delta="-1">−</button>' +
          '<button class="scorebox ' + (s !== null ? 'set' : '') + '" data-action="score-tap" data-pid="' + pid + '">' +
          (s === null ? '<span class="v empty">파 ' + par + '</span><span class="l">탭하여 입력</span>'
            : '<span class="v">' + s + '</span><span class="l ' + tpClass(diff) + '">' + G.toParLabel(diff) + '</span><span class="x" data-action="score-clear" data-pid="' + pid + '">×</span>') +
          '</button>' +
          '<button class="pm" data-action="score" data-pid="' + pid + '" data-delta="1">＋</button>';
      } else { // 내 점수만 모드: 다른 사람 점수는 실시간으로 보이기만 함
        row += '<span></span><div class="scorebox ro ' + (s !== null ? 'set' : '') + '" data-pid="' + pid + '">' +
          (s === null ? '<span class="v empty">–</span><span class="l">입력 전</span>' : '<span class="v">' + s + '</span><span class="l ' + tpClass(diff) + '">' + G.toParLabel(diff) + '</span>') +
          '</div><span></span>';
      }
      row += '</div>';
      if (editable && state.detailOn) row += detailBlock(r, p, h, par, !!open[p.id]);
      return row;
    }).join('');
    html += '<div class="quick" style="margin-top:10px">' +
      (mode === 'all' ? '<button class="btn sm grow" data-action="par-all">전원 파 입력</button><button class="btn sm ghost" data-action="clear-hole">홀 초기화</button>' : '') +
      '<button class="btn sm ' + (state.detailOn ? 'on' : '') + (mode === 'all' ? '' : ' grow') + '" data-action="toggle-detail" aria-pressed="' + (state.detailOn ? 'true' : 'false') + '">📝 상세 기록' + (state.detailOn ? ' 끄기' : '') + '</button></div>';
    if (mode === 'mine') html += '<div class="muted small" style="margin-top:8px">다른 사람 점수는 각자 입력하면 여기에 바로 보여요. 폰이 없는 동반자 점수는 위에서 <b>모두 입력</b>으로 바꿔 넣을 수 있어요.</div>';
    if (!sharingActive() && holesDone(r) < 2 && !state.hintSeen) html += '<div class="muted small" style="margin-top:8px">동반자도 각자 입력하게 하려면 맨 위의 <b>👥 함께</b>를 눌러 코드를 보내세요. <button class="btn sm ghost" data-action="dismiss-hint">닫기</button></div>';
    html += '</div>';
    html += courseBlock(r, h, par);
    html += '<div data-region="coach" style="display:contents">' + coachCard(r) + '</div>';
    var ex = (r.extras && r.extras[h]) || {};
    html += '<div class="card" data-region="extras"><h2>니어 / 롱기 <span class="hint">받는 사람 선택 (선택)</span></h2><div class="stack">' +
      '<div class="chips"><span class="small muted blab">니어리스트</span>' + r.players.map(function (p) {
        return '<button class="chip accent ' + (ex.nearest === p.id ? 'active' : '') + '" data-action="extra" data-type="nearest" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>' +
      '<div class="chips"><span class="small muted blab">롱기스트</span>' + r.players.map(function (p) {
        return '<button class="chip accent ' + (ex.longest === p.id ? 'active' : '') + '" data-action="extra" data-type="longest" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }).join('') + '</div>' +
      '</div></div>';
    html += '<div data-region="summary" style="display:contents">' + liveSummary(r) + '</div>';
    html += '<div class="navbtns" data-region="nav"><button class="btn" data-action="hole" data-i="' + (h - 1) + '" ' + (h === 0 ? 'disabled' : '') + '>‹ 이전 홀</button>' +
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
    if (r.players.length >= 4 || !all.vegas.error || all.vegas.enabled) tabs.push(['vegas', '라스베가스']);
    tabs.push(['bonus', '보너스'], ['settle', '💰 정산']);
    var tab = tabs.some(function (t) { return t[0] === state.boardTab; }) ? state.boardTab : 'stroke';
    var html = topbar(r.name, state.readOnly ? '기록' : holesDone(r) + '/' + r.holes + '홀', backBtn('home'), state.readOnly ? '' : statusPill('board') + '<button class="iconbtn" data-action="go" data-view="settings">⚙︎</button>');
    html += '<div class="screen">';
    html += finishedBanner(r);
    html += '<div class="tabs">' + tabs.map(function (t) {
      var g0 = all[t[0]], en = g0 && g0.enabled;
      // ₩ 표시는 실제로 정산에 합산되는 게임에만 (켜져 있어도 조건 미충족으로 제외되면 표시하지 않음)
      var inc = t[0] === 'bonus' ? !!(en && (en.nearest || en.longest || en.birdie)) : t[0] === 'stroke' ? r.games.stroke.unit > 0 : !!(en && !g0.error);
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
    var head = '<h2>스킨스 ' + moneyChip('skins', res.enabled, !!res.error) + '<span class="hint">' + (r.games.skins.mode === 'team' ? '팀' : '개인') + (res.unit ? ' · 스킨당 ' + won(res.unit) : '') + (res.net ? ' · 네트' : '') + '</span></h2>';
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
    var head = '<h2>매치 플레이 ' + moneyChip('match', res.enabled, !!res.error) + '<span class="hint">' + (r.games.match.mode === 'team' ? '팀' : '개인 리그') + (res.unit ? ' · 홀당 ' + won(res.unit) : '') + (res.net ? ' · 네트' : '') + '</span></h2>';
    if (res.error) return '<div class="card">' + head + '</div>' + teamHint(res.error + '. 설정에서 "방식"을 개인으로 바꾸거나 2팀을 지정하세요.');
    return '<div class="card">' + head + '<div class="stack">' +
      res.matches.map(function (m) { return matchBox(m, m.status, m.money && res.enabled ? won(m.money) : null); }).join('') +
      '</div><div class="muted small" style="margin-top:8px"><span style="color:var(--team-A)">■</span> 왼쪽 승 &nbsp;<span style="color:var(--team-B)">■</span> 오른쪽 승 &nbsp;<span style="color:#cbd5d0">■</span> 무승부. 금액은 매치 종료 시 홀 차 × 단가로 확정됩니다.</div></div>';
  }

  function tabNassau(r, all) {
    var res = all.nassau;
    var head = '<h2>나소 ' + moneyChip('nassau', res.enabled, !!res.error) + '<span class="hint">' + (r.games.nassau.mode === 'team' ? '팀' : '개인') + (res.unit ? ' · 판당 ' + won(res.unit) : '') + '</span></h2>';
    if (res.error) return '<div class="card">' + head + '</div>' + teamHint(res.error + '.');
    return '<div class="card">' + head + '</div>' + res.matches.map(function (m) {
      return '<div class="card"><h2>' + esc(m.a.name) + ' vs ' + esc(m.b.name) + '</h2><div class="stack">' +
        m.segments.map(function (s) { return '<div class="small muted" style="margin-bottom:-4px">' + esc(s.name) + '</div>' + matchBox(m, s.status, s.money && res.enabled ? won(s.money) : null); }).join('') + '</div></div>';
    }).join('');
  }

  function tabBestball(r, all) {
    var res = all.bestball;
    var head = '<h2>베스트볼 ' + moneyChip('bestball', res.enabled, !!res.error) + '<span class="hint">베스트 ' + res.count + (res.net ? ' · 네트' : '') + (res.unit ? ' · 홀당 ' + won(res.unit) : '') + '</span></h2>';
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
    var head = '<h2>라스베가스 ' + moneyChip('vegas', res.enabled, !!res.error) + '<span class="hint">' + (res.unit ? '점당 ' + won(res.unit) : '') + '</span></h2>';
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

  // ───────────────────────── 경기 분석 ─────────────────────────
  // 스코어 분포 색: 파를 중립 회색으로 두고 언더파(붉은색)와 오버파(푸른색 단계)를 양쪽으로 나눈 분기형 팔레트
  var DIST = [
    { k: 'birdie', label: '버디 이하', bg: '#e34948', ink: '#ffffff' },
    { k: 'par', label: '파', bg: '#e4e3dd', ink: '#16211b' },
    { k: 'bogey', label: '보기', bg: '#86b6ef', ink: '#16211b' },
    { k: 'double', label: '더블', bg: '#2a78d6', ink: '#ffffff' },
    { k: 'triple', label: '트리플+', bg: '#104281', ink: '#ffffff' }
  ];
  function tile(label, value, sub) {
    return '<div class="tile"><div class="tl">' + label + '</div><div class="tv">' + value + '</div>' + (sub ? '<div class="ts">' + sub + '</div>' : '') + '</div>';
  }
  function statusCard(r, stt) {
    var act = stt.players.filter(function (p) { return p.played > 0; });
    if (!act.length) return '<div class="card"><h2>경기 현황</h2><div class="muted">아직 입력된 스코어가 없어요. 스코어를 입력하면 순위와 분석이 여기에 나와요.</div></div>';
    var me = myPid();
    var rows = act.map(function (p) {
      return '<tr class="' + (me === p.id ? 'me' : '') + '"><td>' + (p.rank || '-') + '</td><td class="l">' + badge(p.team) + ' ' + esc(p.name) + '</td><td>' + p.played + '홀</td><td>' + p.gross + '</td>' +
        '<td class="' + tpClass(p.toPar) + '"><b>' + G.fmtToPar(p.toPar) + '</b></td><td class="muted">' + (p.gap ? p.gap + '타 차' : (act.length > 1 ? '선두' : '')) + '</td></tr>';
    }).join('');
    var notes = [];
    if (stt.hot) notes.push('🔥 최근 3홀 흐름이 가장 좋은 사람은 <b>' + esc(stt.hot.name) + '</b> (' + G.fmtToPar(stt.hot.toPar) + ')');
    if (stt.hardest) notes.push('⛰️ 가장 어려웠던 홀은 <b>' + (stt.hardest.h + 1) + '번홀</b> (평균 ' + A.fmtAvg(stt.hardest.avg) + ')');
    if (stt.easiest) notes.push('🌿 가장 쉬웠던 홀은 <b>' + (stt.easiest.h + 1) + '번홀</b> (평균 ' + A.fmtAvg(stt.easiest.avg) + ')');
    if (!stt.even) notes.push('입력한 홀이 서로 달라 순위는 참고용이에요.');
    return '<div class="card"><h2>' + (stt.finished ? '최종 결과' : '경기 현황') + ' <span class="hint">' + (stt.thruAll === r.holes ? r.holes + '홀 종료' : '전원 입력 ' + stt.thruAll + '/' + r.holes + '홀') + '</span></h2>' +
      '<table><thead><tr><th></th><th class="l">플레이어</th><th>진행</th><th>타수</th><th>±</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (notes.length ? '<div class="stack small" style="margin-top:10px">' + notes.map(function (n) { return '<div>' + n + '</div>'; }).join('') + '</div>' : '') + '</div>';
  }
  function distBar(st) {
    var parts = DIST.filter(function (d) { return st.dist[d.k] > 0; });
    var aria = DIST.map(function (d) { return d.label + ' ' + st.dist[d.k] + '홀'; }).join(', ');
    return '<div class="segbar" role="img" aria-label="스코어 분포: ' + aria + '">' + parts.map(function (d) {
      var n = st.dist[d.k], pct = n / st.played * 100;
      return '<div style="flex:' + n + ' 1 0;background:' + d.bg + ';color:' + d.ink + '" title="' + d.label + ' ' + n + '홀 (' + Math.round(pct) + '%)">' + (pct >= 9 ? n : '') + '</div>';
    }).join('') + '</div><div class="legend">' + DIST.map(function (d) { return '<span><i style="background:' + d.bg + '"></i>' + d.label + '</span>'; }).join('') + '</div>';
  }
  /** 누적 스코어 흐름: 선택한 플레이어만 강조색, 나머지는 회색. 홀을 누르면 아래에 그 홀의 기록이 나옴 */
  function trendChart(r, stt, sel) {
    var order = stt.order, n = order.length;
    var series = r.players.map(function (p) {
      var pos = {}; stt.stats[p.id].seq.forEach(function (e) { pos[e.h] = e; });
      var pts = []; order.forEach(function (h, i) { if (pos[h]) pts.push({ i: i, v: pos[h].cum, e: pos[h] }); });
      return { id: p.id, name: p.name, pts: pts, at: pos };
    }).filter(function (s) { return s.pts.length; });
    if (!series.length) return '';
    var lo = 0, hi = 0;
    series.forEach(function (s) { s.pts.forEach(function (pt) { if (pt.v < lo) lo = pt.v; if (pt.v > hi) hi = pt.v; }); });
    var span = Math.max(4, hi - lo), step = span <= 8 ? 2 : span <= 20 ? 5 : 10;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi === lo) hi = lo + step;
    var W = 340, H = 176, L = 30, R = 30, T = 10, B = 22;
    function x(i) { return L + (n > 1 ? i * (W - L - R) / (n - 1) : 0); }
    function y(v) { return T + (hi - v) * (H - T - B) / (hi - lo); }
    var svg = '';
    for (var t = lo; t <= hi; t += step) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '" stroke="' + (t === 0 ? '#c3c2b7' : '#e1e0d9') + '" stroke-width="1"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end" class="ax">' + G.fmtToPar(t) + '</text>';
    }
    var ticks = n === 18 ? [0, 4, 8, 9, 13, 17] : [0, 2, 4, 6, 8];
    ticks.forEach(function (i) { if (i < n) svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="ax">' + (order[i] + 1) + '</text>'; });
    function path(s, color, width) {
      if (s.pts.length === 1) return '<circle cx="' + x(s.pts[0].i).toFixed(1) + '" cy="' + y(s.pts[0].v).toFixed(1) + '" r="3" fill="' + color + '"/>';
      return '<polyline fill="none" stroke="' + color + '" stroke-width="' + width + '" stroke-linejoin="round" stroke-linecap="round" points="' + s.pts.map(function (pt) { return x(pt.i).toFixed(1) + ',' + y(pt.v).toFixed(1); }).join(' ') + '"/>';
    }
    var mine = null;
    series.forEach(function (s) { if (s.id === sel) mine = s; else svg += path(s, '#c9c8c0', 2); });
    var cur = typeof state.anHole === 'number' && state.anHole >= 0 && state.anHole < n ? state.anHole : null;
    if (cur !== null) svg += '<line x1="' + x(cur).toFixed(1) + '" x2="' + x(cur).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#898781" stroke-width="1"/>';
    if (mine) {
      var end = mine.pts[mine.pts.length - 1];
      svg += path(mine, '#1d6b3a', 2) +
        '<circle cx="' + x(end.i).toFixed(1) + '" cy="' + y(end.v).toFixed(1) + '" r="5" fill="#1d6b3a" stroke="#ffffff" stroke-width="2"/>' +
        '<text x="' + (x(end.i) + 8).toFixed(1) + '" y="' + (y(end.v) + 4).toFixed(1) + '" class="lbl">' + G.fmtToPar(end.v) + '</text>';
    }
    if (cur !== null) series.forEach(function (s) {
      var e = s.at[order[cur]]; if (!e) return;
      svg += '<circle cx="' + x(cur).toFixed(1) + '" cy="' + y(e.cum).toFixed(1) + '" r="4" fill="' + (s.id === sel ? '#1d6b3a' : '#a9a8a0') + '" stroke="#ffffff" stroke-width="2"/>';
    });
    var bw = n > 1 ? (W - L - R) / (n - 1) : 20;
    for (var i = 0; i < n; i++) {
      svg += '<rect x="' + (x(i) - bw / 2).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + H + '" fill="transparent" data-action="an-hole" data-i="' + i + '"><title>' + (order[i] + 1) + '번홀</title></rect>';
    }
    var readout;
    if (cur === null) readout = '<div class="muted small">그래프에서 홀을 누르면 그 홀의 기록이 보여요.</div>';
    else {
      var hh = order[cur];
      var lines = series.map(function (s) { return { s: s, e: s.at[hh] }; }).filter(function (o) { return o.e; }).sort(function (a, b) { return a.e.cum - b.e.cum; }).map(function (o) {
        return '<div class="ro-row"><i class="key" style="background:' + (o.s.id === sel ? '#1d6b3a' : '#c9c8c0') + '"></i><b>' + G.fmtToPar(o.e.cum) + '</b><span>' + esc(o.s.name) + '</span><span class="muted">' + o.e.gross + '타 · ' + G.toParLabel(o.e.diff) + '</span></div>';
      }).join('');
      readout = '<div class="readout"><div class="small"><b>' + (hh + 1) + '번홀</b> <span class="muted">파' + r.pars[hh] + ' · 누적 기준</span></div>' + (lines || '<div class="muted small">이 홀의 기록이 없어요.</div>') + '</div>';
    }
    var legend = '<div class="legend"><span><i class="line" style="background:#1d6b3a"></i>' + esc(nameOf(r, sel)) + '</span>' + (series.length > (mine ? 1 : 0) ? '<span><i class="line" style="background:#c9c8c0"></i>다른 플레이어</span>' : '') + '</div>';
    return '<div class="card"><h2>스코어 흐름 <span class="hint">누적 ± (낮을수록 좋음)</span></h2>' + legend +
      '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="홀별 누적 스코어 흐름 그래프">' + svg + '</svg></div>' + readout +
      '<div class="muted small" style="margin-top:6px">홀별 타수 표는 <button class="linkbtn" data-action="go" data-view="card">스코어카드</button>에서 볼 수 있어요.</div></div>';
  }
  /** 분석용 경기 현황: 기록(지난 라운드)으로 보는 라운드는 홀이 덜 채워졌어도 끝난 라운드로 본다 (종료를 누르지 않고 보관된 라운드 포함) */
  function analysisStatus(r) { return A.roundStatus(r, { archived: state.readOnly || r !== state.round }); }
  /** 18홀 출발 홀: 기본은 입력 순서로 추정(자동). 지난 홀을 나중에 몰아서 입력해 순서가 틀리게 잡히면 직접 고를 수 있다 (이 기기에만 저장) */
  function startSeg(r, stt) {
    var cur = r.startBack === true ? 'in' : r.startBack === false ? 'out' : 'auto';
    var opts = [['auto', cur === 'auto' ? '자동 (' + (stt.startBack ? '10번홀' : '1번홀') + ')' : '자동'], ['out', '1번홀'], ['in', '10번홀']];
    return '<div class="row between" style="margin-top:10px;flex-wrap:wrap"><span class="small muted">출발 홀</span><div class="seg sm">' + opts.map(function (o) {
      return '<button type="button" data-action="an-start" data-v="' + o[0] + '" class="' + (cur === o[0] ? 'active' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div></div>';
  }
  function playerAnalysis(r, stt, sel) {
    var st = stt.stats[sel], name = nameOf(r, sel), html = '';
    if (!st.played) return '<div class="card"><div class="muted">' + esc(name) + '님의 스코어가 아직 없어요. 스코어를 입력하면 분석이 시작돼요.</div></div>';
    var c = A.coach(r, sel, stt);
    html += '<div class="card coach"><h2>🧢 코치 한마디 <span class="hint">' + esc(name) + '님께</span></h2><div class="stack">' +
      c.cheers.slice(0, 2).map(function (t) { return '<div class="coachline"><span class="ic">👏</span><span>' + esc(t) + '</span></div>'; }).join('') +
      c.tips.map(function (t) { return '<div class="coachline"><span class="ic">💡</span><span>' + esc(t) + '</span></div>'; }).join('') + '</div></div>';
    var parOrBetter = st.dist.birdie + st.dist.par;
    html += '<div class="card"><h2>요약 <span class="hint">' + st.played + '홀 기준</span></h2><div class="tiles">' +
      tile('스코어', G.fmtToPar(st.toPar), st.gross + '타') +
      tile('파 이하', parOrBetter + '홀', Math.round(parOrBetter / st.played * 100) + '%') +
      tile('버디 이하', st.dist.birdie + '개', st.eagles ? '이글 ' + st.eagles + '개 포함' : '') +
      tile('더블 이상', st.doubles + '홀', st.lostToDoubles ? '보기였다면 −' + st.lostToDoubles + '타' : '') +
      tile('연속 파 이하', st.streakBest + '홀', '최장 기록') +
      tile('만회', st.bounce.chances ? st.bounce.made + '/' + st.bounce.chances : '-', '더블 이상 뒤 파 이하') + '</div>' +
      '<div class="small muted" style="margin-top:10px">가장 좋았던 홀: <b>' + (st.best.h + 1) + '번홀 ' + G.toParLabel(st.best.diff) + '</b> · 가장 아쉬운 홀: <b>' + (st.worst.h + 1) + '번홀 ' + G.toParLabel(st.worst.diff) + '</b></div></div>';
    html += '<div class="card"><h2>스코어 분포 <span class="hint">홀 수</span></h2>' + distBar(st) + '</div>';
    html += trendChart(r, stt, sel);
    var parRows = [3, 4, 5].filter(function (t) { return st.byPar[t].n; }).map(function (t) {
      var b = st.byPar[t];
      return '<tr><td class="l">파' + t + '</td><td>' + b.n + '홀</td><td>' + (t + b.toPar / b.n).toFixed(1) + '타</td><td><b>' + A.fmtAvg(b.toPar / b.n) + '</b></td><td>' + G.fmtToPar(b.toPar) + '</td></tr>';
    }).join('');
    html += '<div class="card"><h2>파별 성적</h2><table><thead><tr><th class="l"></th><th>홀 수</th><th>평균 타수</th><th>평균 ±</th><th>합계</th></tr></thead><tbody>' + parRows + '</tbody></table>' +
      (st.nines ? '<div class="tiles two" style="margin-top:10px">' + st.nines.map(function (nn) { return tile(nn.label, nn.n ? G.fmtToPar(nn.toPar) : '-', nn.n ? nn.n + '홀' : '아직 없음'); }).join('') + '</div>' + startSeg(r, stt) : '') + '</div>';
    var kv = [];
    if (st.detailHoles) {
      kv.push(['OB', st.ob ? st.ob + '회' : '없음']);
      kv.push(['해저드', st.hz ? st.hz + '회' : '없음']);
      if (st.penalty) kv.push(['벌타 추정', '약 ' + st.penalty + '타 <span class="muted small">(OB ' + A.OB_COST + '타 · 해저드 ' + A.HZ_COST + '타로 계산)</span>']);
      kv.push(['벙커', st.bk ? st.bk + '회' : '없음']);
      if (st.putts.holes) {
        kv.push(['퍼트', st.putts.total + '개 · 홀당 ' + (st.putts.total / st.putts.holes).toFixed(1) + '개 <span class="muted small">(' + st.putts.holes + '홀 기록)</span>']);
        kv.push(['1퍼트 / 3퍼트 이상', st.putts.one + '홀 / ' + st.putts.three + '홀']);
      }
      if (st.fw.chances) kv.push(['페어웨이 안착', st.fw.hit + '/' + st.fw.chances + ' (' + Math.round(st.fw.hit / st.fw.chances * 100) + '%)' + (st.fw.left + st.fw.right ? ' <span class="muted small">· 좌 ' + st.fw.left + ' · 우 ' + st.fw.right + '</span>' : '')]);
      if (st.gir.holes) kv.push(['파온', st.gir.hit + '/' + st.gir.holes + ' <span class="muted small">(퍼트를 기록한 홀 기준)</span>']);
    }
    if (st.nearest) kv.push(['니어리스트', st.nearest + '회']);
    if (st.longest) kv.push(['롱기스트', st.longest + '회']);
    html += '<div class="card"><h2>상세 기록 <span class="hint">' + (st.detailHoles ? st.detailHoles + '홀 기록' : '선택 입력') + '</span></h2>' +
      (kv.length ? '<div class="kv">' + kv.map(function (e) { return '<span class="k">' + e[0] + '</span><span>' + e[1] + '</span>'; }).join('') + '</div>' : '') +
      (st.detailHoles ? '<div class="muted small" style="margin-top:8px">스코어와 함께 기록한 홀만 집계해요.</div>'
        : '<div class="muted small"' + (kv.length ? ' style="margin-top:8px"' : '') + '>스코어 입력 화면의 <b>📝 상세 기록</b>을 켜면 OB·해저드·벙커·티샷 방향·퍼트를 홀마다 기록할 수 있고, 여기에 분석이 추가돼요.</div>') + '</div>';
    return html;
  }
  function compareCard(r, stt) {
    var act = stt.players.filter(function (p) { return p.played > 0; });
    if (act.length < 2) return '';
    var me = myPid();
    var rows = act.map(function (p) {
      var st = stt.stats[p.id], d = st.detailHoles > 0;
      return '<tr class="' + (me === p.id ? 'me' : '') + '"><td class="l">' + esc(p.name) + '</td><td><b>' + G.fmtToPar(st.toPar) + '</b></td><td>' + st.dist.birdie + '</td><td>' + st.dist.par + '</td><td>' + st.dist.bogey + '</td><td>' + (st.dist.double + st.dist.triple) + '</td>' +
        '<td>' + (d ? st.ob : '-') + '</td><td>' + (d ? st.hz : '-') + '</td><td>' + (st.putts.holes ? (st.putts.total / st.putts.holes).toFixed(1) : '-') + '</td></tr>';
    }).join('');
    return '<div class="card"><h2>함께 친 사람 비교</h2><div class="tablewrap"><table><thead><tr><th class="l">플레이어</th><th>±</th><th>버디↓</th><th>파</th><th>보기</th><th>더블+</th><th>OB</th><th>해저드</th><th>퍼트/홀</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="muted small" style="margin-top:8px">OB·해저드·퍼트는 상세 기록을 입력한 사람만 표시돼요.</div></div>';
  }
  function viewAnalysis() {
    var r = getRound();
    if (!r) { state.view = 'home'; return viewHome(); }
    var stt = analysisStatus(r), me = myPid();
    var first = stt.players[0];
    var sel = G.playerById(r, state.anPid) ? state.anPid : (me || (first && first.played ? first.id : r.players[0].id));
    var html = topbar(r.name, state.readOnly ? '기록 분석' : '경기 분석', backBtn('home'), state.readOnly ? '' : statusPill('analysis'));
    html += '<div class="screen">' + finishedBanner(r) + statusCard(r, stt);
    html += '<div class="chips" style="margin:2px 0 12px">' + r.players.map(function (p) {
      return '<button class="chip ' + (sel === p.id ? 'active' : '') + '" data-action="an-player" data-pid="' + esc(p.id) + '">' + esc(p.name) + (me === p.id ? ' (나)' : '') + '</button>';
    }).join('') + '</div>';
    html += playerAnalysis(r, stt, sel) + compareCard(r, stt);
    if (stt.players.some(function (p) { return p.played > 0; })) html += '<button class="btn block" data-action="share-analysis">분석 요약 복사 / 공유</button>';
    html += '</div>' + bottomNav('analysis');
    return html;
  }
  /** 단톡방 등에 붙여 넣을 분석 요약: 플레이어별 기록과 격려·팁 한 줄씩 */
  function analysisText(r) {
    var stt = analysisStatus(r);
    var lines = ['📊 ' + r.name + (r.course && r.name.indexOf(r.course) < 0 ? ' @ ' + r.course : '') + ' (' + r.date + ') ' + (stt.finished ? '라운드 분석' : '중간 분석') + (stt.thruAll < r.holes ? ' · 전원 입력 ' + stt.thruAll + '/' + r.holes + '홀' : ''), ''];
    if (!stt.even) lines.push('※ 입력한 홀이 서로 달라 순위는 참고용이에요.', '');
    stt.players.forEach(function (p) {
      if (!p.played) return;
      var st = stt.stats[p.id], c = A.coach(r, p.id, stt);
      var parts = [p.gross + '타(' + G.fmtToPar(p.toPar) + ')', '버디 ' + st.dist.birdie, '파 ' + st.dist.par, '보기 ' + st.dist.bogey, '더블+ ' + (st.dist.double + st.dist.triple)];
      if (st.ob) parts.push('OB ' + st.ob);
      if (st.hz) parts.push('해저드 ' + st.hz);
      if (st.putts.holes) parts.push('퍼트 홀당 ' + (st.putts.total / st.putts.holes).toFixed(1));
      lines.push((p.rank || '-') + '위 ' + p.name + ' — ' + parts.join(' · '));
      lines.push('  👏 ' + c.cheer);
      if (c.tips[0]) lines.push('  💡 ' + c.tips[0]);
      lines.push('');
    });
    return lines.join('\n').replace(/\n+$/, '');
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
  function viewHtml() {
    var views = { home: viewHome, setup: viewSetup, settings: viewSettings, play: viewPlay, board: viewBoard, card: viewCard, analysis: viewAnalysis, share: viewShare, joining: viewJoining };
    if (!views[state.view]) state.view = 'home';
    if ((state.view === 'play' || state.view === 'settings' || state.view === 'share') && !state.round) state.view = 'home';
    if (state.view === 'joining' && !state.joining) state.view = 'home';
    // 입력·설정·공유 화면은 항상 진행 중인 라운드를 다룬다. 지난 라운드 보기 표시가 남아 있으면 입력이 통째로 잠기므로 여기서 해제
    if (state.readOnly && (state.view === 'play' || state.view === 'settings' || state.view === 'share')) { state.readOnly = false; state.viewRoundId = null; }
    if (state.view === 'setup' && !state.draft) state.draft = newDraft();
    return views[state.view]();
  }
  function centerHoleStrip() {
    var strip = $app.querySelector('.hole-strip'), cur = strip && strip.querySelector('.cur');
    if (cur) strip.scrollLeft = Math.max(0, cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2);
  }
  function render() {
    var y = window.scrollY;
    $app.innerHTML = viewHtml();
    window.scrollTo(0, y);
    centerHoleStrip();
  }
  /** 다시 그린 뒤에도 방금 누른 버튼(sel)이 손가락 아래 그대로 있도록 스크롤을 맞춘다 (위쪽 내용이 늘거나 줄 때) */
  function renderKeeping(sel) {
    var a = $app.querySelector(sel), top0 = a ? a.getBoundingClientRect().top : null;
    render();
    var b = $app.querySelector(sel);
    if (top0 !== null && b) window.scrollBy(0, b.getBoundingClientRect().top - top0);
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
      if (state.round !== r) return; // 전송 대기 중 삭제/새 라운드/참여로 이미 다른 상태가 됨 → 건드리지 않음
      var wasShared = sharingActive();
      clearScan(); archiveCurrent();
      // 공유 중이던 라운드는 잠시 연결을 유지해 늦게 들어오는 수정(마지막 홀 등)을 기록에 반영
      if (wasShared && session) { clearTimeout(graceTimer); graceTimer = setTimeout(function () { closeSession(); }, 90000); }
      else closeSession();
      state.readOnly = true; state.viewRoundId = r.id; state.boardTab = 'settle';
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
    autoSaveCourse(r); // 코스 이름을 넣은 라운드는 코스 정보를 기기에 저장 (이미 저장해 둔 코스에는 이번 라운드에서 고친 칸만 반영)
    delete r.courseFrom;
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
      if (state.round) { clearScan(); closeSession(); archiveCurrent(); }
      var prev = state.history[0];
      state.draft = newDraft();
      if (prev) { // 지난 라운드 플레이어/게임 설정 재사용
        state.draft.players = prev.players.map(function (p) { return { id: uid(), name: p.name, hcp: p.hcp, team: p.team }; });
        state.draft.games = fillGames(clone(prev.games || {}));
        state.draft.holes = prev.holes;
        if (state.draft.holes !== 18) state.draft.games.nassau.enabled = false; // 나소는 18홀 전용
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
      if (d.path === 'draft.holes' && v !== 18 && state.draft && state.draft.games && state.draft.games.nassau) state.draft.games.nassau.enabled = false; // 나소 카드가 숨겨지므로 플래그도 해제
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
      if (!r.scores[d.pid] || !canEdit(r, d.pid)) return;
      var cur = r.scores[d.pid][h];
      var v = cur === null || cur === undefined ? r.pars[h] + delta : cur + delta;
      r.scores[d.pid][h] = Math.min(15, Math.max(1, v));
      save(); render();
    },
    'score-tap': function (d) {
      var r = state.round, h = r.currentHole;
      if (!r.scores[d.pid] || !canEdit(r, d.pid)) return;
      if (r.scores[d.pid][h] === null || r.scores[d.pid][h] === undefined) { r.scores[d.pid][h] = r.pars[h]; save(); render(); }
    },
    'score-clear': function (d, el, ev) { ev.stopPropagation(); var r = state.round; if (!r.scores[d.pid] || !canEdit(r, d.pid)) return; r.scores[d.pid][r.currentHole] = null; save(); render(); },
    'par-all': function () {
      var r = state.round, h = r.currentHole;
      r.players.forEach(function (p) { if (canEdit(r, p.id) && r.scores[p.id][h] === null) r.scores[p.id][h] = r.pars[h]; });
      save(); render();
    },
    'clear-hole': function () {
      var r = state.round, h = r.currentHole, all = entryMode(r) === 'all';
      r.players.forEach(function (p) {
        if (!canEdit(r, p.id)) return;
        r.scores[p.id][h] = null;
        Object.keys(S.STAT_FIELDS).forEach(function (f) { setStat(r, p.id, h, f, null); }); // 이 홀의 상세 기록도 함께 지움
      });
      if (all && r.extras && r.extras[h]) delete r.extras[h];
      save(); render();
    },
    // 상세 기록 (선택 입력)
    'toggle-detail': function () {
      state.detailOn = !state.detailOn;
      state.detailOpen = {};
      if (state.detailOn && myPid()) state.detailOpen[myPid()] = true; // 내 줄은 바로 펼침
      save(); renderKeeping('[data-action="toggle-detail"]'); // 버튼 위에 줄이 생기거나 사라져도 버튼은 제자리에
    },
    // 여러 사람의 상세 기록을 함께 펼쳐 둘 수 있다: 하나를 열 때 다른 줄을 접으면 누른 자리가 위로 밀려 엉뚱한 칸을 누르게 됨
    'detail-open': function (d) { var o = state.detailOpen = state.detailOpen || {}; if (o[d.pid]) delete o[d.pid]; else o[d.pid] = true; save(); render(); },
    stat: function (d) { // OB·해저드·벙커 횟수 ±1
      var r = state.round, f = d.f;
      if (!r || !G.playerById(r, d.pid) || !canEdit(r, d.pid) || (f !== 'ob' && f !== 'hz' && f !== 'bk')) return;
      var h = r.currentHole, cur = A.stat(r, d.pid, h, f) || 0;
      setStat(r, d.pid, h, f, Math.min(S.STAT_FIELDS[f].max, Math.max(0, cur + (Number(d.delta) > 0 ? 1 : -1))));
      save(); render();
    },
    'stat-set': function (d) { // 퍼트 수 · 페어웨이: 값을 눌러 정하고, 같은 값을 다시 누르면 지움
      var r = state.round, f = d.f;
      if (!r || !G.playerById(r, d.pid) || !canEdit(r, d.pid) || (f !== 'pt' && f !== 'fw')) return;
      var h = r.currentHole, v = Number(d.v), cur = A.stat(r, d.pid, h, f);
      var same = cur !== null && (cur === v || (f === 'pt' && v === 4 && cur >= 4));
      setStat(r, d.pid, h, f, same ? null : v);
      save(); render();
    },
    'entry-mode': function (d) {
      var r = state.round; if (!r || !myPid()) return;
      state.entry = { roundId: r.id, mode: d.mode === 'mine' ? 'mine' : 'all' };
      if (state.detailOn) (state.detailOpen = state.detailOpen || {})[myPid()] = true;
      save(); render();
    },
    // 코스 정보
    'course-toggle': function () { state.courseOpen = !state.courseOpen; save(); render(); },
    'course-jump': function () { // 홀 카드의 요약 줄 → 아래 코스 정보 카드로 이동 (정보가 없는 홀이면 입력란을 펼침)
      var r = state.round; if (!r) return;
      if (!state.courseOpen && !A.hasHoleInfo(r, r.currentHole)) { state.courseOpen = true; save(); render(); }
      var card = document.getElementById('course-card');
      if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    'hi-shape': function (d) {
      var r = state.round; if (!r || state.readOnly) return;
      var h = r.currentHole, cur = A.holeInfo(r, h).shape;
      setHoleInfo(r, h, 'shape', cur === d.v ? null : d.v); save(); render();
    },
    'hi-haz': function (d) {
      var r = state.round, bit = Number(d.bit); if (!r || state.readOnly) return;
      var h = r.currentHole;
      // 누른 위험 요소 하나만 바꾼다(비트별 공유 키) → 동반자가 같은 홀의 다른 위험 요소를 동시에 표시해도 서로 지우지 않음
      if (!setHoleInfo(r, h, 'z' + bit, (A.holeInfo(r, h).haz & bit) ? null : 1)) return;
      save(); render();
    },
    'course-save': function () { // 지금 라운드의 파·핸디캡·홀 정보로 코스를 통째로 저장 (자동 저장과 달리 덮어씀)
      var r = state.round; if (!r) return;
      var name = (r.course || '').trim();
      if (!name) { toast('코스 이름을 먼저 입력하세요'); return; }
      var old = savedCourse(name, r.holes);
      if (old && r.courseFrom !== name && courseSig(old) !== courseSig(r) &&
        !confirm("이미 저장한 '" + name + "' 코스가 있어요.\n지금 라운드의 파·핸디캡·홀 정보로 바꿀까요? (저장해 둔 홀 정보는 사라져요)")) return;
      saveCourse(r); r.courseFrom = name;
      save(); toast('코스를 저장했어요. 새 라운드에서 불러올 수 있어요');
    },
    'del-course': function () { // 저장한 코스 삭제 (같은 이름의 기본 제공 코스가 있으면 그 값으로 되돌아감)
      var d = state.draft; if (!d) return;
      var name = (d.course || '').trim(), bi = builtinCourse(name, d.holes);
      if (!savedCourse(name, d.holes)) return;
      if (!confirm(bi ? "내가 저장한 '" + name + "' 코스를 지우고 기본 제공 값으로 되돌릴까요?" : "저장한 '" + name + "' 코스를 삭제할까요? (지난 라운드 기록은 그대로예요)")) return;
      state.courses = (state.courses || []).filter(function (c) { return !(c && c.name === name && c.holes === d.holes); });
      if (!bi) d.course = '';
      save(); render();
    },
    'pick-course': function (d) { if (!state.draft) return; state.draft.course = (state.draft.course || '').trim() === d.name ? '' : d.name; save(); render(); },
    // 분석 화면
    'an-player': function (d) { state.anPid = d.pid; state.anHole = null; save(); render(); },
    'an-hole': function (d) { var i = Number(d.i); state.anHole = state.anHole === i ? null : i; save(); render(); },
    'an-start': function (d) { // 출발 홀 직접 지정 (이 기기에만 저장, 공유되지 않음)
      var r = getRound(); if (!r || r.holes !== 18) return;
      if (d.v === 'in') r.startBack = true; else if (d.v === 'out') r.startBack = false; else delete r.startBack;
      state.anHole = null; save(); render();
    },
    'share-analysis': function () {
      var r = getRound(); if (!r) return;
      var text = analysisText(r);
      if (navigator.share) { navigator.share({ title: r.name + ' 분석', text: text }).catch(function () { }); return; }
      copyText(text, '분석 요약을 클립보드에 복사했어요');
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
    'archive-now': function () { var r = state.round; if (!r) return; var wasShared = sharingActive(); clearScan(); archiveCurrent(); if (wasShared && session) { clearTimeout(graceTimer); graceTimer = setTimeout(closeSession, 90000); } else closeSession(); state.readOnly = true; state.viewRoundId = r.id; state.boardTab = 'settle'; go('board'); },
    discard: function () { if (confirm('진행 중인 라운드를 삭제할까요? 복구할 수 없어요.' + (sharingActive() ? '\n(다른 참가자의 기기에는 남아 있어요)' : ''))) { clearScan(); closeSession(); state.round = null; resetBaseline(); go('home'); } },
    'view-history': function (d) { state.readOnly = true; state.viewRoundId = d.id; state.boardTab = 'stroke'; go('board'); },
    'del-history': function (d) { if (confirm('이 기록을 삭제할까요?')) { state.history = state.history.filter(function (h) { return h.id !== d.id; }); save(); render(); } },
    'share-text': shareResults,
    'dismiss-hint': function () { state.hintSeen = true; save(); render(); },
    // 실시간 공유
    'start-sharing': startSharing,
    'retry-sharing': retrySharing,
    'reshare-new-code': function () { if (confirm('새 코드를 만들어 다시 공유할까요? 이미 들어온 참가자는 새 코드로 다시 참여해야 해요.')) { clearScan(); closeSession(); startSharing(); } },
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
      // 함께 입력 중 내가 누구인지 정하면: 참여자는 '내 점수만', 방을 만든 사람은 '모두 입력'이 기본 (언제든 바꿀 수 있음)
      if (state.me && r === state.round && sharingActive() && !(state.entry && state.entry.roundId === r.id)) state.entry = { roundId: r.id, mode: isHost() ? 'all' : 'mine' };
      if (state.me && state.detailOn) (state.detailOpen = state.detailOpen || {})[state.me.pid] = true;
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
    // 공유 수신 측(sync.js setKey)과 같은 규칙으로 정수화·범위 제한 → 기기마다 다른 값이 남지 않도록
    if (path.indexOf('.pars.') > 0) v = Math.min(6, Math.max(3, Math.round(v) || 4));
    if (path.indexOf('.strokeIndex.') > 0) { var r = state.round; v = Math.min(r.holes, Math.max(1, Math.round(v) || 1)); }
    if (/\.hcp$/.test(path)) v = Math.min(54, Math.max(0, Math.round(v) || 0));
    if (/\.unit$/.test(path)) v = Math.min(100000000, Math.max(0, Math.round(v) || 0));
    if (getPath(state, path) === v) return;
    setPath(state, path, v);
    save();
    if (rerender) render();
  }
  $app.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.dataset && (el.dataset.hi || el.dataset.course)) { courseInput(el); return; }
    if (!el.dataset || !el.dataset.bind) return;
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
  window.addEventListener('offline', function () { softRender(); });
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
      // 링크로 중계 서버를 바꾸는 것은 로컬 개발/테스트에서만 허용 (외부 링크가 서버를 바꿔치기하지 못하도록)
      var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      if (broker !== null && isLocal) { state.settings.broker = /^wss?:\/\//.test(broker) ? broker : ''; }
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
  if (pendingJoin) setTimeout(function () {
    var seq = sessionSeq;
    joinRoom(pendingJoin.code, pendingJoin.b);
    // 참여가 시작되지 않았으면(잘못된 코드, 취소 등) 진행 중이던 내 공유를 다시 연결
    if (!state.joining && !scan && sessionSeq === seq) ensureSession();
  }, 50);
  else ensureSession();
})();
