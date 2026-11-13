/* app.js — 골프 스코어 앱 UI (vanilla JS, 상태는 localStorage에 저장, 실시간 공유는 sync.js) */
(function () {
  'use strict';
  // 이름 끝의 2: 예전 app.js는 이 이름을 모른다. 신호가 나빠 이 파일만 예전 것으로 남고 나머지가 새것이 되어도, 예전 app.js가 '업데이트 중' 안내를 띄운다
  var G = window.GolfGames2;
  var S = window.GolfSync2;
  var A = window.GolfAnalysis2;
  // 앱을 갱신한 직후 신호가 나빠 파일 일부만 새로 받아지면, 이 파일은 새것인데 analysis.js 등은 예전 것일 수 있다(예전 것은 기기에 저장된 사본).
  // 그대로 실행하면 없는 함수를 불러 빈 화면이 되거나 돈 계산이 예전 방식으로 조용히 돌아가므로, 짝이 맞지 않으면 안내만 띄우고 두 번까지 다시 받아 본다.
  // 짝은 버전 번호(BUILD)로 확인한다: games.js · analysis.js · sync.js가 모두 이 파일과 같은 번호여야 한다 (sw.js의 캐시 번호와 함께 올린다)
  var BUILD = 16;
  window.__gsApp = BUILD; // games.js · analysis.js · sync.js가 '같은 버전의 app.js가 실행됐는지' 확인하는 표시 (그 파일들의 안전장치 설명 참고)
  if (!G || !S || !A || G.BUILD !== BUILD || S.BUILD !== BUILD || A.BUILD !== BUILD) {
    var box = document.getElementById('app'), tries = 0;
    try { tries = Number(sessionStorage.getItem('gs.mismatch')) || 0; sessionStorage.setItem('gs.mismatch', String(tries + 1)); } catch (e) { tries = 9; }
    if (box) {
      box.innerHTML = '<div class="screen"><div class="card"><h2>앱을 업데이트하는 중이에요</h2><div class="muted">새 버전의 파일을 일부만 받았어요. 인터넷이 연결된 곳에서 다시 열면 이어서 받아요. 입력해 둔 점수는 기기에 그대로 있어요.</div>' +
        '<button class="btn primary block" id="retry-load" style="margin-top:12px">다시 시도</button></div></div>';
      var rb = document.getElementById('retry-load');
      if (rb) rb.addEventListener('click', function () { location.reload(); });
    }
    if (tries < 2) setTimeout(function () { location.reload(); }, 1500);
    return;
  }
  try { sessionStorage.removeItem('gs.mismatch'); } catch (e) { /* 저장소를 못 쓰는 환경 */ }
  var BUILTIN_COURSES = Array.isArray(window.GolfCourses) ? window.GolfCourses : [];
  var COURSE_MAPS = (window.GolfCourseMaps && typeof window.GolfCourseMaps === 'object') ? window.GolfCourseMaps : {};
  // ───────────────────────── 받은 코스 (코스 보관함) ─────────────────────────
  // 코스 목록에서 받았거나 파일로 받은 코스. 기본 제공 코스와 똑같이 쓰인다: 새 라운드에서 고르면 파·핸디캡·홀 정보가 채워지고,
  // 약도가 들어 있으면 홀 약도가 나온다. 약도가 커서(18홀에 수만 자) 자주 저장하는 앱 상태(golfscore.v1)와 따로 둔다
  var LIB_KEY = 'golfscore.lib.v1', LIB_MAX = 40;
  // 받은 코스 전체가 차지할 수 있는 크기(글자 수)와, 코스를 받은 뒤에도 점수를 저장할 자리로 남아 있어야 하는 여유.
  // 기기 저장소는 점수·기록과 함께 쓴다(브라우저에 따라 약 250만~500만 자): 받은 코스가 다 차지해서 점수를 저장하지 못하는 일이 없게 한다
  var LIB_BUDGET = 1500000, LIB_HEADROOM = 250000;
  var SHIPPED_UPDATED = '2026-11-11'; // 앱에 들어 있는 기본 제공 코스 자료의 기준일 (코스 폴더의 같은 코스가 이보다 새로우면 목록에 '새로 받기'가 뜬다)
  var SIG_RE = /^[0-9a-f]{8,64}$/; // 코스 목록이 코스마다 붙이는 내용 지문 (tools/build-course-index.js)
  var lib = loadLib();
  function loadLib() {
    var out = { courses: [] }, raw = null;
    try { raw = JSON.parse(localStorage.getItem(LIB_KEY)); } catch (e) { raw = null; }
    if (raw && Array.isArray(raw.courses)) raw.courses.slice(0, LIB_MAX).forEach(function (c) {
      // 저장해 둔 것도 읽을 때 다시 검증한다: 약도의 숫자는 화면에 그대로 그려지므로, 어떤 경로로든 바뀐 값이 섞여 들지 않게
      var r = c && typeof c === 'object' ? S.readCourseFile(S.makeCourseFile(c, c.map, { note: c.note, updated: c.updated })) : null;
      // 앱에 들어 있는 자료보다 오래된 것은 버린다 (staleCopy)
      if (r && r.ok && !staleCopy(r.course) && !out.courses.some(function (x) { return x.name === r.course.name && x.holes === r.course.holes; })) {
        r.course.from = c.from === 'file' ? 'file' : 'list'; r.course.at = Number(c.at) || 0;
        if (typeof c.sig === 'string' && SIG_RE.test(c.sig)) r.course.sig = c.sig;
        out.courses.push(r.course);
      }
    });
    return out;
  }
  function libText(list) { return JSON.stringify({ v: 1, courses: list }); }
  function saveLib() { try { localStorage.setItem(LIB_KEY, libText(lib.courses)); return true; } catch (e) { return false; } }
  /** 받은 코스를 저장한 뒤에도 점수를 저장할 자리가 남아 있는가 */
  function hasHeadroom() {
    var k = LIB_KEY + '.probe';
    try { localStorage.setItem(k, new Array(LIB_HEADROOM + 1).join('x')); localStorage.removeItem(k); return true; }
    catch (e) { try { localStorage.removeItem(k); } catch (e2) { /* 저장소를 못 쓰는 환경 */ } return false; }
  }
  function libCourse(name, holes) {
    name = (name || '').trim();
    for (var i = 0; i < lib.courses.length; i++) if (lib.courses[i].name === name && lib.courses[i].holes === holes) return lib.courses[i];
    return null;
  }
  /**
   * 받은 코스를 보관함에 넣는다 (같은 이름·홀 수가 있으면 바꾼다) → 넣었으면 '', 못 넣었으면 이유: 'full'(보관함이 가득 참) | 'space'(기기 저장 공간 부족).
   * 가득 찼을 때 오래된 코스를 밀어내지 않는다: 쓰고 있는 코스가 말없이 사라지지 않게, 지울 코스는 사용자가 고른다.
   * sig는 코스 목록에서 받을 때 목록에 적혀 있던 내용 지문 (같은 날 고쳐 올린 자료를 알아보는 데 쓴다)
   */
  function installCourse(course, from, sig) {
    var prev = lib.courses, entry = Object.assign({}, course, { from: from === 'file' ? 'file' : 'list', at: Date.now() });
    if (typeof sig === 'string' && SIG_RE.test(sig)) entry.sig = sig;
    var next = [entry].concat(prev.filter(function (c) { return !(c.name === course.name && c.holes === course.holes); }));
    if (next.length > LIB_MAX || libText(next).length > LIB_BUDGET) return 'full';
    lib.courses = next;
    if (saveLib() && hasHeadroom()) return '';
    lib.courses = prev; saveLib();
    return 'space';
  }
  function removeLibCourse(name, holes) { lib.courses = lib.courses.filter(function (c) { return !(c.name === name && c.holes === holes); }); saveLib(); }
  /** 앱에 들어 있는 기본 제공 코스 */
  function shippedCourse(name, holes) {
    name = (name || '').trim();
    return BUILTIN_COURSES.filter(function (c) { return c.name === name && c.holes === holes; })[0] || null;
  }
  /** 앱에 들어 있는 코스의 자료 기준일 (코스에 따로 적혀 있으면 그 날짜) */
  function shippedDate(c) { return c && typeof c.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.updated) ? c.updated : SHIPPED_UPDATED; }
  /**
   * 앱에 들어 있는 자료보다 오래된 코스 자료인가. 받은 코스는 앱에 들어 있는 같은 코스보다 먼저 쓰이므로,
   * 앱이 더 새 자료와 함께 갱신된 뒤에는 예전에 받아 둔 것이 새 자료를 가리지 않게 한다 (날짜가 같으면 받은 것을 그대로 쓴다)
   */
  function staleCopy(course) {
    var sc = shippedCourse(course.name, course.holes);
    return !!sc && (course.updated || '') < shippedDate(sc);
  }
  /** 이 코스의 홀 약도 배열 (없으면 null). 받은 코스에 약도가 있으면 그것, 아니면 앱에 들어 있는 약도 */
  function courseMapOf(name, holes) {
    name = (name || '').trim();
    var lc = libCourse(name, holes);
    if (lc && lc.map) return lc.map;
    var m = Object.prototype.hasOwnProperty.call(COURSE_MAPS, name) ? COURSE_MAPS[name] : null;
    return Array.isArray(m) && m.length === holes ? m : null;
  }
  A.setMemoUpgrades(BUILTIN_COURSES.memoUpgrades); // 예전 문장형 메모가 남은 라운드·저장 코스도 키워드로 보이게
  var KW_MAX = 24; // 공략 키워드 한 개의 최대 길이
  /**
   * 기본 제공 코스의 키워드(와 OB 위치)는 공개 후기를 간추린 것이라는 표시. 그 홀의 키워드가 기본 제공 값 그대로일 때만 붙인다
   * (직접 넣거나 고친 키워드에 '후기에서 왔다'고 하지 않는다). 예전 문장형 메모가 남아 있는 칸도 기본 제공 값으로 본다.
   * 받은 코스의 키워드는 누가 어떻게 적은 것인지 알 수 없으므로 붙이지 않는다: 앱에 들어 있는 코스의 값과 견준다
   */
  function kwSource(r, h) {
    var bi = shippedCourse(r.course, r.holes), raw = r.holeInfo && r.holeInfo[h] && r.holeInfo[h].memo;
    var mine = bi && bi.holeInfo && bi.holeInfo[h], up = BUILTIN_COURSES.memoUpgrades || {};
    if (!bi || !raw || !(mine && mine.memo === raw) && !Object.prototype.hasOwnProperty.call(up, raw)) return '';
    return (mine && (mine.haz & 3) ? '키워드와 OB 위치는' : '키워드는') + ' 공개 후기를 간추린 참고 정보예요.';
  }
  var KEY = 'golfscore.v1';
  var TEAMS = ['A', 'B', 'C', 'D'];
  var GAME_NAMES = { stroke: '스트로크', stableford: '스테이블포드', skins: '스킨스', ojang: '오장', match: '매치', nassau: '나소', bestball: '베스트볼', vegas: '라스베가스', bonus: '보너스' };
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
      // from(내기 시작 홀: N번째로 친 홀부터 내기)은 1(처음부터): 이 설정이 생기기 전에 만든 라운드의 돈이 바뀌지 않는다
      stroke: { enabled: true, net: false, unit: 0, cap: false, from: 1 },
      stableford: { enabled: true, net: true },
      // fund(공금 방식)는 여기서는 꺼 둔다: 이 값은 예전에 만든 라운드에 빠진 설정을 채우는 데도 쓰이므로, 그 라운드들의 돈 계산이 바뀌면 안 된다.
      // 새 라운드는 newDraft에서 공금 방식을 켠 채로 시작한다.
      // playorder(이월을 친 순서로)도 같은 이유로 꺼 둔다: 10번홀에서 출발한 예전 기록의 스킨스가 홀 번호 순 그대로 남는다.
      // 이 값은 화면에서 바꿀 수 없어서 '이 버전에서 만든 라운드'라는 표시로도 쓴다 (useNewSkinsDefaults)
      // join(OECD 가입 기준: 상금으로 받은 돈)도 같은 이유로 0이다. 0은 '예전 기준(공금에서 받은 돈이 낸 돈 이상)'이라는 뜻이라
      // 이 설정이 생기기 전(13까지)에 만든 라운드의 벌금이 바뀌지 않는다. 새 라운드는 OECD_JOIN(6만 원)으로 시작한다 (upgradeDefaults)
      skins: { enabled: false, net: false, mode: 'individual', unit: 1000, fund: false, stake: 100000, prize: 20000, start: 10000, tip: 10000, caddie: 150000, collect: false, oecd: false, fine: 10000, join: 0, playorder: false },
      ojang: { enabled: false, net: false, unit: 5000, carry: true, birdie: true, near: true },
      match: { enabled: false, net: false, mode: 'individual', unit: 1000 },
      nassau: { enabled: false, net: false, mode: 'individual', unit: 5000 },
      bestball: { enabled: false, net: false, count: 1, unit: 1000 },
      vegas: { enabled: false, net: false, unit: 100 },
      // parthree(니어는 파3 홀에서만) · parfive(롱기는 파5 홀에서만) · eraser(지우개 룰)도 여기서는 꺼 둔다: 예전에 만든 라운드의 횟수와 돈이 바뀌면 안 된다.
      // 새 라운드는 newDraft에서 켠 채로 시작한다 (useNewBonusDefaults)
      // made: 이 설정을 만든 앱 버전. 12부터 적고(upgradeDefaults), 그 전에 만든 라운드는 0이다. 함께 보는 기기에도 전해진다
      bonus: { nearest: false, longest: false, birdie: false, unit: 1000, parthree: false, parfive: false, eraser: false, made: 0 }
    };
  }
  function fillGames(g) { var d = defaultGames(); Object.keys(d).forEach(function (k) { g[k] = Object.assign(d[k], g[k] || {}); }); return g; }
  function newPlayer() { return { id: uid(), name: '', hcp: 0, team: '' }; }
  function newDraft() {
    var g = upgradeDefaults(defaultGames(), 0);
    return { name: '', course: '', date: today(), holes: 18, players: [newPlayer(), newPlayer(), newPlayer(), newPlayer()], games: g };
  }
  /** 새 라운드의 스킨스: 공금 방식 + OECD 룰 + 공금을 미리 걷음 + 이월은 친 순서로 (스킨스 정산을 켜야 실제로 반영된다) */
  function useNewSkinsDefaults(g) { g.skins.fund = true; g.skins.oecd = true; g.skins.collect = true; g.skins.playorder = true; return g; }
  /** 새 라운드의 OECD 가입 기준: 상금으로 6만 원(홀당 2만 원이면 스킨 3개)을 받으면 가입한다 */
  var OECD_JOIN = 60000;
  /** 공금 방식이 생긴 버전(11) 이후에 만든 라운드의 게임 설정인가 */
  function madeHere(g) { return !!(g && g.skins && g.skins.playorder); }
  /** 새 라운드의 니어·롱기: 니어는 파3 홀에서만, 롱기는 파5 홀에서만 고르고, 파3의 지우개 룰을 쓴다 */
  function useNewBonusDefaults(g) { g.bonus.parthree = true; g.bonus.parfive = true; g.bonus.eraser = true; return g; }
  /**
   * 이 게임 설정을 만든 앱 버전. 12부터는 bonus.made에 적혀 있고(공유되므로 참여한 기기도 같은 값을 본다), 없으면 공금 방식 표시로 11과 그 이전을 가른다.
   * 예전 라운드에 fillGames가 채운 값(니어·롱기 룰 false)은 '고른 값'이 아니므로, 설정 항목이 있느냐가 아니라 이 표시로 판단한다
   */
  function madeBy(g) { var m = g && g.bonus ? Number(g.bonus.made) : 0; return m > 0 ? m : madeHere(g) ? 11 : 10; }
  /**
   * 예전 버전(from)에서 만든 게임 설정으로 새 라운드를 시작할 때: 그 뒤에 생긴 기본값을 준다
   * (11: 스킨스 공금 방식, 12: 니어·롱기 홀 제한과 지우개, 14: OECD 가입 기준 6만 원).
   * 이 버전에서 만든 설정을 베낄 때는 본인이 고른 값(끈 것 포함)을 그대로 따른다.
   * 가입 기준은 14보다 앞선 버전이 적은 적이 없으므로, 예전 라운드의 설정에 금액이 들어 있으면 이 버전에서 직접 넣은 것이다: 그대로 둔다
   */
  function upgradeDefaults(g, from) {
    if (from < 11) useNewSkinsDefaults(g);
    if (from < 12) useNewBonusDefaults(g);
    // 숫자가 아닌 값(손상된 저장 자료)은 어느 버전의 것이든 새 라운드로 넘기지 않는다. 화면과 공유로는 숫자만 들어온다
    if (typeof g.skins.join !== 'number' || (from < 14 && !(g.skins.join >= 1))) g.skins.join = OECD_JOIN;
    g.bonus.made = BUILD;
    return g;
  }
  /**
   * 지난 라운드(prev)의 설정을 새 라운드로 베낄 때, 그 설정을 어느 버전에서 만든 것으로 볼지.
   * 가입 기준(14에서 생김)에 수정 기록(rev)이 없으면 이 버전의 기기가 정하거나 받은 값이 아니다:
   *  - 예전 버전(13)인 채로 그 라운드에 참여했던 기기 (13은 모르는 설정은 버리고 '만든 버전' 표시만 받아 둔다)
   *  - 예전 기기가 쓴 스냅샷으로 참여해 호스트의 가입 기준을 끝내 받지 못한 기기
   * 이때 빠진 칸은 0으로 채워져 있을 뿐 본전 기준을 고른 것이 아니므로, 14보다 앞에서 만든 것으로 보고 새 기본값(6만 원)을 준다.
   * 이 버전에서 시작한 라운드는 시작할 때 모든 설정에 수정 기록이 찍히고(stampAll), 참여한 기기는 호스트의 기록을 함께 받는다.
   * 공유를 시작할 때는 기록이 없는 가입 기준에 기록을 찍지 않는다 (startSharing).
   * 지난 라운드 자체(설정과 '만든 버전' 표시)는 건드리지 않는다: 표시는 함께 입력하는 기기들이 나눠 갖는 값이다
   */
  function copiedFrom(prev) {
    var from = madeBy(prev.games), jr = prev.rev && prev.rev['gm:skins:join'];
    return jr && jr.ts > 0 ? from : Math.min(from, 13);
  }
  /** 모든 게임 계산. 홀을 친 순서(10번홀 출발 등)를 넘겨 스킨스 이월·OECD 가입·오장의 '앞 홀'이 실제 순서를 따르게 한다 (스킨스는 이 버전에서 만든 라운드만) */
  function computeAll(r) { return G.computeAll(r, { order: A.playOrder(r).order }); }
  /** 송금 정리에 나오는 이름: 가상 계정은 '캐디'·'공금' */
  function payName(r, id) { return id === '#caddie' ? '캐디' : id === '#pot' ? '공금' : nameOf(r, id); }
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
    if (s.round) { fillGames(s.round.games = s.round.games || {}); s.round.status = s.round.status || 'live'; s.round.rev = s.round.rev || {}; S.ensureScores(s.round); delete s.round.courseFrom; }
    // 예전 버전이 저장해 둔 새 라운드 초안과 지난 라운드에는 그 뒤에 생긴 게임 설정(오장 등)이 없다. 빠진 채로 화면을 그리면 오류가 나므로 채워 둔다
    // 예전 버전에서 쓰다 만 초안은 새 라운드와 같은 스킨스 기본값(공금 방식 등)으로 맞춘다. 지난 라운드와 진행 중인 라운드는 돈 계산이 바뀌면 안 되므로 그대로 둔다
    if (s.draft && typeof s.draft === 'object') {
      var dg = s.draft.games, dfrom = madeBy(dg); // 채우기 전에 본다 (초안에 공금 방식 표시가 없으면 10, 있고 made가 없으면 11)
      upgradeDefaults(fillGames(s.draft.games = dg || {}), dfrom);
    }
    s.history.forEach(function (hr) { if (hr && typeof hr === 'object') fillGames(hr.games = hr.games || {}); });
    s.joining = null;
    s.mapZoom = null;
    // 쓰던 키워드(추가를 누르기 전의 글)는 앱을 다시 열어도 남긴다: 그 홀에 돌아오면 입력란에 보이고, 다른 곳으로 가면 그 홀의 키워드로 들어간다
    if (!s.kwDraft || typeof s.kwDraft.v !== 'string' || typeof s.kwDraft.h !== 'number') s.kwDraft = null;
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
  /** 이 라운드에서 코스 정보(코스 이름·파·핸디캡·홀 정보)를 고쳤는지: 고쳤다면 입력한 홀이 없어도 그냥 버리지 않고 기록·코스 저장을 거친다 */
  function courseEdited(r) {
    var rev = r.rev || {}, t0 = r.createdAt || 0;
    return Object.keys(rev).some(function (k) { return /^(course$|par:|si:|hi:)/.test(k) && rev[k] && rev[k].ts > t0; });
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
  // 예전 버전에서 고른 출발 홀에는 변경 표시(rev)가 없어 다른 기기로 가지 않는다. 지금부터는 함께 보는 기기에도 전해지므로 표시를 찍어 둔다.
  // 가장 오래된 시각(1)으로 찍는다: 아직 아무도 고르지 않은 기기에는 전해지지만, 이 버전에서 누군가 새로 고른 출발 홀을 덮어쓰지는 않는다
  var oldStartChoice = false; // 연결되면 한 번 보낸다 (openSession)
  if (state.round && typeof state.round.startBack === 'boolean' && !state.round.rev.start) { state.round.rev.start = { ts: 1, by: state.clientId }; oldStartChoice = true; }
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
    catch (e) { if (!saveFailed) { saveFailed = true; setTimeout(function () { toast('기기 저장 공간이 부족해 저장하지 못했어요. 홈에서 오래된 기록을 지워 주세요.' + (lib.courses.length ? ' 골프장 받기에서 받은 코스를 지워도 돼요.' : '')); }, 0); } }
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
    // 약도 크게 보기가 열려 있는 동안에는 바뀐 영역만 갈아 끼운다: 창을 새로 만들면 스크롤하던 손가락이 끊긴다 (닫을 때 전체를 다시 그림)
    if (state.view === 'play' && $app.querySelector('.mapzoom')) { patchRegions(null); return; }
    render();
  }
  function patchRegions(focused) {
    var tmp = document.createElement('div');
    tmp.innerHTML = viewHtml();
    var fresh = tmp.querySelectorAll('[data-region]');
    for (var i = 0; i < fresh.length; i++) {
      var old = $app.querySelector('[data-region="' + fresh[i].getAttribute('data-region') + '"]');
      if (old && !old.contains(focused) && (old.innerHTML !== fresh[i].innerHTML || typedIn(old))) old.innerHTML = fresh[i].innerHTML;
    }
    centerHoleStrip();
    fitSummary();
  }
  /** 직접 고친 입력란은 화면 값(value)이 마크업(value 속성)과 달라서 innerHTML 비교만으로는 차이가 드러나지 않는다 */
  function typedIn(el) {
    var ins = el.querySelectorAll('input[type="text"], input[type="number"]');
    for (var i = 0; i < ins.length; i++) if (ins[i].value !== ins[i].defaultValue) return true;
    return false;
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
      // 예전 버전에서 고른 출발 홀(앱을 열 때 변경 표시를 찍은 것)을 한 번 보낸다. 서버에 남은 스냅샷이 내가 올린 것이면 그 에코는 무시되므로,
      // 스냅샷에 없는 키가 있다는 것을 세션이 스스로 알아채지 못한다
      if (oldStartChoice && state.round && state.round.share && state.round.share.code === code) { oldStartChoice = false; session.markDirty(['start']); }
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
      // 두 기기가 같은 사람의 샷·벌타·퍼트를 거의 동시에 고치면 타수(합계)는 늦게 쓴 쪽 값만 남아 구성 요소의 합과 어긋날 수 있다.
      // 구성 요소(샷·OB·해저드·퍼트)를 방금 받은 칸만 합계를 다시 계산한다. 타수만 온 메시지에는 반응하지 않는다:
      // 구성 요소 하나를 아직 못 받은 기기와 합계를 끝없이 서로 덮어쓰게 되고, 그때마다 스냅샷 전송이 미뤄져 빠진 값이 영영 전달되지 않기 때문.
      // (샷 수를 모르는 이전 버전 기기가 직접 고친 타수도 그대로 남는다)
      if (reconcileAuto(r, changed)) save();
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
    // 가입 기준에 수정 기록이 없으면(예전 버전인 채로 참여했거나 예전 기기의 스냅샷으로 받은 라운드) 채워져 있는 0은 누가 고른 값이 아니다.
    // 여기서 기록을 찍으면 그 0이 고른 값이 되어 다음 라운드로 넘어가고, 호스트가 정한 금액과 같은 시각(createdAt)으로 겨뤄 이길 수도 있다.
    // 기록 없이 두면 ts 0으로 전해져 호스트의 금액에 항상 지고, 새 라운드는 6만 원으로 시작한다 (copiedFrom)
    var hadJoin = !!(r.rev && r.rev['gm:skins:join']);
    S.stampAll(r, r.createdAt || (Date.now() - 1), state.clientId);
    if (!hadJoin) delete r.rev['gm:skins:join'];
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
  /**
   * 참여하면서 그냥 버린 라운드들 (라운드 id → 라운드). 모든 사람의 점수가 들어간 홀이 하나도 없고, 공유 중이 아니며,
   * 코스를 고치지 않은 라운드는 묻지 않고 버리고 기록에도 남기지 않는다.
   * 참여한 방의 라운드가 바로 그 라운드이면(같은 id) 버리지 않고 합친다 (adoptSnapshot): 공유가 끝난 뒤 이 기기에만 있는 설정
   * (예전 버전인 채로 참여했던 기기가 다시 연 방에는 없는 가입 기준 등)이 사라지지 않게 한다. 홀을 입력한 라운드는 기록에 들어가 같은 방식으로 합쳐진다 (다만 기록의 사본은 진행 상태까지 합치고, 버린 라운드는 진행 상태만 빼고 합친다).
   * 다시 시도·취소 뒤에도, 그 사이에 다른 라운드를 시작했거나 다른 방에 다녀온 뒤에도 남아 있어야 하므로 id별로 두고
   * 그 라운드의 방에 들어갔을 때만 지운다. 앱을 다시 열면 없어진다
   */
  var replacedRounds = Object.create(null);
  function joinRoom(code, b) {
    code = S.normalizeCode(code);
    if (!S.isValidCode(code)) { alert('코드는 영문/숫자 8자리예요. (예: ABCD-EFGH)'); return; }
    if (!S.cryptoAvailable()) { alert('이 환경에서는 실시간 공유를 사용할 수 없어요. HTTPS 주소로 열어 주세요.'); return; }
    var cur = state.round;
    if (cur && cur.share && cur.share.code === code) { state.readOnly = false; state.viewRoundId = null; cur.share.active = true; save(); ensureSession(); go('play'); return; }
    if (cur) {
      if (holesDone(cur) === 0 && !sharingActive() && !courseEdited(cur)) { clearScan(); closeSession(); replacedRounds[cur.id] = cur; state.round = null; resetBaseline(); }
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
      fillGames(hist.games = hist.games || {});
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
    // 홀을 입력하기 전이라 참여하면서 버린 라운드가 바로 이 라운드이면 그것도 합친다 (joinRoom). 진행 상태(status)만은 빼고: 아래 설명
    var replaced = !dup && replacedRounds[r.id];
    if (replaced) dup = replaced;
    var mine = []; // 이 기기의 사본이 더 새로워서 방의 값 대신 남은 키
    if (dup) {
      var own = S.exportKeys(dup);
      // 버린 라운드의 진행 상태는 합치지 않고 전처럼 방의 상태를 따른다: 공유 종료는 status에 새 수정 기록을 찍으므로(closed → live),
      // 합치면 그 뒤에 들어간 방의 라운드가 이미 종료된 것이어도 이 기기의 '진행 중'이 이겨서 종료된 라운드가 다시 열린다
      // 이 기기의 사본에 남아 있는 'closed'(공유 종료 도중에 연결이 끊겼거나, 종료한 기록이 호스트의 공유 종료를 받은 경우)도 합치지 않는다:
      // 'closed'는 그 공유가 끝났다는 표시이지 라운드의 상태가 아니다. 합치면 살아 있는 방을 '이미 종료한 공유'로 거절하고 그 사본까지 잃는다
      if (replaced || (own.status && own.status.v === 'closed')) delete own.status;
      mine = S.merge(r, own).changed;
      if (dup.courseApplied) r.courseApplied = dup.courseApplied;
    }
    if (r.status === 'closed') { // 호스트가 서버에서 삭제했지만 retained 스냅샷만 남은 경우
      closeSession();
      state.joining = { code: code, status: 'timeout', b: idx };
      save(); render(); toast('호스트가 이미 종료한 공유예요.');
      return;
    }
    state.joining = null; delete replacedRounds[r.id];
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
    // 남은 값은 바로 보낸다: 받은 것이 서버에 남아 있던 스냅샷뿐이면(다른 기기가 꺼져 있을 때) 누가 고치기 전에는 전해지지 않는다
    if (session && mine.length) session.markDirty(mine);
    save(); go('play');
    ensureRoundCourse();
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
  /** 벌타: OB 1번 = 2타(OB티에서 이어 치는 기준), 해저드 1번 = 1타 */
  function penaltyOf(r, pid, h) { return (A.stat(r, pid, h, 'ob') || 0) * A.OB_COST + (A.stat(r, pid, h, 'hz') || 0) * A.HZ_COST; }
  /** 샷 수 + 벌타 + 퍼트 수로 계산한 타수. 샷 수와 퍼트 수가 모두 입력돼 있을 때만 (아니면 null → 타수는 직접 입력한 값 그대로) */
  function autoScore(r, pid, h) {
    var sh = A.stat(r, pid, h, 'sh'), pt = A.stat(r, pid, h, 'pt');
    if (sh === null || pt === null) return null;
    return Math.min(G.maxScore(r, h), Math.max(1, sh + penaltyOf(r, pid, h) + pt));
  }
  function applyAutoScore(r, pid, h) {
    var v = autoScore(r, pid, h);
    if (v === null || !r.scores[pid] || r.scores[pid][h] === v) return false;
    r.scores[pid][h] = v; return true;
  }
  /** 받은 변경 가운데 샷·OB·해저드·퍼트가 바뀐 칸만 합계를 다시 맞춘다 */
  function reconcileAuto(r, keys) {
    var changed = false, seen = {};
    keys.forEach(function (k) {
      var m = /^st:([A-Za-z0-9_-]+):(\d+):(sh|ob|hz|pt)$/.exec(k);
      if (!m || seen[m[1] + ':' + m[2]]) return;
      seen[m[1] + ':' + m[2]] = 1;
      if (applyAutoScore(r, m[1], +m[2])) changed = true;
    });
    return changed;
  }
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
    if (v('sh') !== null) sum.push('샷 ' + v('sh'));
    if (v('ob')) sum.push('OB ' + v('ob'));
    if (v('hz')) sum.push('해저드 ' + v('hz'));
    if (v('bk')) sum.push('벙커 ' + v('bk'));
    if (v('fw') !== null && par >= 4) sum.push(v('fw') === 1 ? '페어웨이 ○' : v('fw') === 2 ? '티샷 좌' : '티샷 우');
    if (v('pt') !== null) sum.push('퍼트 ' + v('pt'));
    var head = '<button class="detail-head" data-action="detail-open" data-pid="' + pid + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="caret">' + (open ? '▾' : '▸') + '</span><span class="ttl">상세 기록</span>' +
      (sum.length ? '<span class="sumtxt">' + esc(sum.join(' · ')) + '</span>' : '<span class="sumtxt none">샷 · OB · 해저드 · 퍼트</span>') + '</button>';
    if (!open) return '<div class="detail' + (myPid() === p.id ? ' mine' : '') + '">' + head + '</div>';
    function stepper(f, label) {
      var n = v(f) || 0;
      return '<div class="stp"><span class="lab">' + label + '</span>' +
        '<button class="mini" data-action="stat" data-pid="' + pid + '" data-f="' + f + '" data-delta="-1" ' + (n ? '' : 'disabled') + ' aria-label="' + label + ' 줄이기">−</button>' +
        '<span class="n ' + (n ? 'on' : '') + '">' + n + '</span>' +
        '<button class="mini" data-action="stat" data-pid="' + pid + '" data-f="' + f + '" data-delta="1" aria-label="' + label + ' 늘리기">＋</button></div>';
    }
    var pt = v('pt'), fw = v('fw'), sh = v('sh'), pen = penaltyOf(r, p.id, h), auto = autoScore(r, p.id, h);
    // 샷 수(퍼트·벌타를 뺀, 실제로 친 횟수). 샷 수와 퍼트 수를 넣으면 타수 = 샷 + 벌타 + 퍼트로 자동 계산된다
    var shots = '<div class="stp wide"><span class="lab">샷 수</span>' +
      '<button class="mini" data-action="stat" data-pid="' + pid + '" data-f="sh" data-delta="-1" ' + (sh === null ? 'disabled' : '') + ' aria-label="샷 수 줄이기">−</button>' +
      '<span class="n ' + (sh === null ? '' : 'on') + '">' + (sh === null ? '–' : sh) + '</span>' +
      '<button class="mini" data-action="stat" data-pid="' + pid + '" data-f="sh" data-delta="1" aria-label="샷 수 늘리기">＋</button>' +
      '<span class="small muted">티샷부터 그린에 올릴 때까지 (퍼트 제외)</span></div>';
    var typed = auto !== null && G.gross(r, p.id, h) !== auto; // 합계와 다른 타수 = 다른 기기에서 직접 고치거나 지운 값
    var formula = auto !== null && !typed
      ? '<div class="sumline">샷 ' + sh + (pen ? ' + 벌타 ' + pen : '') + ' + 퍼트 ' + pt + ' = <b>' + auto + '타</b>' + (sh + pen + pt > auto ? ' <span class="small muted">(' + (G.maxScore(r, h) < 15 ? '양파 한도 ' : '최대 ') + G.maxScore(r, h) + '타)</span>' : '') + '</div>'
      : '<div class="sumline muted">' + (typed ? '타수를 직접 고치거나 지운 칸이에요. 샷·벌타·퍼트를 바꾸면 다시 계산돼요.' : sh !== null ? '퍼트 수를 고르면 타수가 계산돼요.' : pt !== null ? '샷 수를 넣으면 타수가 계산돼요.' : '샷 수와 퍼트 수를 넣으면 타수가 자동으로 계산돼요.') +
        ' <span class="small">샷 + 벌타(OB 2타 · 해저드 1타) + 퍼트</span></div>';
    var putts = '<div class="stp wide"><span class="lab">퍼트</span><div class="chips">' + [0, 1, 2, 3, 4].map(function (k) {
      var on = pt !== null && (pt === k || (k === 4 && pt >= 4));
      return '<button class="chip tap num ' + (on ? 'active' : '') + '" data-action="stat-set" data-pid="' + pid + '" data-f="pt" data-v="' + k + '">' + (k === 4 ? '4+' : k) + '</button>';
    }).join('') + '</div></div>';
    var fairway = par >= 4 ? '<div class="stp wide"><span class="lab">티샷</span><div class="chips">' + [[2, '← 좌'], [1, '페어웨이'], [3, '우 →']].map(function (o) {
      return '<button class="chip tap ' + (fw === o[0] ? 'active' : '') + '" data-action="stat-set" data-pid="' + pid + '" data-f="fw" data-v="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div></div>' : '';
    return '<div class="detail open' + (myPid() === p.id ? ' mine' : '') + '">' + head + '<div class="detail-body">' +
      shots + stepper('ob', 'OB') + stepper('hz', '해저드') + stepper('bk', '벙커') + fairway + putts + formula + '</div></div>';
  }
  // ───────────────────────── 코스 정보: 홀 약도 · 공략 · 입력 ─────────────────────────
  function setHoleInfo(r, h, f, v) { return S.setKey(r, 'hi:' + h + ':' + f, v); }
  // ── 코스 안내도를 단순하게 옮긴 홀 약도 (기본 제공 코스, coursemaps.js) ──
  var TEE_NAME = { K: '블랙', B: '블루', W: '화이트', Y: '옐로', R: '레드' };
  var TEE_FILL = { K: '#1d1d1d', B: '#0069b4', W: '#ffffff', Y: '#b5d22e', R: '#e31e1e' };
  /** 이 라운드의 이 홀에 쓸 수 있는 약도: 코스 이름이 약도가 있는 기본 제공 코스와 같고 홀 수가 맞을 때 */
  function courseLayout(r, h) {
    var m = courseMapOf(r.course, r.holes);
    return m && m[h] && Array.isArray(m[h].o) ? m[h] : null;
  }
  /**
   * 약도가 있는 홀의 형태는 약도(기본 제공 코스 자료) 기준으로 고정한다. 화면에 그려진 약도와 한 줄 요약·공략 팁이 어긋나지 않게,
   * 라운드에 저장된 값(예전에 형태 버튼을 눌러 바꿨거나 옛 버전 기기가 보낸 값)은 쓰지 않는다. 약도가 없으면 undefined → 저장된 값 그대로
   */
  function guideShape(r, h) {
    if (!r || !courseLayout(r, h)) return undefined;
    var bi = builtinCourse(r.course, r.holes), i = bi && bi.holeInfo && bi.holeInfo[h];
    return i && (i.shape === 'S' || i.shape === 'L' || i.shape === 'R') ? i.shape : null;
  }
  A.setShapeSource(guideShape);
  /** 다각형 [x1,y1,x2,y2,…] → 꼭짓점 사이의 중점을 지나는 부드러운 닫힌 곡선 */
  function smoothPath(a) {
    var n = a.length >> 1; if (n < 3) return '';
    function X(i) { return a[(i % n) * 2]; }
    function Y(i) { return a[(i % n) * 2 + 1]; }
    var d = 'M' + (X(0) + X(1)) / 2 + ' ' + (Y(0) + Y(1)) / 2;
    for (var i = 1; i <= n; i++) d += 'Q' + X(i) + ' ' + Y(i) + ' ' + (X(i) + X(i + 1)) / 2 + ' ' + (Y(i) + Y(i + 1)) / 2;
    return d + 'Z';
  }
  /**
   * 약도 SVG. big = 크게 보기(거리 숫자·캐리 지점·거리 표시까지), 아니면 작은 그림(모양·티·깃대·50m 단위 점선만).
   * w, hpx를 주면 그 크기(px)로, 없으면 가로 폭에 맞춘다
   */
  function layoutMap(lay, h, big, w, hpx) {
    var id = 'lm' + h + (big ? 'z' : ''), H = lay.h, c = (lay.c || [])[0], tees = lay.t || [], ips = lay.ip || [], s = '';
    function paths(list, attrs) { return (list || []).map(function (a) { var d = smoothPath(a); return d ? '<path d="' + d + '" ' + attrs + '/>' : ''; }).join(''); }
    var outline = lay.o && lay.o[0] ? smoothPath(lay.o[0]) : '';
    s += '<rect width="500" height="' + H + '" rx="20" fill="#e9f3ec"/>';
    if (outline) s += '<clipPath id="' + id + '"><path d="' + outline + '"/></clipPath><path d="' + outline + '" fill="#9ccfa6"/>';
    s += paths(lay.d, 'fill="#5f9f72"') + paths(lay.w, 'fill="#8fbbef"') + paths(lay.f, 'fill="#c8e8c6"') +
      paths(lay.g, 'fill="#4fb56f" stroke="#2f8f52" stroke-width="' + (big ? 2 : 4) + '"') +
      paths(lay.b, 'fill="#f3e6b8" stroke="#d9c88e" stroke-width="' + (big ? 1.5 : 3) + '"');
    var white = null;
    tees.forEach(function (t) { if (!white && t[0] === 'W') white = t; });
    white = white || tees[0] || null;
    if (c && lay.s > 0) {
      var far = 0;
      tees.forEach(function (t) { far = Math.max(far, Math.sqrt(Math.pow(t[1] - c[0], 2) + Math.pow(t[2] - c[1], 2))); });
      // 그린 중심에서 50m 단위 점선 (숫자는 공략선 옆에)
      var tw = ips.length ? ips[ips.length - 1] : (white ? [white[1], white[2]] : [c[0], c[1] + 1]);
      var ux = tw[0] - c[0], uy = tw[1] - c[1], ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
      [50, 100, 150, 200, 250].forEach(function (m) {
        var rr = m * lay.s; if (rr > far - 10) return;
        s += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + rr.toFixed(1) + '" fill="none" stroke="#fff" stroke-width="' + (big ? 2 : 4) + '" stroke-dasharray="' + (big ? '5 7' : '10 12') + '" opacity=".9"' +
          (outline ? ' clip-path="url(#' + id + ')"' : '') + '/>';
        if (big) s += '<text class="arc" x="' + (c[0] + ux * rr - uy * 32).toFixed(0) + '" y="' + (c[1] + uy * rr + ux * 32).toFixed(0) + '">' + m + '</text>';
      });
      if (white) { // 화이트티 → 공략 지점 → 그린 중심
        var pts = [[white[1], white[2]]].concat(ips).concat([c]);
        s += '<polyline points="' + pts.map(function (q) { return q[0] + ',' + q[1]; }).join(' ') + '" fill="none" stroke="#fff" stroke-width="' + (big ? 2.5 : 5) +
          '" stroke-dasharray="' + (big ? '1 8' : '2 14') + '" stroke-linecap="round" opacity=".95"/>';
      }
    }
    if (big) {
      (lay.m || []).forEach(function (q) { s += '<rect x="' + (q[0] - 3.5) + '" y="' + (q[1] - 3.5) + '" width="7" height="7" fill="#16211b"/><text class="mk" x="' + (q[0] + 8) + '" y="' + (q[1] + 5) + '">' + q[2] + '</text>'; });
      (lay.cy || []).forEach(function (q) {
        var lf = q[3] === 'L' || (q[3] === 'C' && c && q[0] < c[0]); // 숫자를 놓을 쪽 (정면 지점은 그린 중심 기준 바깥쪽)
        s += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="7" fill="#fff" stroke="#16211b" stroke-width="2.5"/><text class="cy" x="' + (q[0] + (lf ? -12 : 12)) + '" y="' + (q[1] + 6) + '" text-anchor="' + (lf ? 'end' : 'start') + '">' + q[2] + 'm</text>';
      });
      ips.forEach(function (q) { s += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="6" fill="#e34948" stroke="#fff" stroke-width="2"/>'; });
    }
    var tr = big ? 9 : 17;
    tees.forEach(function (t) { s += '<circle cx="' + t[1] + '" cy="' + t[2] + '" r="' + tr + '" fill="' + (TEE_FILL[t[0]] || '#888') + '" stroke="' + (t[0] === 'W' ? '#16211b' : '#fff') + '" stroke-width="' + (big ? 1.5 : 3) + '"/>'; });
    var k = big ? 1 : 2;
    (lay.c || []).forEach(function (g) {
      s += '<line x1="' + g[0] + '" y1="' + g[1] + '" x2="' + g[0] + '" y2="' + (g[1] - 26 * k) + '" stroke="#16211b" stroke-width="' + (2 * k) + '"/>' +
        '<path d="M' + g[0] + ' ' + (g[1] - 26 * k) + ' l' + (15 * k) + ' ' + (6 * k) + ' l' + (-15 * k) + ' ' + (6 * k) + ' z" fill="#e34948"/>';
    });
    return '<svg class="laymap' + (big ? ' big' : '') + '" viewBox="0 0 500 ' + H + '"' + (w ? ' width="' + w + '" height="' + hpx + '"' : '') + ' role="img" aria-label="' + (h + 1) + '번홀 약도">' + s + '</svg>';
  }
  /** 코스 정보 카드에 넣는 작은 약도 (누르면 크게 보기). 높이 제한 안에서 비율을 유지한다 */
  function layoutThumb(lay, h, maxH) {
    var k = Math.min(112 / 500, maxH / lay.h), w = Math.round(500 * k), hp = Math.round(lay.h * k);
    return '<button class="laybtn" data-action="map-zoom" aria-label="' + (h + 1) + '번홀 약도 크게 보기">' + layoutMap(lay, h, false, w, hp) + '<span class="zoomhint">🔍 크게</span></button>';
  }
  /** 안내도에서 읽은 사실: 고저차, 화이트티에서 표시 지점까지의 거리 */
  /** 약도에 고저차 설명을 붙일 만한 홀인지 (티 대비 그린이 4m 이상 높거나 낮음) */
  function layoutSlope(lay) { var e = lay.e || [], g = e.length ? e[e.length - 1] : null; return g !== null && Math.abs(g) >= 4; }
  function layoutNotes(lay) {
    var out = [], e = lay.e || [], g = e.length ? e[e.length - 1] : null;
    var leg = e.length > 1 ? g - e[e.length - 2] : g; // 클럽 선택은 마지막 구간(공략 지점 → 그린)의 고저차로 안내한다. 파3는 티 → 그린
    if (layoutSlope(lay)) {
      out.push(['⛰️', g < 0 ? '그린이 티보다 ' + (-g) + 'm 낮은 내리막 홀이에요.' + (leg <= -10 ? ' 평소보다 한 클럽 짧게 잡아도 돼요.' : '')
        : '그린이 티보다 ' + g + 'm 높은 오르막 홀이에요.' + (leg >= 10 ? ' 한 클럽 길게 잡으세요.' : '')]);
    }
    var cy = (lay.cy || []).slice().sort(function (a, b) { return a[2] - b[2]; });
    if (cy.length) out.push(['📏', '화이트티에서 안내도 표시 지점(벙커·해저드 등)까지 ' + cy.map(function (q) { return (q[3] === 'L' ? '왼쪽 ' : q[3] === 'R' ? '오른쪽 ' : '정면 ') + q[2] + 'm'; }).join(' · ')]);
    return out.map(function (o) { return '<div class="coachline"><span class="ic">' + o[0] + '</span><span>' + o[1] + '</span></div>'; }).join('');
  }
  /** 약도 크게 보기 (화면을 덮는 창). 티별 거리와 안내도 표시를 함께 보여 준다 */
  function mapZoom(r, h, par) {
    var lay = state.mapZoom === h ? courseLayout(r, h) : null;
    if (!lay) return '';
    var info = A.holeInfo(r, h);
    var tees = (lay.t || []).map(function (t) {
      return '<span class="teechip"><i style="background:' + (TEE_FILL[t[0]] || '#888') + '"></i>' + (TEE_NAME[t[0]] || '') + ' <b>' + t[3] + 'm</b></span>';
    }).join('');
    return '<div class="mapzoom" data-action="map-close"><div class="mapzoom-card" data-action="map-stay" role="dialog" aria-label="' + (h + 1) + '번홀 약도">' +
      '<div class="row between"><b>' + (h + 1) + '번홀 · 파' + par + (info.dist ? ' · ' + info.dist + 'm' : '') + '</b><button class="btn sm" data-action="map-close">닫기</button></div>' +
      layoutMap(lay, h, true) +
      '<div class="teechips">' + tees + '</div>' +
      '<div class="stack small">' + layoutNotes(lay) +
      '<div class="muted">흰 점선은 그린 중심까지 50m 단위, 작은 숫자는 그 자리에서 그린 중심까지 남은 거리예요. 동그라미는 안내도에 캐리 거리가 표시된 지점(화이트티 기준)이에요.</div>' +
      '<div class="muted">코스 안내도를 단순하게 옮긴 그림이라 실제 지형과 다를 수 있어요.</div></div></div></div>';
  }
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
   * 홀 카드 맨 아래의 코스 요약(높이 고정): 첫 줄은 '352m · 좌 도그렉 · OB 우', 그 아래 두 줄까지 공략 키워드(없으면 첫 공략 팁).
   * 내용이 길거나 없어도 높이가 같다 → 동반자가 코스 정보를 넣거나 팁이 바뀌어도 아래 점수 칸이 밀리지 않는다.
   * 누르면 아래 코스 정보 카드(약도·공략 전체)로 이동한다.
   */
  function courseSumInner(r, h) {
    var labels = A.holeLabels(r, h), words = A.memoWords(A.holeInfo(r, h).memo);
    var line1 = labels.join(' · '), line2 = words.length ? '📝 ' + words.join(A.MEMO_SEP) : '';
    if (!line2 && labels.length) { var tips = A.holeTips(r, h, myPid()); if (tips.length) line2 = '🧭 ' + tips[0]; }
    var none = !line1 && !line2;
    if (none) { line1 = r.course ? r.course : '코스 정보 입력'; line2 = '거리·위험 요소를 넣으면 약도와 공략 팁이 나와요'; }
    else if (!line1) line1 = r.course || (h + 1) + '번홀 키워드';
    return '<span class="ic">🗺️</span><span class="txt"><span class="l1' + (none ? ' none' : '') + '">' + esc(line1) + '</span> <span class="l2">' + esc(line2) + '</span></span><span class="go">›</span>';
  }
  /**
   * 요약 줄 맞춤: 첫 줄(거리·형태·위험 요소)이 한 줄에 다 들어가지 않는 홀은 뒤를 잘라 버리는 대신
   * 키워드와 한 문단으로 이어 세 줄까지 보여 준다(.flow). 어느 쪽이든 요약 줄의 높이는 같아서 점수 칸은 움직이지 않는다.
   * 요약 줄을 새로 그릴 때마다 부른다
   */
  function fitSummary() {
    var s = document.getElementById('course-sum'), l1 = s && s.querySelector('.l1');
    if (!l1) return;
    s.classList.remove('flow');
    if (l1.scrollWidth > l1.clientWidth + 1) s.classList.add('flow');
  }
  /**
   * 코스 안내도 약도가 있는 홀은 코스 정보 카드가 보기 전용이다. 약도·키워드·공략 설명에 필요한 내용이 이미 다 나와 있어서,
   * 같은 내용을 한 번 더 늘어놓는 입력란(거리·형태·위험 요소·키워드)을 두지 않는다. 약도가 없는 코스는 카드를 펼쳐 직접 넣는다.
   * (동반자가 넣은 값이나 예전에 넣어 둔 값은 그대로 보여 준다. 파·핸디캡은 홀 머리말에서 언제나 고칠 수 있다)
   */
  function courseFixed(r, h) { return !!courseLayout(r, h); }
  // 약도가 있는 코스 이름을 라운드 설정에서 붙이기만 한 라운드(홀 정보를 불러오지 않음)에도 그 코스의 거리·위험 요소·키워드를 보여 준다.
  // 그러지 않으면 보기 전용 카드에 약도만 있고, 공략 팁은 위험 요소를 모른 채 형태만 보고 만들어진다
  A.setInfoFallback(function (r, h) {
    if (!r || !courseLayout(r, h)) return null;
    var bi = builtinCourse(r.course, r.holes);
    return (bi && bi.holeInfo && bi.holeInfo[h]) || null;
  });
  /**
   * 예전 문장형 메모가 그대로 남은 칸은 읽을 때 키워드로 바뀌고 OB 표시가 덧붙는다(번역표). 그 칸의 키워드나 위험 요소를 고치기 직전에
   * 바뀐 모습을 실제 값으로 적어 둔다. 그러지 않으면 메모를 고치는 순간 번역표와 맞지 않게 되어 덧붙던 OB 표시가 사라지고,
   * 덧붙은 표시는 눌러도 꺼지지 않는다
   */
  function settleUpgrade(r, h) {
    var raw = r.holeInfo && r.holeInfo[h] && r.holeInfo[h].memo, table = BUILTIN_COURSES.memoUpgrades || {};
    if (typeof raw !== 'string' || !Object.prototype.hasOwnProperty.call(table, raw)) return;
    var up = table[raw];
    if (up && up.z > 0) S.HAZ_BITS.forEach(function (bit) { if (up.z & bit) setHoleInfo(r, h, 'z' + bit, 1); });
    setHoleInfo(r, h, 'memo', A.holeInfo(r, h).memo);
  }
  /** 이 홀의 입력란이 펼쳐져 있는지 (보기 전용 홀에서는 늘 접힌 모습) */
  function courseOpen(r, h) { return !!state.courseOpen && !courseFixed(r, h); }
  /** 코스 정보 중 입력란이 없는 부분(키워드·공략·약도). 입력하는 동안이나 동반자가 고쳤을 때 이 영역만 다시 그린다 */
  function courseLive(r, h, par) {
    var info = A.holeInfo(r, h), open = courseOpen(r, h), lay = courseLayout(r, h);
    var tips = A.holeTips(r, h, myPid());
    var notes = '', words = open ? [] : A.memoWords(info.memo);
    // 약도가 고저차를 숫자로 알려 주는 홀('그린이 티보다 38m 낮은 내리막 홀')에서는 '내리막' 같은 키워드를 바로 위에 또 보여 주지 않는다 (요약 줄에는 그대로 나온다)
    if (lay && layoutSlope(lay)) words = words.filter(function (w) { return !/^(완만한 |약간 |심한 )?(내리막|오르막)$/.test(w); });
    // 공략 키워드: 문장 대신 짧은 꼬리표 여러 개 (좁은 칸에서도 잘리지 않고 줄만 바뀐다).
    // 펼친 상태에서는 바로 아래 편집 칸에 같은 키워드가 있으므로 여기에 또 그리지 않는다 (높이가 고정된 칸을 약도 설명과 공략 팁에 쓴다)
    if (words.length) notes += '<div class="coachline"><span class="ic">📝</span><span class="kws">' + words.map(function (w) { return '<span class="kw">' + esc(w) + '</span>'; }).join('') + '</span></div>';
    // 기본 제공 코스의 키워드는 공개 후기를 간추린 것이라는 점을 밝힌다 (직접 넣은 키워드가 섞여 있어도 코스 단위로만 구분한다)
    var src = words.length ? kwSource(r, h) : '';
    if (lay) notes += layoutNotes(lay);
    notes += tips.map(function (t) { return '<div class="coachline"><span class="ic">🧭</span><span>' + esc(t) + '</span></div>'; }).join('');
    // 펼친 동안에는 약도 영역을 항상 같은 높이로 그린다(공략 글은 약도 높이 안에서 스크롤) → 위험 요소를 누르거나 거리를 적어도
    // 바로 아래 입력란이 밀리지 않는다. 접은 상태에서는 홀 형태나 위험 요소가 있을 때만 약도를 보여 주고 글은 전부 펼친다
    if (open || info.shape || info.haz || lay) {
      // 코스 안내도 약도가 있는 홀(기본 제공 코스)은 그 그림을, 없으면 입력한 정보로 그린 도식을 보여 준다
      return '<div class="course-view' + (open ? ' fixed' : '') + '">' + (lay ? layoutThumb(lay, h, open ? 171 : 280) : holeMap(info, par)) +
        '<div class="stack grow">' + (notes || '<div class="muted small">' + (info.dist ? '위험 요소를 표시하면 공략 팁이 여기에 나와요.' : '위험 요소나 거리를 입력하면 공략 팁이 여기에 나와요.') + '</div>') +
        '<div class="muted small">' + (lay ? '약도는 코스 안내도를 단순하게 옮긴 그림이에요. 누르면 크게 보여요.' : '약도는 입력한 정보로 그린 그림이에요. 실제 지형과 다를 수 있어요.') + (src ? ' ' + src : '') + '</div></div></div>';
    }
    return notes ? '<div class="stack course-notes">' + notes + (src ? '<div class="muted small">' + src + '</div>' : '') + '</div>' : '';
  }
  /**
   * 코스 정보 카드. 점수 칸 '아래'에 둔다: 이 카드는 내용에 따라 높이가 변하는데(공략 팁, 동반자가 실시간으로 넣는 정보, 약도),
   * 점수 칸 위에 있으면 높이가 변할 때마다 ＋/− 버튼이 손가락 밑에서 밀려 다른 사람 점수를 누르게 된다.
   * 펼쳤을 때는 미리보기(약도·공략)를 높이가 고정된 영역으로 입력란 바로 위에 둔다: 입력 결과가 바로 보이면서 입력란은 움직이지 않는다.
   */
  /** 홀 형태 칸 (약도가 없는 코스): 여기서 고른 형태로 도식을 그리고 공략 팁을 만든다. 약도가 있는 홀의 형태는 약도 기준이다(guideShape) */
  function shapeField(r, h) {
    var shape = A.holeInfo(r, h).shape;
    return '<label>홀 형태</label><div class="seg sm">' + [['L', '좌 도그렉'], ['S', '직선'], ['R', '우 도그렉']].map(function (o) {
      return '<button type="button" data-action="hi-shape" data-v="' + o[0] + '" class="' + (shape === o[0] ? 'active' : '') + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  /** 위험 요소 입력: 종류(OB·해저드·벙커)마다 한 줄, 위치(좌·우·그린 쪽)를 같은 자리에 나란히 둔다 */
  function hazGrid(haz) {
    return A.HAZ_GROUPS.map(function (g) {
      function cell(bit, text, full) {
        var on = !!(haz & bit);
        return '<button type="button" class="chip tap' + (on ? ' active' : '') + '" data-action="hi-haz" data-bit="' + bit + '" aria-pressed="' + on + '" aria-label="' + full + '">' + text + '</button>';
      }
      return '<span class="hg-name">' + g.name + '</span>' + cell(g.l, '좌', g.name + ' 좌') + cell(g.r, '우', g.name + ' 우') +
        (g.g ? cell(g.g, g.gName, g.gName + ' ' + g.name) : '<span></span>');
    }).join('');
  }
  /**
   * 키워드들을 메모 한 칸(공유 규칙상 최대 S.MEMO_MAX자)으로 잇는다. 보통은 ' · '로 잇고, 그러면 넘치는 경우에는 틈 없이 '·'로 잇는다
   * (읽을 때는 똑같이 나뉜다). 예전 버전에서 쉼표로 빽빽하게 적어 둔 긴 메모에서 키워드 하나를 지울 때 이음표가 길어져 뒤쪽 키워드가
   * 잘려 나가는 일이 없게 한다. 그래도 넘치면 null (넣지 않고 알려야 한다)
   */
  function joinKw(words) {
    var memo = words.join(A.MEMO_SEP);
    if (memo.length <= S.MEMO_MAX) return memo;
    memo = words.join('·');
    return memo.length <= S.MEMO_MAX ? memo : null;
  }
  /** 이 홀에 쓰다 만 키워드 (추가를 누르기 전의 입력란 내용. 다른 곳을 눌러 화면을 다시 그려도 남게 기억해 둔다) */
  function kwDraft(r, h) { var d = state.kwDraft; return d && d.rid === r.id && d.h === h ? d.v : ''; }
  /**
   * 입력란 글(text)을 이 홀의 키워드로 더한다. 반환: 더한 개수, 0(전부 이미 있음·빈 글), 'long'(24자를 넘는 키워드가 있음), 'full'(메모 한 칸이 넘침).
   * 잘라서 넣지 않는다: 토막이 저장되면 동반자에게도 그대로 간다. anyLength: 긴 키워드도 그대로 받는다 (쓰던 글을 두고 떠났을 때)
   */
  function addKeywords(r, h, text, anyLength) {
    var add = A.memoWords(text);
    if (!anyLength && add.some(function (w) { return w.length > KW_MAX; })) return 'long';
    var words = A.memoWords(A.holeInfo(r, h).memo), n = 0;
    add.forEach(function (w) { if (words.indexOf(w) < 0) { words.push(w); n++; } });
    if (!n) return 0;
    var memo = joinKw(words);
    if (memo === null) return 'full';
    settleUpgrade(r, h);
    setHoleInfo(r, h, 'memo', memo);
    return n;
  }
  /**
   * 추가를 누르지 않고 다른 홀이나 다른 화면으로 넘어갔으면, 쓰던 글을 그 홀의 키워드로 넣어 준다 (예전 메모 칸은 치는 대로 저장됐다).
   * 같은 홀에 머무는 동안에는 쓰던 글로 남겨 둔다. 떠난 뒤에는 고쳐 달라고 할 수 없으므로 24자를 넘는 글도 그대로 넣는다(예전에 문장으로 적던 메모처럼 보인다).
   * 칸이 가득 차 넣을 수 없으면 알려 주고, 글은 입력란에 남겨 돌아왔을 때 보이게 한다.
   * force: 라운드를 종료하거나 기록으로 넘기기 직전 (아직 그 홀에 있어도 넣는다)
   */
  function flushKwDraft(force) {
    var d = state.kwDraft, r = state.round;
    if (!d) return;
    if (!r || r.id !== d.rid) { state.kwDraft = null; return; } // 그 라운드는 이미 끝났다
    if (!force && state.view === 'play' && r.currentHole === d.h && !state.readOnly) return;
    if (state.readOnly || courseFixed(r, d.h) || !A.memoWords(d.v).length) { state.kwDraft = null; return; }
    var n = addKeywords(r, d.h, d.v, true);
    if (n === 'full') { if (!d.told) { d.told = true; toast((d.h + 1) + '번홀은 키워드 칸이 가득 차서 쓰던 글을 넣지 못했어요'); } return; }
    state.kwDraft = null;
    if (n) { save(); toast((d.h + 1) + '번홀에 쓰던 키워드를 추가했어요'); }
  }
  /** 공략 키워드 목록 (지우기 버튼이 달린 꼬리표) */
  function kwChips(r, h) {
    var words = A.memoWords(A.holeInfo(r, h).memo);
    if (!words.length) return '<span class="muted small">아직 없어요. 기억할 것을 짧게 하나씩 추가하세요.</span>';
    return words.map(function (w) {
      return '<span class="chip kwchip"><span class="t">' + esc(w) + '</span><button type="button" class="x" data-action="kw-del" data-kw="' + esc(w) + '" aria-label="' + esc(w) + ' 지우기">✕</button></span>';
    }).join('');
  }
  function courseBlock(r, h, par) {
    var info = A.holeInfo(r, h), open = courseOpen(r, h);
    // 코스 이름은 화면 맨 위의 라운드 이름과 다를 때만 적는다 (라운드 이름을 따로 안 적으면 코스 이름이 곧 라운드 이름이라 같은 글이 두 번 보인다)
    var cname = (r.course || '').trim(), sub = cname ? (cname === (r.name || '').trim() ? '' : cname) : (courseFixed(r, h) ? '' : '눌러서 입력');
    var title = '<span class="ttl">🗺️ ' + (h + 1) + '번홀 코스 정보</span><span class="sumtxt' + (cname ? '' : ' none') + '">' + esc(sub) + '</span>';
    var html = '<div class="card course" id="course-card">' + (courseFixed(r, h)
      ? '<div class="detail-head course-head">' + title + '</div>' // 보기 전용: 펼칠 입력란이 없으므로 누르는 머리말이 아니다
      : '<button class="detail-head course-head" data-action="course-toggle" aria-expanded="' + (open ? 'true' : 'false') + '"><span class="caret">' + (open ? '▾' : '▸') + '</span>' + title + '</button>');
    html += '<div id="course-live" data-region="course-live">' + courseLive(r, h, par) + '</div>';
    if (open) {
      html += '<div class="course-edit">' +
        '<div class="row top"><div class="field" data-region="ce-dist"><label>' + (h + 1) + '번홀 거리 (m)</label><input type="number" inputmode="numeric" min="0" max="999" data-hi="dist" value="' + (info.dist || '') + '" placeholder="예: 350" class="short"></div>' +
        '<div class="field grow" data-region="course-shape">' + shapeField(r, h) + '</div></div>' +
        '<div class="field"><label>위험 요소</label><div class="hazgrid" data-region="course-haz">' + hazGrid(info.haz) + '</div></div>' +
        '<div class="field"><label>공략 키워드' + (kwSource(r, h) ? ' <span class="muted">(공개 후기 참고)</span>' : '') + '</label>' +
        '<div class="chips" data-region="ce-kw">' + kwChips(r, h) + '</div>' +
        '<div class="kwadd" data-region="ce-kwadd"><input type="text" id="kw-in" data-kwin="1" value="' + esc(kwDraft(r, h)) + '" maxlength="' + S.MEMO_MAX + '" placeholder="예: 내리막, 우측 OB" enterkeyhint="done" autocomplete="off" aria-label="추가할 공략 키워드">' +
        '<button type="button" class="btn sm" data-action="kw-add">추가</button></div></div></div>';
    }
    // 코스 이름은 라운드 설정에서 고친다 (이 카드 머리말에 이미 보이므로 여기서는 입력란을 두지 않는다)
    if (open) html += '<div class="muted small" style="margin-top:8px">입력한 내용은 함께 입력 중인 동반자 화면에도 바로 반영돼요. ' +
      ((r.course || '').trim() ? '라운드를 마치면 고친 내용이 코스에 저장돼 다음 라운드에서 그대로 불러올 수 있어요.' : '⚙ 라운드 설정에서 코스 이름을 넣어 두면 라운드를 마칠 때 코스로 저장돼 다음 라운드에서 불러올 수 있어요.') + '</div>';
    return html + '</div>';
  }
  /** 거리 입력: 저장하고, 입력란은 그대로 둔 채 요약 줄·공략·약도만 다시 그린다 */
  function courseInput(el) {
    var r = state.round; if (!r || state.readOnly || el.dataset.hi !== 'dist') return;
    var h = r.currentHole;
    if (courseFixed(r, h)) return; // 보기 전용 홀 (입력란이 남아 있었다면 다음에 다시 그릴 때 사라진다)
    setHoleInfo(r, h, 'dist', el.value === '' ? null : Number(el.value));
    save();
    var set = function (id, html) { var n = document.getElementById(id); if (n) n.innerHTML = html; };
    set('course-live', courseLive(r, h, r.pars[h]));
    set('course-sum', courseSumInner(r, h));
    fitSummary();
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
  /** 기본으로 쓰는 코스 자료: 받은 코스가 있으면 그것, 아니면 앱에 들어 있는 기본 제공 코스 (내가 고쳐 저장한 사본은 savedCourse) */
  function builtinCourse(name, holes) { return libCourse(name, holes) || shippedCourse(name, holes); }
  /** 파·핸디캡·홀 정보가 같은지 비교하기 위한 서명 */
  function courseSig(c) {
    var out = [], pars = c.pars || [], si = c.strokeIndex || [];
    for (var h = 0; h < c.holes; h++) { var i = A.holeInfo(c, h); out.push([Number(pars[h]), Number(si[h]), i.dist, i.shape, i.haz, i.memo]); }
    return JSON.stringify(out);
  }
  /**
   * 라운드를 기록으로 보낼 때의 자동 저장 (코스를 저장하는 유일한 길). 저장해 둔 코스를 통째로 덮어쓰지 않는다.
   *  - 같은 이름으로 저장한 코스가 없으면 새로 저장한다. 단, 기본 제공 코스는 이 라운드에서 고친 칸이 있을 때만 사본을 만들고,
   *    그 사본은 '지금의' 기본 제공 값에 고친 칸만 얹어서 만든다. 라운드가 예전 기본 제공 값으로 만들어졌더라도
   *    (앱이 갱신되기 전에 시작한 라운드) 옛 값의 사본이 바로잡힌 기본 제공 코스를 가리지 않게 한다.
   *  - 저장한 코스가 있으면 이번 라운드에서 실제로 고친 칸만 반영한다 (그 칸의 수정 시각이 라운드 생성 시각보다 뒤인 것).
   *    코스를 불러오지 않고 이름만 적은 라운드나 다른 사람이 만든 라운드에 참여한 경우에도 내가 저장해 둔 파·거리·메모가 지워지지 않는다.
   */
  function autoSaveCourse(r) {
    var name = (r.course || '').trim(); if (!name) return;
    var rev = r.rev || {}, t0 = r.createdAt || 0, n = 0;
    // 이 라운드에서 고친 칸 중 이미 이 코스에 반영한 것은 다시 반영하지 않는다 (r.courseApplied: 칸별로 반영한 수정 시각, 기기 전용).
    // 참여 링크를 다시 눌러 기록에서 되살린 라운드를 또 보관할 때, 그 뒤 라운드에서 고친 값이나 지운 코스가 옛 값으로 돌아가지 않게 한다
    var done = r.courseApplied && r.courseApplied.name === name ? r.courseApplied.keys || {} : null; // null: 이 코스에 처음 반영하는 라운드
    // 보기 전용 홀(약도가 있는 홀)의 홀 정보는 이 기기에서 고칠 수 없으므로 '고친 칸'으로 치지 않는다:
    // 예전 버전을 쓰는 동반자가 그 홀의 위험 요소나 메모를 건드렸다고 내 코스 사본이 생겨 다음 라운드까지 따라오지 않게 한다 (파·핸디캡은 그대로 반영)
    var mine = Object.keys(rev).filter(function (k) {
      if (!/^(par|si|hi):/.test(k) || !rev[k] || !(rev[k].ts > t0)) return false;
      var hm = /^hi:(\d+):/.exec(k);
      return !(hm && courseFixed(r, Number(hm[1])));
    });
    var fresh = {}, nFresh = 0;
    mine.forEach(function (k) { if (!done || done[k] !== rev[k].ts) { fresh[k] = 1; nFresh++; } });
    function edited(k) { return fresh[k] === 1; }
    function applied() { var keys = {}; mine.forEach(function (k) { keys[k] = rev[k].ts; }); r.courseApplied = { name: name, keys: keys }; }
    var old = savedCourse(name, r.holes);
    if (!old || !Array.isArray(old.pars) || old.pars.length !== r.holes || !Array.isArray(old.strokeIndex) || old.strokeIndex.length !== r.holes) {
      var bi = old ? null : builtinCourse(name, r.holes);
      if (!bi) {
        if (done && !old && !nFresh) return; // 이미 반영했던 라운드에 새로 고친 칸이 없음: 그 사이 지운 코스를 되살리지 않는다
        saveCourse(r); applied(); return;
      }
      if (!nFresh) { applied(); return; } // 기본 제공 코스를 고치지 않았다: 사본을 만들지 않는다
      old = { name: name, holes: r.holes, pars: bi.pars.slice(), strokeIndex: bi.strokeIndex.slice(), holeInfo: clone(bi.holeInfo || {}), updatedAt: Date.now() };
      state.courses = [old].concat(state.courses || []);
    }
    old.holeInfo = old.holeInfo || {};
    for (var h = 0; h < r.holes; h++) {
      if (edited('par:' + h) && old.pars[h] !== r.pars[h]) { old.pars[h] = r.pars[h]; n++; }
      if (edited('si:' + h) && old.strokeIndex[h] !== r.strokeIndex[h]) { old.strokeIndex[h] = r.strokeIndex[h]; n++; }
      var cur = A.holeInfo(r, h), info = Object.assign({}, old.holeInfo[h] || {}), before = JSON.stringify(info);
      S.HOLE_FIELDS.forEach(function (f) { if (edited('hi:' + h + ':' + f)) { if (cur[f]) info[f] = cur[f]; else delete info[f]; } });
      var mask = Number(info.haz) > 0 ? Number(info.haz) : 0; // 저장된 값 그대로 (읽을 때 번역표로 덧붙는 OB 표시는 넣지 않는다: 고친 칸만 반영)
      S.HAZ_BITS.forEach(function (bit) { if (edited('hi:' + h + ':z' + bit)) mask = (cur.haz & bit) ? (mask | bit) : (mask & ~bit); });
      if (mask) info.haz = mask; else delete info.haz;
      if (JSON.stringify(info) === before) continue;
      n++;
      if (Object.keys(info).length) old.holeInfo[h] = info; else delete old.holeInfo[h];
    }
    applied();
    if (bi && !n) { state.courses = state.courses.filter(function (c) { return c !== old; }); return; } // 고친 값이 결국 기본 제공 값과 같다: 사본이 필요 없다
    if (n) old.updatedAt = Date.now();
    state.courses = [old].concat(state.courses.filter(function (c) { return c !== old; })); // 최근에 친 코스가 앞에 오도록
  }
  /** 고를 수 있는 코스: 내가 저장한 코스가 먼저, 그다음 기본 제공 코스(같은 이름을 저장했다면 내 것이 우선) */
  function courseList(holes) {
    var mine = (state.courses || []).filter(function (c) { return c && c.holes === holes; });
    var names = {}; mine.forEach(function (c) { names[c.name] = 1; });
    var got = lib.courses.filter(function (c) { return c.holes === holes && !names[c.name]; });
    got.forEach(function (c) { names[c.name] = 1; });
    return mine.concat(got).concat(BUILTIN_COURSES.filter(function (c) { return c.holes === holes && !names[c.name]; }));
  }
  function isBuiltinCourse(name, holes) {
    name = (name || '').trim();
    return !(state.courses || []).some(function (c) { return c.name === name && c.holes === holes; }) && !!builtinCourse(name, holes);
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
  /** 스킨스 공금 설정의 한 줄: 왼쪽에 항목 이름, 오른쪽에 금액 칸 */
  function fundRow(label, path, value, step, disabled) { return '<span class="lab">' + label + '</span>' + numField(path, value, '원', step, disabled); }
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
    var html = topbar('제이크의 야디지북', '', '', '');
    html += '<div class="screen">';
    html += '<div class="hero"><div class="logo">⛳</div><h1>제이크의 야디지북</h1><div class="en">Jake\'s Yardagebook</div><p>스코어 · 내기&nbsp;정산 · 홀&nbsp;약도 · 함께&nbsp;입력</p></div>'; // 좁은 화면에서는 가운뎃점 자리에서만 줄이 바뀐다
    if (r) {
      var done = holesDone(r);
      html += '<div class="card"><h2>진행 중인 라운드 <span class="hint">' + esc(r.date) + '</span></h2>' +
        '<div style="font-size:18px;font-weight:800">' + esc(r.name || '라운드') + (sharingActive() ? ' <span class="chip sm active">함께 ' + esc(S.formatCode(r.share.code)) + '</span>' : '') + '</div>' +
        '<div class="muted small">' + r.players.map(function (p) { return esc(p.name); }).join(', ') + ' · ' + done + '/' + r.holes + '홀 입력</div>' +
        '<div class="row" style="margin-top:12px"><button class="btn primary grow" data-action="go" data-view="play">이어하기</button><button class="btn grow" data-action="go" data-view="board">리더보드</button></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn sm grow" data-action="go" data-view="share">👥 ' + (sharingActive() ? '함께 입력 중' : '함께 입력') + '</button><button class="btn sm ghost grow" data-action="finish">라운드 종료</button><button class="btn sm ghost danger" data-action="discard">삭제</button></div></div>';
    }
    html += '<button class="btn primary big block" data-action="new-round">＋ 새 라운드 시작</button>';
    html += '<button class="btn block" data-action="open-courses" data-back="home">⛳ 골프장 받기 · 코스 보내기</button>';
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
        '<div class="muted small" style="margin-top:6px">' + (holesDone(r) || courseEdited(r) ? '참여하면 지금 라운드는 기록으로 저장돼요.' : '아직 입력한 홀이 없어 지금 라운드는 그냥 대체돼요.') + '</div></div>';
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

  /** 홀 번호 목록(0부터)을 '1~3번홀', '10~18, 1~2번홀'처럼 적는다 (이어지는 번호는 묶는다) */
  function holeRanges(list) {
    var out = [], i = 0;
    while (i < list.length) {
      var j = i;
      while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
      out.push(i === j ? String(list[i] + 1) : (list[i] + 1) + '~' + (list[j] + 1));
      i = j + 1;
    }
    return out.join(', ') + '번홀';
  }
  /** 내기를 시작하기 전에 친 홀들의 번호(0부터, 친 순서). 처음부터면 빈 목록 */
  function betBefore(all, r) {
    var out = [];
    if (all.skip) A.playOrder(r).order.forEach(function (h) { if (all.skip[h]) out.push(h); });
    return out;
  }

  function gameCard(title, desc, enabledPath, enabled, body, noMoney) {
    return '<div class="card">' +
      (noMoney ? '<h2>' + title + '</h2>' : toggle(enabledPath, enabled, title + ' <span class="muted small" style="font-weight:500">정산 포함</span>')) +
      '<div class="desc" ' + (noMoney ? 'style="margin-left:0"' : '') + '>' + desc + '</div>' +
      (body ? '<div class="opts">' + body + '</div>' : '') + '</div>';
  }

  function gamesSection(prefix, g, holes) {
    fillGames(g); // 어떤 경로로 왔든 빠진 게임 설정이 없게 한다
    var P = prefix + '.games.';
    var html = '<div class="notice">모든 게임은 입력한 개인 스코어로 <b>항상 자동 계산</b>돼요. 토글은 그 게임의 금액을 정산에 넣을지만 정합니다.</div>';
    // 내기 시작 홀: N번째로 치는 홀부터 돈이 걸린 게임을 센다 (몸이 풀린 뒤부터 내기를 하는 경우). 값은 stroke.from에 둔다 (양파 한도처럼 라운드 전체의 규칙).
    // 진행 중인 라운드에서는 친 순서(10번홀 출발이면 10번홀이 첫 번째)를 따라 빠지는 홀을 적는다
    var bf = Math.floor(Number(g.stroke.from)); bf = bf >= 2 && bf <= holes ? bf : 1;
    var ord = prefix === 'round' && state.round ? A.playOrder(state.round).order : null, before = [];
    for (var bk = 0; bk < bf - 1; bk++) before.push(ord ? ord[bk] : bk);
    var presets = [[1, '처음부터'], [4, '4번째 홀부터']]; if (holes === 18) presets.push([10, '후반부터']);
    var stepBtn = function (v, label, off) { return '<button type="button" class="btn sm" data-action="set" data-path="' + P + 'stroke.from" data-value="' + v + '" data-type="number" ' + (off ? 'disabled' : '') + '>' + label + '</button>'; };
    html += '<div class="card betfrom"><h2>내기 시작 홀</h2><div class="desc" style="margin-left:0">몸이 풀린 뒤부터 내기를 하려면 고르세요. 그 앞에 친 홀은 순위와 기록에만 들어가고, 스킨스 · 오장 · 매치처럼 돈이 걸린 게임에서는 모두 빠져요.</div>' +
      '<div class="opts">' + seg(P + 'stroke.from', bf, presets, 'wide') +
      '<span class="optbreak"></span><span class="lab">직접</span>' + stepBtn(bf - 1, '−', bf <= 1) + '<b class="bfnum">' + bf + '번째 홀부터</b>' + stepBtn(bf + 1, '＋', bf >= holes) +
      '<span class="optnote">' + (bf > 1 ? '<b>' + bf + '번째로 치는 홀(' + ((ord ? ord[bf - 1] : bf - 1) + 1) + '번홀)부터</b> 내기를 해요. 그 앞의 ' + (bf - 1) + '홀(' + holeRanges(before) + ')은 내기에서 빠져요.' : '처음부터 모든 홀에 내기를 해요.') + '</span></div></div>';
    html += '<div class="card"><h2>스트로크 플레이</h2><div class="desc" style="margin-left:0">총 타수 순위. 금액을 넣으면 타수 차 × 단가로 1:1 정산</div>' +
      '<div class="opts"><span class="lab">타당</span>' + numField(P + 'stroke.unit', g.stroke.unit, '원 (0이면 순위만)') +
      toggle(P + 'stroke.net', g.stroke.net, '네트(핸디 적용) 기준') +
      // 양파 한도: 한 홀 타수를 파의 두 배까지만 센다. 모든 순위·게임·분석에 똑같이 적용된다
      '<span class="optbreak"></span>' + toggle(P + 'stroke.cap', g.stroke.cap, '양파 한도 <span class="muted small" style="font-weight:500">홀당 최대 파의 두 배</span>') +
      '<span class="optnote">켜면 한 홀 타수를 양파(파3 6타 · 파4 8타 · 파5 10타)까지만 세요. 그보다 많이 친 홀도 양파로 계산하고, 모든 게임과 순위에 똑같이 적용됩니다.</span>' +
      '</div></div>';
    html += gameCard('스테이블포드', '홀별 점수 합산: 버디 3 · 파 2 · 보기 1 · 이글 4 · 더블보기 이하 0 (순위만)', null, true,
      toggle(P + 'stableford.net', g.stableford.net, '네트(핸디 적용)'), true);
    // 스킨스: 돈 계산은 '서로 주고받기'(스킨당 금액) 또는 '공금'(각자 낸 돈에서 시작 지급·홀 상금·OECD 벌금·캐디피) 가운데 고른다
    var sk = g.skins;
    html += gameCard('스킨스', '홀마다 단독 최저타가 스킨 획득. 동타면 다음 홀로 이월(캐리오버)', P + 'skins.enabled', sk.enabled,
      '<span class="lab">방식</span>' + seg(P + 'skins.mode', sk.mode, [['individual', '개인'], ['team', '팀(베스트볼)']]) +
      toggle(P + 'skins.net', sk.net, '네트') +
      (sk.mode === 'team' ? '' : '<span class="optbreak"></span>' + toggle(P + 'skins.fund', sk.fund, '공금 방식 <span class="muted small" style="font-weight:500">각자 돈을 내고 시작</span>')) +
      (sk.fund && sk.mode !== 'team'
        ? '<div class="fundgrid">' +
          fundRow('각자 내는 돈', P + 'skins.stake', sk.stake, 10000, !sk.enabled) +
          fundRow('홀당 상금', P + 'skins.prize', sk.prize, 1000, !sk.enabled) +
          fundRow('시작할 때 플레이어 각각', P + 'skins.start', sk.start, 1000, !sk.enabled) +
          fundRow('시작할 때 캐디', P + 'skins.tip', sk.tip, 1000, !sk.enabled) +
          fundRow('캐디피', P + 'skins.caddie', sk.caddie, 10000, !sk.enabled) + '</div>' +
          toggle(P + 'skins.collect', sk.collect, '공금을 미리 걷음 <span class="muted small" style="font-weight:500">돈을 걷고 시작 지급도 함</span>') +
          '<span class="optbreak"></span>' +
          toggle(P + 'skins.oecd', sk.oecd, 'OECD 룰 <span class="muted small" style="font-weight:500">상금을 많이 받은 사람 벌금</span>') +
          (sk.oecd ? '<div class="fundgrid">' + fundRow('가입 기준 (받은 상금)', P + 'skins.join', sk.join, 10000, !sk.enabled) +
            fundRow('벌금 (걸린 항목마다)', P + 'skins.fine', sk.fine, 1000, !sk.enabled) + '</div>' : '') +
          '<span class="optnote">각자 낸 돈을 모은 공금에서 시작할 때 플레이어와 캐디에게 나눠 주고, 홀 상금을 승자에게 줘요. ' +
          // 가입 기준 금액에 따라 글이 달라지지 않게 두 경우를 함께 적는다 (아래 설명 참고: 금액 칸은 입력할 때 화면을 다시 그리지 않는다)
          (sk.oecd ? '상금으로 받은 돈(낸 벌금은 뺌)이 <b>가입 기준</b> 이상이 된 사람(OECD 가입)이 그다음 홀부터 <b>OB · 벙커 · 해저드 · 3퍼트 · 트리플 이상</b>을 하면 항목마다 벌금을 공금에 넣어요. 벌금을 내서 가입 기준 아래로 내려가면, 다시 채울 때까지는 벌금이 없어요. 가입 기준을 0으로 두면 본전 기준이에요: 공금에서 받은 돈(시작 지급 포함)이 낸 돈 이상일 때 가입해요. OB·벙커·해저드·퍼트는 📝 상세 기록에 입력한 값으로 판정합니다. ' : '') +
          '끝나면 남은 공금으로 캐디피를 내고, 모자라면 똑같이 나눠 내요. 홀마다 돈을 나눠 주지 않아도 리더보드에 누가 얼마를 가져갔는지 쌓이고, 끝나고 한 번에 나누면 됩니다. ' +
          // 이 글은 입력한 금액에 따라 바뀌지 않게 둔다 (금액 칸은 입력할 때 화면을 다시 그리지 않아, 금액을 따지는 글은 옛 내용으로 남는다)
          (sk.collect ? '<b>미리 걷음</b>: 정산은 걷어 둔 돈에서 누구에게 얼마를 줄지로 나와요. 걷은 돈(각자 내는 돈 × 인원)이 시작할 때 나눠 준 돈보다 많지 않으면 걷지 않은 것으로 정리해요.'
            : '<b>안 걷음</b>: 정산은 누가 누구에게(캐디 포함) 얼마를 보낼지로 나와요.') + '</span>'
        : '<span class="optbreak"></span><span class="lab">스킨당</span>' + numField(P + 'skins.unit', sk.unit, '원', 100, !sk.enabled) +
          '<span class="optnote">' + (sk.mode === 'team' ? '스킨 하나에 진 팀 각자가 이 금액을 내고 이긴 팀이 나눠 가져요. 공금 방식은 개인전에서만 쓸 수 있어요.' : '스킨 하나에 다른 사람 각각이 이 금액을 줘요.') + '</span>'));
    // 오장: 홀마다 타수 차 × 타당 금액, 조건에 따라 배판. 이름은 기본 금액 5천 원에서 왔고 금액은 바꿀 수 있다
    html += gameCard('오장 <span class="muted small" style="font-weight:500">타당 스트로크 · 배판</span>',
      '홀마다 타수 차 × 타당 금액을 서로 주고받아요. <b>버디 이하 · 트리플 이상 · 파3 더블 이상 · 3명 이상 동타</b>가 나온 홀은 배판(2배)',
      P + 'ojang.enabled', g.ojang.enabled,
      '<span class="lab">타당</span>' + numField(P + 'ojang.unit', g.ojang.unit, '원', 1000, !g.ojang.enabled) + toggle(P + 'ojang.net', g.ojang.net, '네트') +
      '<span class="optbreak"></span>' + toggle(P + 'ojang.carry', g.ojang.carry, '전원 동타면 다음 홀 배판') + toggle(P + 'ojang.birdie', g.ojang.birdie, '버디값 +1타') + toggle(P + 'ojang.near', g.ojang.near, '파3 니어 +1타') +
      '<span class="optnote">니어는 파3에서 니어리스트로 고른 사람이 파 이하로 마쳤을 때만 받아요(파를 못 하면 없던 것으로). 버디값과 니어는 다른 사람 각각에게서 1타 금액을 받고, 배판 홀에서는 2배예요. 조건이 여러 개 겹쳐도 2배입니다.</span>');
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
      toggle(P + 'bonus.nearest', g.bonus.nearest, '니어리스트 정산 포함') +
      toggle(P + 'bonus.longest', g.bonus.longest, '롱기스트 정산 포함') +
      toggle(P + 'bonus.birdie', g.bonus.birdie, '버디 보너스 정산 포함 (이글은 2배)') +
      '</div><div class="opts"><span class="lab">1회당 (다른 플레이어 각각 지급)</span>' + numField(P + 'bonus.unit', g.bonus.unit, '원') + '</div>' +
      // 니어·롱기를 고를 수 있는 홀과 지우개 룰. 횟수 집계, 보너스 정산, 오장의 니어에 똑같이 적용된다 (games.js의 nearInfo · longOf)
      '<h2 style="margin-top:14px">니어 · 롱기 룰</h2><div class="stack">' +
      toggle(P + 'bonus.parthree', g.bonus.parthree, '니어는 파3 홀에서만') +
      toggle(P + 'bonus.parfive', g.bonus.parfive, '롱기는 파5 홀에서만') +
      toggle(P + 'bonus.eraser', g.bonus.eraser, '지우개 <span class="muted small" style="font-weight:500">파3에서 니어를 지움</span>') +
      '</div><div class="muted small" style="margin-top:8px">켜 두면 스코어 입력 화면에서 니어는 파3 홀, 롱기는 파5 홀에서만 고를 수 있어요. ' +
      '<b>지우개</b>: 파3에서 그린에 올리지 못한 사람이 파 이하로 마치면 그 홀의 니어를 지워요(니어 없음). 니어를 고르면 그 아래에 지운 사람을 고르는 줄이 나옵니다. 지워진 니어는 오장에서도 없던 것으로 해요.</div></div>';
    return html;
  }

  function viewSetup() {
    var d = state.draft;
    var html = topbar('새 라운드', '', backBtn('home'), '');
    html += '<div class="screen">';
    html += '<div class="card"><h2>라운드 정보</h2><div class="stack">' +
      '<div class="field"><label>라운드 / 골프장 이름</label><input type="text" data-bind="draft.name" value="' + esc(d.name) + '" placeholder="예: 주말 라운딩 @ ○○CC" maxlength="60"></div>' +
      // min-width:0: 좁은 폰(320~344px)에서 날짜 칸이 줄어들지 못해 홀 수 선택이 카드 밖으로 밀려났다
      '<div class="row"><div class="field grow" style="min-width:0"><label>날짜</label><input type="date" data-bind="draft.date" value="' + esc(d.date) + '"></div>' +
      '<div class="field"><label>홀 수</label>' + seg('draft.holes', d.holes, [[9, '9홀'], [18, '18홀']]) + '</div></div>' +
      '<div class="field"><label>코스 <span class="muted">(선택)</span></label><input type="text" data-bind="draft.course" value="' + esc(d.course || '') + '" placeholder="예: 베어크리크 포천 · 베어" maxlength="' + S.COURSE_MAX + '" autocomplete="off">' +
      (function () {
        var list = courseList(d.holes);
        if (!list.length) return '';
        return '<div class="chips" style="margin-top:6px"><span class="small muted">코스 불러오기</span>' + list.map(function (c) {
          return '<button class="chip tap ' + ((d.course || '').trim() === c.name ? 'active' : '') + '" data-action="pick-course" data-name="' + esc(c.name) + '">' + esc(c.name) + '</button>';
        }).join('') + '</div>';
      })() +
      (function () { // 받은 코스 중 홀 수가 달라 위에 나오지 않는 것이 있으면 알려 준다 (받았는데 안 보여서 못 받은 줄 아는 일이 없게)
        var other = d.holes === 18 ? 9 : 18, n = lib.courses.filter(function (c) { return c.holes === other; }).length;
        return n ? '<div class="small muted" data-note="otherholes" style="margin-top:6px">받은 ' + other + '홀 코스 ' + n + '개는 홀 수를 ' + other + '홀로 바꾸면 나와요.</div>' : '';
      })() +
      '<button class="btn sm" data-action="open-courses" data-back="setup" style="margin-top:8px">📥 다른 골프장 받기</button></div>' +
      '<div class="muted small">' + (findCourse(d.course, d.holes) ? (isBuiltinCourse(d.course, d.holes) ? (libCourse(d.course, d.holes)
          ? (courseMapOf(d.course, d.holes) ? '받은 코스예요. 파·핸디캡·홀 정보와 홀 약도가 채워지고, 파·핸디캡은 입력 화면에서 바로 고칠 수 있어요.'
            : '받은 코스예요. 파·핸디캡·홀 정보가 채워지고, 현장과 다르면 입력 화면에서 바로 고칠 수 있어요.')
          : courseMapOf(d.course, d.holes)
          ? '공개 자료를 정리한 기본 제공 코스예요. 파·핸디캡·거리(화이트티)와 홀 약도·공략 키워드가 채워지고, 파·핸디캡은 입력 화면에서 바로 고칠 수 있어요.'
          : '공개 자료를 정리한 기본 제공 코스예요. 파·핸디캡·거리(화이트티)가 채워지고, 현장 스코어카드와 다르면 입력 화면에서 바로 고칠 수 있어요.') : '내가 저장한 코스의 파·핸디캡·홀 정보로 시작해요. <button class="btn sm ghost" data-action="del-course">' + (libCourse(d.course, d.holes) ? '받은 값으로 되돌리기' : shippedCourse(d.course, d.holes) ? '기본 제공 값으로 되돌리기' : '저장한 코스 삭제') + '</button>') : '파/핸디캡 인덱스는 기본값(파72)으로 시작하고, 스코어 입력 화면에서 홀마다 파·거리·위험 요소·키워드를 넣을 수 있어요.') + '</div></div></div>';
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
    html += '<div class="notice">라운드 중에도 팀·게임·금액을 바꿀 수 있어요. ' + (sharingActive() ? '결과는 즉시 다시 계산되고 <b>함께하는 모든 참가자에게 적용</b>됩니다.' : '결과는 즉시 다시 계산돼요.') + '</div>';
    html += '<div class="card"><h2>라운드 정보</h2><div class="stack">' +
      '<div class="field"><label>이름</label><input type="text" data-bind="round.name" value="' + esc(r.name) + '" maxlength="60"></div>' +
      // 코스 이름은 모든 홀에 공통이라 홀마다 보이는 코스 정보 카드가 아니라 여기서 고친다
      '<div class="field"><label>코스 이름</label><input type="text" data-bind="round.course" value="' + esc(r.course || '') + '" maxlength="' + S.COURSE_MAX + '" placeholder="예: 베어크리크 포천 · 베어" autocomplete="off"></div>' +
      '<div class="muted small">코스 이름이 있으면 라운드를 마칠 때 홀 정보(파·거리·위험 요소·키워드)가 이 기기에 코스로 저장돼 다음 라운드에서 불러올 수 있어요.</div>' +
      '</div></div>';
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
            : '<span class="v">' + s + '</span><span class="l ' + tpClass(diff) + '">' + G.toParLabel(diff, par) + '</span><span class="x" data-action="score-clear" data-pid="' + pid + '">×</span>') +
          '</button>' +
          '<button class="pm" data-action="score" data-pid="' + pid + '" data-delta="1">＋</button>';
      } else { // 내 점수만 모드: 다른 사람 점수는 실시간으로 보이기만 함
        row += '<span></span><div class="scorebox ro ' + (s !== null ? 'set' : '') + '" data-pid="' + pid + '">' +
          (s === null ? '<span class="v empty">–</span><span class="l">입력 전</span>' : '<span class="v">' + s + '</span><span class="l ' + tpClass(diff) + '">' + G.toParLabel(diff, par) + '</span>') +
          '</div><span></span>';
      }
      row += '</div>';
      if (editable && state.detailOn) row += detailBlock(r, p, h, par, !!open[p.id]);
      return row;
    }).join('');
    html += '<div class="quick" style="margin-top:10px">' +
      (mode === 'all' ? '<button class="btn sm grow" data-action="par-all">전원 파 입력</button><button class="btn sm ghost" data-action="clear-hole">홀 초기화</button>' : '') +
      '<button class="btn sm ' + (state.detailOn ? 'on' : '') + (mode === 'all' ? '' : ' grow') + '" data-action="toggle-detail" aria-pressed="' + (state.detailOn ? 'true' : 'false') + '">📝 상세 기록</button></div>'; // 켜고 꺼도 글자가 같다: 길이가 바뀌면 버튼 줄이 다시 접혀 누른 자리가 달라짐 (켜짐은 색으로 표시)
    if (mode === 'mine') html += '<div class="muted small" style="margin-top:8px">다른 사람 점수는 각자 입력하면 여기에 바로 보여요. 폰이 없는 동반자 점수는 위에서 <b>모두 입력</b>으로 바꿔 넣을 수 있어요.</div>';
    if (!sharingActive() && holesDone(r) < 2 && !state.hintSeen) html += '<div class="muted small" style="margin-top:8px">동반자도 각자 입력하게 하려면 맨 위의 <b>👥 함께</b>를 눌러 코드를 보내세요. <button class="btn sm ghost" data-action="dismiss-hint">닫기</button></div>';
    html += '</div>';
    html += courseBlock(r, h, par);
    html += '<div data-region="coach" style="display:contents">' + coachCard(r) + '</div>';
    html += '<div data-region="extras" style="display:contents">' + extrasCard(r, h, par) + '</div>';
    html += '<div data-region="summary" style="display:contents">' + liveSummary(r) + '</div>';
    html += '<div class="navbtns" data-region="nav"><button class="btn" data-action="hole" data-i="' + (h - 1) + '" ' + (h === 0 ? 'disabled' : '') + '>‹ 이전 홀</button>' +
      (h === r.holes - 1 ? '<button class="btn primary" data-action="finish">라운드 종료 🏁</button>'
        : '<button class="btn ' + (allIn ? 'primary' : '') + '" data-action="hole" data-i="' + (h + 1) + '">다음 홀 ›</button>') + '</div>';
    html += '</div>';
    html += '<div data-region="mapzoom" style="display:contents">' + mapZoom(r, h, par) + '</div>';
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
    var all = computeAll(r), parts = [];
    // 내기 시작 홀을 정한 라운드: 지금 홀이 내기 전이면 알린다 (아래 스킨스 · 오장 · 매치 줄은 내기를 시작한 홀부터 센 값이다)
    if (all.skip && all.skip[r.currentHole]) parts.push('<div class="kv"><span class="k">내기</span><span><b>이 홀은 내기 전</b> <span class="muted">(' + all.betFrom + '번째 홀부터 내기)</span></span></div>');
    var top = all.stroke.rows.filter(function (p) { return p.played; }).slice(0, 3);
    if (top.length) parts.push('<div class="kv"><span class="k">순위</span><span>' + top.map(function (p) { return (p.rank || '-') + '위 ' + esc(p.name) + ' <span class="' + tpClass(p.toPar) + '">' + G.fmtToPar(p.toPar) + '</span>'; }).join(' · ') + '</span></div>');
    if (all.skins && !all.skins.error) {
      parts.push('<div class="kv"><span class="k">스킨스' + (all.skins.enabled ? ' ₩' : '') + '</span><span>' + all.skins.entrants.map(function (e) { return esc(e.name) + ' ' + e.skins + (e.oecd && all.skins.enabled ? '<span class="oecd">OECD</span>' : ''); }).join(' · ') + (all.skins.carry ? ' <b style="color:#7a5a00">(이월 ' + all.skins.carry + ')</b>' : '') + '</span></div>');
    }
    if (all.ojang && all.ojang.enabled && !all.ojang.error) {
      parts.push('<div class="kv"><span class="k">오장 ₩</span><span>' + all.ojang.rows.map(function (x) { return esc(x.name) + ' <span class="' + (x.amount > 0 ? 'pos' : x.amount < 0 ? 'neg' : '') + '">' + signedWon(x.amount) + '</span>'; }).join(' · ') +
        (all.ojang.holes[r.currentHole] && all.ojang.holes[r.currentHole].pendingDouble ? ' <b style="color:#7a5a00">(이 홀 배판)</b>' : '') + '</span></div>');
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
    var all = computeAll(r);
    var tabs = [['stroke', '종합'], ['stableford', '스테이블포드'], ['skins', '스킨스'], ['ojang', '오장'], ['match', '매치']];
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
      return '<button data-action="tab" data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'active' : '') + (gameOff(all, t[0]) ? ' off' : '') + '">' + t[1] + (inc ? ' ₩' : '') + '</button>';
    }).join('') + '</div>';
    var body = ({
      stroke: tabStroke, stableford: tabStableford, skins: tabSkins, ojang: tabOjang, match: tabMatch, nassau: tabNassau,
      bestball: tabBestball, vegas: tabVegas, bonus: tabBonus, settle: tabSettle
    })[tab](r, all);
    // 내기 시작 홀을 정한 라운드: 돈이 걸리는 탭마다 어느 홀부터인지 알린다 (종합은 타당 금액이 있을 때만. 스테이블포드는 돈이 없다)
    if (all.betFrom > 1 && tab !== 'stableford' && !(tab === 'stroke' && !(r.games.stroke.unit > 0))) {
      var bb = betBefore(all, r), first = A.playOrder(r).order[all.betFrom - 1];
      html += '<div class="notice betnote">내기는 <b>' + all.betFrom + '번째 홀(' + (first + 1) + '번홀)부터</b>예요. 그 앞의 ' + bb.length + '홀(' + holeRanges(bb) + ')은 순위와 기록에만 들어가요.</div>';
    }
    // 꺼 둔 게임: 계산은 그대로 보여 주되(참고용) 맨 위에 꺼져 있다고 알리고 내용은 흐리게 둔다
    html += gameOff(all, tab) ? offNotice(tab) + '<div class="gameoff">' + body + '</div>' : body;
    html += '</div>' + bottomNav('board');
    return html;
  }

  /** 리더보드 탭의 게임이 정산에서 꺼져 있는지. 종합 · 스테이블포드 · 정산은 켜고 끄는 게임이 아니다. 보너스는 니어 · 롱기 · 버디가 모두 꺼졌을 때 */
  function gameOff(all, key) {
    var g = all[key];
    if (!g) return false;
    if (key === 'bonus') return !(g.enabled && (g.enabled.nearest || g.enabled.longest || g.enabled.birdie));
    return ['skins', 'ojang', 'match', 'nassau', 'bestball', 'vegas'].indexOf(key) >= 0 && !g.enabled;
  }
  /** 꺼 둔 게임의 탭 맨 위 안내. 진행 중인 라운드에서는 바로 켤 수 있다 (보너스는 탭 안의 세 단추로 켠다) */
  function offNotice(key) {
    return '<div class="notice off"><span><b>꺼 둔 게임이에요.</b> ' +
      (key === 'bonus' ? '니어 · 롱기 · 버디 내기를 모두 꺼 두어서 정산에 들어가지 않아요. 아래 내용은 참고용이에요.' : '정산에 들어가지 않고, 아래 내용은 참고용이에요.') + '</span>' +
      (state.readOnly || key === 'bonus' ? '' : '<button class="btn sm" data-action="toggle-money" data-key="' + key + '">정산에 넣기</button>') + '</div>';
  }

  /** 리더보드의 게임별 룰 설명 한 줄. text는 앱이 만든 글(금액은 won()으로)만 넣는다 */
  function ruleLine(text) { return '<div class="rule"><b>룰</b>' + text + '</div>'; }

  function tabStroke(r, all) {
    var res = G.strokePlay(r, { net: state.boardNet, unit: r.games.stroke.unit });
    var hasHcp = r.players.some(function (p) { return p.hcp > 0; });
    var me = myPid();
    var sg = r.games.stroke;
    var html = '<div class="card"><h2>순위' + (hasHcp ? '<span class="hint">' + seg('boardNet', state.boardNet, [[false, '그로스'], [true, '네트']]) + '</span>' : '') + '</h2>' +
      ruleLine((hasHcp && state.boardNet ? '스트로크 플레이(네트): 핸디를 뺀 타수의 파 대비(네트 칸의 괄호)가 낮을수록 순위가 높아요.'
        : '스트로크 플레이: 파 대비 타수(±파)가 낮을수록 순위가 높아요.' + (hasHcp ? ' 네트는 핸디를 뺀 타수예요.' : '')) +
        (sg.cap ? ' 양파 한도: 한 홀은 파의 두 배까지만 세요.' : '') +
        (sg.unit > 0 ? ' 내기는 전원이 친 홀의 ' + (sg.net ? '네트 ' : '') + '타수 차 × 타당 ' + won(sg.unit) + '을 둘씩 주고받아요.' : ''));
    // 핸디가 있으면 네트 칸까지 여섯 칸이다: 좁은 화면에서 표가 카드 밖으로 나가지 않게 칸 여백을 줄인다 (styles.css의 table.ranks)
    html += '<table class="ranks' + (hasHcp ? ' hcp' : '') + '"><thead><tr><th></th><th class="l">플레이어</th><th>홀</th><th>타수</th><th>±파</th>' + (hasHcp ? '<th>네트</th>' : '') + '</tr></thead><tbody>';
    res.rows.forEach(function (p) {
      html += '<tr class="' + (me === p.id ? 'me' : '') + '"><td>' + (p.rank ? '<span class="rank r' + p.rank + '">' + p.rank + '</span>' : '') + '</td><td class="l">' + badge(p.team) + ' ' + esc(p.name) + (p.hcp ? ' <span class="muted small">H' + esc(p.hcp) + '</span>' : '') + '</td>' +
        '<td>' + p.played + '</td><td><b>' + p.gross + '</b></td><td class="' + tpClass(p.toPar) + '"><b>' + G.fmtToPar(p.toPar) + '</b></td>' +
        (hasHcp ? '<td>' + p.net + ' <span class="small ' + tpClass(p.netToPar) + '">(' + G.fmtToPar(p.netToPar) + ')</span></td>' : '') + '</tr>';
    });
    html += '</tbody></table></div>';
    if (r.games.stroke.unit > 0 && all.stroke.transfers.length) {
      html += '<div class="card"><h2>스트로크 내기 <span class="hint">타당 ' + won(r.games.stroke.unit) + ' · 전원 완료 홀 기준</span></h2>' +
        all.stroke.transfers.map(function (t) { return '<div class="payline"><span>' + esc(nameOf(r, t.from)) + ' → ' + esc(nameOf(r, t.to)) + ' <span class="muted small">' + esc(t.note) + '</span></span><span class="amt">' + won(t.amount) + '</span></div>'; }).join('') + '</div>';
    } else if (!state.readOnly && !(r.games.stroke.unit > 0)) {
      // 타당 금액이 있는데 아직 주고받을 것이 없을 때(내기 시작 홀 전 · 동타)는 이 안내를 내지 않는다: 위의 규칙 줄에 금액이 이미 적혀 있다
      html += '<div class="muted small center">타당 금액을 설정하면 스트로크 내기도 정산돼요.</div>';
    }
    return html + holeScoresCard(r, res);
  }

  /**
   * 종합 탭의 홀별 스코어 표: 홀이 줄, 플레이어가 칸(라운드에 적힌 순서). 칸마다 그 홀의 타수와 파 대비 이름(버디 · 파 · 보기 · 더블 …).
   * 18홀이면 전반 · 후반 소계, 끝에 합계(타수와 ±파: 입력한 홀만 센다). 네 명까지는 카드 너비에 맞추고, 더 많으면 표만 옆으로 민다
   */
  function holeScoresCard(r, res) {
    var rows = r.players.map(function (p) { return res.rows.filter(function (x) { return x.id === p.id; })[0]; });
    var wide = rows.length > 4;
    var cell = function (strokes, toPar, label) {
      return '<td><b>' + strokes + '</b> <span class="lb ' + tpClass(toPar) + '">' + label + '</span></td>';
    };
    var sumRow = function (name, from, to) {
      return '<tr class="sum"><td>' + name + '</td>' + rows.map(function (p) {
        var g = 0, par = 0, n = 0;
        for (var h = from; h < to; h++) if (p.holes[h] !== null) { g += p.holes[h]; par += r.pars[h]; n++; }
        return n ? cell(g, g - par, G.fmtToPar(g - par)) : '<td></td>';
      }).join('') + '</tr>';
    };
    // 넓은 표(다섯 명부터)는 카드 안쪽 너비 안에서만 민다(flush): 카드 여백까지 밀리게 두면 붙어 있는 홀 칸 왼쪽으로 다른 칸이 비친다
    var html = '<div class="card"><h2>홀별 스코어<span class="hint">타수 · 파 대비</span></h2><div class="tablewrap' + (wide ? ' flush' : '') + '">' +
      '<table class="byhole' + (wide ? ' wide" style="min-width:' + (52 + 58 * rows.length) + 'px' : '') + '"><thead><tr><th>홀</th>' +
      rows.map(function (p) { return '<th>' + esc(p.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
    for (var i = 0; i < r.holes; i++) {
      html += '<tr><td><b>' + (i + 1) + '</b> <span class="lb">파' + r.pars[i] + '</span></td>' + rows.map(function (p) {
        var s = p.holes[i];
        return s === null ? '<td></td>' : cell(s, s - r.pars[i], G.toParShort(s - r.pars[i], r.pars[i]));
      }).join('') + '</tr>';
      if (i === 8 && r.holes === 18) html += sumRow('전반', 0, 9);
    }
    if (r.holes === 18) html += sumRow('후반', 9, 18);
    html += sumRow('합계', 0, r.holes);
    return html + '</tbody></table></div></div>';
  }

  function tabStableford(r, all) {
    var res = all.stableford, me = myPid();
    var html = '<div class="card"><h2>스테이블포드 <span class="hint">' + (res.net ? '네트' : '그로스') + ' · 높을수록 좋음</span></h2>' +
      ruleLine('홀마다 점수를 받아 합계가 높은 사람이 이겨요: 버디 3 · 파 2 · 보기 1 · 더블보기 이상 0 (이글 4 · 알바트로스 5).' + (res.net ? ' 핸디를 뺀 타수로 계산해요.' : '') + ' 돈은 걸지 않아요.') + '<table><thead><tr><th></th><th class="l">플레이어</th><th>점수</th></tr></thead><tbody>';
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
    var res = all.skins, team = r.games.skins.mode === 'team', f = res.fund;
    var head = '<h2>스킨스 ' + moneyChip('skins', res.enabled, !!res.error) + '</h2>';
    // 방식 설명은 제목 아래 한 줄로 (제목 줄에 넣으면 좁은 화면에서 글자가 꺾인다)
    var sub = '<div class="muted small" style="margin:-4px 0 8px">' + (team ? '팀' : '개인') + (res.net ? ' · 네트' : '') +
      (f ? ' · 공금: 각자 ' + won(f.stake) + ' · 홀당 상금 ' + won(f.prize) + (f.oecd ? ' · OECD 벌금 ' + won(f.fine) : '') : (res.unit ? ' · 스킨당 ' + won(res.unit) : '')) + '</div>';
    // OECD 가입 조건: 가입 기준이 있으면 상금(벌금을 뺀 금액)이 그 금액 이상, 없으면(예전 라운드) 공금에서 받은 돈이 낸 돈 이상
    var joinWho = f && f.join > 0 ? '상금으로 받은 돈(낸 벌금은 뺌)이 ' + won(f.join) + ' 이상인 사람' : '공금에서 받은 돈이 낸 돈 이상이 된 사람';
    // 네트 여부는 설정에서 읽는다 (팀이 없어 계산하지 못한 상태에서는 res.net이 없다)
    var skNet = !!r.games.skins.net;
    var rule = ruleLine('홀마다 ' + (skNet ? '핸디를 뺀 타수가 혼자 가장 적은 ' : '혼자 가장 적게 친 ') + (team ? '팀' : '사람') + '이 스킨을 가져가고, 동타면 다음 홀로 이월돼요.' +
      (team ? ' 팀은 그 홀에서 가장 잘 친 한 명의 ' + (skNet ? '핸디를 뺀 ' : '') + '타수로 겨뤄요.' : '') +
      (f ? ' 스킨 하나의 상금은 ' + won(f.prize) + '이에요(공금에서).' + (f.oecd ? ' ' + joinWho + '은 OECD 가입: 그다음 홀부터 OB · 벙커 · 해저드 · 3퍼트 · 트리플 이상마다 벌금 ' + won(f.fine) + '을 공금에 넣어요.' : '')
        : res.unit ? ' 스킨 하나에 ' + (team ? '진 팀 각자가 ' + won(res.unit) + '을 내요.' : '다른 사람 각각이 ' + won(res.unit) + '을 줘요.') : ''));
    if (res.error) return '<div class="card">' + head + sub + rule + '</div>' + teamHint(res.error + '. 설정에서 "방식"을 개인으로 바꾸거나 팀을 지정하세요.');
    // done: 모든 홀을 입력함. over: 라운드가 끝남(기록으로 보는 중이거나 종료됨). 덜 치고 끝낸 라운드는 over이지만 done은 아니다
    var done = holesDone(r) === r.holes, over = !!state.readOnly || r.status === 'finished';
    // 공금 방식의 표에는 받은 돈까지만 적는다. 낸 돈과 남는 돈까지 넣은 손익은 💰 정산 탭에, 끝나고 실제로 나눌 돈은 아래 공금 장부에 있다
    var html = '<div class="card">' + head + sub + rule + '<table' + (f ? ' class="fund"' : '') + '><thead><tr><th class="l">' + (team ? '팀' : '플레이어') + '</th><th>스킨</th><th>' + (f ? '받은 돈' : '금액') + '</th></tr></thead><tbody>';
    if (f) {
      res.entrants.forEach(function (e) {
        html += '<tr><td class="l"><b>' + esc(e.name) + '</b>' + (e.oecd ? '<span class="oecd">OECD</span>' : '') + '</td><td><b style="font-size:18px">' + e.skins + '</b></td>' +
          '<td>' + won(e.take) + (e.fines ? '<div class="muted small">벌금 −' + won(e.fines) + '</div>' : '') + '</td></tr>';
      });
    } else {
      var money = {};
      res.transfers.forEach(function (t) { money[t.to] = (money[t.to] || 0) + t.amount; money[t.from] = (money[t.from] || 0) - t.amount; });
      res.entrants.forEach(function (e) {
        var m = e.pids.reduce(function (a, pid) { return a + (money[pid] || 0); }, 0);
        html += '<tr><td class="l"><b>' + esc(e.name) + '</b>' + (e.pids.length > 1 ? ' <span class="muted small">' + e.pids.map(function (pid) { return esc(nameOf(r, pid)); }).join(', ') + '</span>' : '') + '</td><td><b style="font-size:18px">' + e.skins + '</b></td><td class="' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '">' + (res.enabled && res.unit ? signedWon(m) : '<span class="muted">-</span>') + '</td></tr>';
      });
    }
    html += '</tbody></table>' + (res.carry ? '<div class="notice" style="margin-top:10px">' + (done || over ? (done ? '마지막 홀까지 이월된 ' : '이월된 채 끝난 ') + res.carry + '스킨' + (f ? '의 상금은 공금에 남아요' : '은 정산에 포함되지 않습니다') : '현재 ' + res.carry + '스킨 이월 중 — 다음 홀 단독 승자가 가져갑니다') + '</div>' : '') +
      (f ? '<div class="muted small" style="margin-top:8px">받은 돈 = 시작 지급 + 상금 − 벌금.</div>' : '') + '</div>';
    if (f) html += fundCard(r, res, done, over, all.settlement.payments.some(function (p) { return !p.fixed; }));
    html += '<div class="card"><h2>홀별 결과</h2><div class="skinlist">' + res.holes.map(function (h) {
      var cls = h.winner ? 'won' : (h.played && h.tie) ? 'carry' : '';
      return '<div class="' + cls + '">' + (h.hole + 1) + '홀<b>' + (h.winner ? esc(h.winnerName) + ' ' + h.skins : h.played ? '이월' : h.skipped ? '내기 전' : '-') + '</b>' +
        // 벌금은 낸 사람 이름과 함께 (승자 이름 아래에 '벌금'만 쓰면 승자가 낸 것처럼 읽힌다)
        (h.oecd ? '<span class="pen">벌금' + h.oecd.map(function (o) { return '<br>' + esc(o.name); }).join('') + '</span>' : '') + '</div>';
    }).join('') + '</div>' + (r.games.skins.playorder ? startNote(r, '이월' + (f && f.oecd ? '과 OECD 가입' : '') + '은') : '') + '</div>';
    if (f && f.oecd) {
      // OECD 벌금 내역: 누가 어느 홀에서 무엇에 걸려 얼마를 공금에 넣었는지
      var pens = [];
      res.holes.forEach(function (h) { (h.oecd || []).forEach(function (o) { pens.push('<div class="kv"><span class="k">' + (h.hole + 1) + '번홀</span><span><b>' + esc(o.name) + '</b> ' + o.labels.join(' · ') + ' → 벌금 ' + won(o.fine) + '</span></div>'); }); });
      html += '<div class="card"><h2>OECD 벌금</h2>' +
        (pens.length ? '<div class="stack">' + pens.join('') + '</div>' : '<div class="muted">아직 벌금이 없어요.</div>') +
        '<div class="muted small" style="margin-top:8px">' + (f.join > 0
          ? '상금으로 받은 돈(낸 벌금은 뺌)이 ' + won(f.join) + ' 이상이 된 사람부터, 그다음 홀에서 OB · 벙커 · 해저드 · 3퍼트 · 트리플 이상을 하면 항목마다 ' + won(f.fine) + '을 공금에 넣어요. 벌금을 내서 다시 ' + won(f.join) + ' 아래로 내려가면, 다시 채울 때까지는 벌금이 없어요.'
          : '공금에서 받은 돈이 낸 돈(' + won(f.stake) + ') 이상이 된 사람부터, 그다음 홀에서 OB · 벙커 · 해저드 · 3퍼트 · 트리플 이상을 하면 항목마다 ' + won(f.fine) + '을 공금에 넣어요. 벌금을 내서 받은 돈이 다시 ' + won(f.stake) + ' 아래로 내려가면, 다시 채울 때까지는 벌금이 없어요.') +
        ' OB·벙커·해저드·퍼트는 📝 상세 기록에 입력한 값으로 판정합니다.</div></div>';
    }
    return html;
  }
  /** 스킨스 공금 장부: 공금이 얼마였고, 누가(플레이어·캐디) 얼마를 가져갔고, 얼마가 남거나 모자라는지 */
  function fundCard(r, res, done, over, others) {
    var f = res.fund, n = f.players;
    // 1인당 금액: 나누어떨어지지 않으면 '약'을 붙인다 (사람별 정확한 금액은 원 단위로 나눠 표와 송금 정리에 들어간다)
    function per(v) { return (f.even ? '' : '약 ') + won(Math.round(v)); }
    function line(k, v, note, cls) { return '<div class="kv ledger"><span class="k">' + k + '</span><span><b class="' + (cls || '') + '">' + v + '</b>' + (note ? ' <span class="muted small">' + note + '</span>' : '') + '</span></div>'; }
    var skinsPaid = res.entrants.reduce(function (a, e) { return a + e.skins; }, 0);
    var html = '<div class="card"><h2>공금 장부</h2><div class="stack">' +
      line('공금', won(f.total), n + '명 × ' + won(f.stake)) +
      (f.startOut ? line('시작 지급', '−' + won(f.startOut), (f.start ? '플레이어 ' + n + '명 × ' + won(f.start) : '') + (f.start && f.tip ? ' + ' : '') + (f.tip ? '캐디 ' + won(f.tip) : '')) : '') +
      line('홀 상금', '−' + won(f.paid), skinsPaid + '스킨 × ' + won(f.prize)) +
      (f.oecd || f.fines ? line('OECD 벌금', '+' + won(f.fines)) : '') +
      // '공금 잔액'은 캐디피를 내기 전, '남는 돈'·'모자란 돈'은 캐디피를 낸 뒤의 금액이다 (이름이 비슷하면 표 아래 계산식과 헷갈린다)
      line('공금 잔액', won(f.left), f.left < 0 ? '공금보다 많이 나갔어요' : (f.caddie ? '캐디피 내기 전' : '')) +
      (f.caddie ? line('캐디피', '−' + won(f.caddie)) : '') +
      (f.rest >= 0 ? line('남는 돈', won(f.rest), f.rest ? '1인당 ' + per(f.share) + '씩 돌려받아요' : '', 'pos')
        : line('모자란 돈', won(-f.rest), '1인당 ' + per(-f.share) + '씩 더 내요', 'neg')) +
      '</div><h2 style="margin-top:14px">누가 얼마나 가져갔나</h2><div class="stack">' +
      res.entrants.map(function (e) {
        var bits = [];
        if (e.start) bits.push('시작 ' + won(e.start));
        bits.push('상금 ' + won(e.prize));
        if (e.fines) bits.push('벌금 −' + won(e.fines));
        return line(esc(e.name), won(e.take), bits.join(' · '));
      }).join('') +
      (f.caddieTotal ? line('캐디', won(f.caddieTotal), (f.tip ? '시작 ' + won(f.tip) : '') + (f.tip && f.caddie ? ' · ' : '') + (f.caddie ? '캐디피 ' + won(f.caddie) : '')) : '') +
      '</div>';
    // 끝나고 실제로 오갈 돈. 공금을 미리 걷었으면 걷어 둔 돈에서 나눠 주는 금액, 안 걷었으면 정산 탭의 송금 정리를 쓴다
    if (!res.enabled) {
      // 스킨스를 정산에 넣지 않은 라운드: 장부는 참고용이고 정산 탭과 결과 복사 글에는 들어가지 않는다
      html += '<div class="notice" style="margin-top:12px">' + (state.readOnly ? '이 라운드는 스킨스를 정산에 넣지 않았어요. 위 금액은 참고용입니다.'
        : '지금은 스킨스가 <b>정산 제외</b>라 💰 정산 탭과 결과 복사 글에 공금이 들어가지 않아요. 맨 위 제목 옆의 "정산 제외"를 누르면 "정산 포함"으로 바뀝니다.') + '</div>';
    } else {
      var caddieNote = f.caddieDue ? ' 캐디에게 줄 돈 ' + won(f.caddieDue) + '(' + (f.tip && f.caddie ? '시작 지급 + 캐디피' : f.tip ? '시작 지급' : '캐디피') + ')도 거기에 "→ 캐디"로 들어 있어요.' : '';
      html += '<h2 style="margin-top:14px">' + (done || over ? '끝나고 나눌 돈' : '지금 끝내면 나눌 돈') + '</h2>';
      if (!(f.total > f.startOut)) {
        // 걷을 돈이 시작 지급보다 많지 않으면 미리 걷어 둘 돈이 없다: 고르는 단추 없이 정산 탭으로 안내한다
        html += '<div class="muted small">걷을 돈 ' + won(f.total) + '(' + n + '명 × ' + won(f.stake) + ')이 시작 지급 ' + won(f.startOut) + '보다 많지 않아 미리 걷어 둘 돈이 없어요. 💰 정산 탭의 송금 정리대로 주고받으면 됩니다.' + caddieNote + '</div>';
      } else {
        html += '<div class="seg" style="margin-bottom:8px"><button type="button" data-action="fund-collect" data-v="1" class="' + (f.collect ? 'active' : '') + '">공금을 걷었어요</button>' +
          '<button type="button" data-action="fund-collect" data-v="0" class="' + (f.collect ? '' : 'active') + '">안 걷었어요</button></div>';
        if (f.collect) {
          html += '<div class="stack">' + line('걷어 둔 돈', won(f.cash), '공금 ' + won(f.total) + (f.startOut ? ' − 시작 지급 ' + won(f.startOut) : '')) +
            res.entrants.map(function (e) {
              var d = Math.round(e.due), note = '상금 ' + won(e.prize) + (e.fines ? ' − 벌금 ' + won(e.fines) : '') + (e.share > 0 ? ' + 남는 돈 ' + won(e.share) : e.share < 0 ? ' − 모자란 돈 ' + won(-e.share) : '');
              return d >= 0 ? line('→ ' + esc(e.name), won(d), note) : line(esc(e.name), won(-d) + ' 더 내요', note, 'neg');
            }).join('') +
            (f.caddieDue ? line('→ 캐디', won(f.caddieDue), '캐디피') : '') + '</div>' +
            // 정산 탭의 "스킨스 공금" 줄은 이 목록과 언제나 같다 (games.js의 payout). 다른 게임의 돈은 공금과 섞지 않고 따로 정리된다
            '<div class="muted small" style="margin-top:8px">각자 ' + won(f.stake) + '을 걷고 시작 지급도 이미 준 것으로 보고, 걷어 둔 돈으로 할 일이에요. 💰 정산 탭의 "스킨스 공금" 줄과 같아요.' +
            (others ? ' 다른 게임의 돈은 정산 탭에 플레이어끼리 주고받는 줄로 따로 나와요.' : '') + '</div>';
        } else {
          html += '<div class="muted small">돈을 걷지 않았으면 💰 정산 탭의 송금 정리대로 주고받으면 됩니다.' + caddieNote + '</div>';
        }
      }
    }
    html += '<div class="muted small" style="margin-top:8px">' +
      (done ? '' : over ? '친 홀까지만 계산했어요. 치지 않은 홀의 상금은 공금에 남은 것으로 정리했습니다. ' : '라운드 중이라 지금까지 친 홀 기준이에요. 남은 홀의 상금은 아직 공금에 있는 것으로 계산합니다. ') +
      '이 장부는 라운드 기록에 함께 남아요.</div></div>';
    return html;
  }

  /**
   * 18홀 라운드의 출발 홀 안내. 스킨스의 이월·OECD 가입과 오장의 '앞 홀'은 홀을 친 순서를 따르므로, 어느 홀에서 출발한 것으로 계산했는지 돈 화면에 적는다.
   * what: 이 순서를 따르는 것(예: '이월은'). 9홀 라운드는 빈 문자열
   */
  function startNote(r, what) {
    if (r.holes !== 18) return '';
    var back = A.playOrder(r).startBack;
    // 안내는 고른 값이 실제로 전해지는지에 맞춘다:
    //  진행 중이고 공유 중인 라운드 → 함께 보는 기기에 전해진다
    //  진행 중이지만 공유하지 않는 라운드(혼자 쓰거나 공유에서 나간 기기) → 다른 기기 이야기를 하지 않는다
    //  호스트가 끝냈지만 내가 아직 열어 둔 공유 라운드 → 여전히 전송된다(아직 열어 둔 기기와, 종료 직후 잠시 연결을 유지하는 호스트의 기록에 닿는다)
    //  기록으로 저장된 라운드 → 이 기기에서만 바뀐다
    var mine = r === state.round && !state.readOnly, live = mine && r.status !== 'finished', shared = mine && sharingActive();
    return '<div class="muted small" data-region="startnote" style="margin-top:8px">' + what + ' <b>' + (back ? '10번홀' : '1번홀') + ' 출발</b> 순서로 계산했어요' + (back ? '(18번홀 다음이 1번홀)' : '') +
      '. 출발 홀이 다르면 📊 분석 화면의 "출발 홀"에서 고치세요.' + (live ? (shared ? ' 함께 보는 기기에도 똑같이 적용돼요.' : '')
        : shared ? ' 이 라운드를 아직 열어 둔 기기에는 똑같이 적용돼요. 이미 기록으로 저장한 기기는 각자 고쳐 주세요.'
          : ' 끝난 라운드에서 고치면 이 기기의 기록만 바뀌어요. 함께 본 기기는 각자 고쳐 주세요.') + '</div>';
  }
  /** 오장: 사람별 금액, 홀별 민판·배판, 배판 사유와 니어·버디 내역 */
  function tabOjang(r, all) {
    var res = all.ojang;
    var head = '<h2>오장 ' + moneyChip('ojang', res.enabled, !!res.error) + '<span class="hint">타당 ' + won(res.unit) + (res.net ? ' · 네트' : '') + '</span></h2>';
    var og = r.games.ojang || {}, ojCarry = og.carry !== false, ojNear = og.near !== false, ojBirdie = og.birdie !== false;
    var rule = ruleLine('홀마다 ' + (res.net ? '핸디를 뺀 ' : '') + '타수 차 × 타당 ' + won(res.unit) + '을 둘씩 주고받아요. 배판인 홀은 2배예요: 버디 이하 · 트리플 이상 · 파3 더블 이상 · 3명 이상 동타' + (ojCarry ? ' · 앞 홀 전원 동타' : '') + '.' +
      (ojNear && ojBirdie ? ' 파3 니어(파 이하로 마쳤을 때)와 버디 이하는 다른 사람 각각에게서 1타 금액을 더 받아요'
        : ojNear ? ' 파3 니어는 파 이하로 마치면 다른 사람 각각에게서 1타 금액을 더 받아요'
          : ojBirdie ? ' 버디 이하는 다른 사람 각각에게서 1타 금액을 더 받아요' : '') +
      (ojNear || ojBirdie ? '(배판인 홀에서는 이것도 2배).' : ''));
    if (res.error) return '<div class="card">' + head + rule + '<div class="muted">' + esc(res.error) + '</div></div>';
    var html = '<div class="card">' + head + rule + '<table><thead><tr><th class="l">플레이어</th><th>금액</th></tr></thead><tbody>' +
      res.rows.map(function (x) {
        return '<tr><td class="l"><b>' + esc(x.name) + '</b></td><td class="' + (x.amount > 0 ? 'pos' : x.amount < 0 ? 'neg' : '') + '">' + (res.unit ? signedWon(x.amount) : '<span class="muted">-</span>') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (function () {
        var pend = res.holes.filter(function (h) { return h.pendingDouble; }).map(function (h) { return (h.hole + 1) + '번홀'; });
        return pend.length ? '<div class="notice" style="margin-top:10px">앞 홀이 전원 동타라 ' + pend.join(', ') + '은 배판이에요</div>' : '';
      })() +
      '<div class="muted small" style="margin-top:8px">전원이 타수를 넣은 홀만 계산합니다.</div></div>';
    html += '<div class="card"><h2>홀별 판 <span class="hint">배판 ' + res.doubles + '홀</span></h2><div class="skinlist">' + res.holes.map(function (h) {
      return '<div class="' + (h.played ? (h.mult === 2 ? 'carry' : 'won') : '') + '">' + (h.hole + 1) + '홀<b>' + (h.played ? (h.mult === 2 ? '배판' : '민판') : h.skipped ? '내기 전' : '-') + '</b></div>';
    }).join('') + '</div>' + (r.games.ojang && r.games.ojang.carry === false ? '' : startNote(r, '"앞 홀 전원 동타" 배판은')) + '</div>';
    var notes = [];
    res.holes.forEach(function (h) {
      if (!h.played) return;
      var bits = [];
      if (h.mult === 2) bits.push('<b>배판</b> ' + h.reasons.join(' · '));
      if (h.near) bits.push('니어 ' + esc(nameOf(r, h.near.pid)) + (h.near.ok ? ' +1타' : h.near.erasedBy ? ' (' + esc(nameOf(r, h.near.erasedBy)) + '의 지우개로 없던 것으로)' : ' (파를 못 해 없던 것으로)'));
      if (h.birdies) bits.push('버디값 ' + h.birdies.map(function (pid) { return esc(nameOf(r, pid)); }).join(', '));
      if (bits.length) notes.push('<div class="kv"><span class="k">' + (h.hole + 1) + '번홀</span><span>' + bits.join(' / ') + '</span></div>');
    });
    html += '<div class="card"><h2>배판 · 니어 · 버디</h2>' + (notes.length ? '<div class="stack">' + notes.join('') + '</div>' : '<div class="muted">아직 없어요.</div>') +
      '<div class="muted small" style="margin-top:8px">배판: 버디 이하 · 트리플 이상 · 파3 더블 이상 · 3명 이상 동타' + (r.games.ojang && r.games.ojang.carry === false ? '' : ' · 앞 홀 전원 동타') + '. 니어는 스코어 입력 화면의 니어리스트에서 고릅니다.</div></div>';
    return html;
  }

  /** now: 진행 중인 매치의 지금까지 금액 (매치 탭에서만 넣는다) */
  function matchBox(m, st, extra, now) {
    var a = st.leader === 'A', b = st.leader === 'B';
    return '<div class="matchbox"><div class="side ' + (a ? 'lead' : '') + '">' + esc(m.a.name) + (a ? ' ▲' : '') + '</div>' +
      '<div class="st">' + esc(st.text) + '<small>' + (extra || (st.finished ? '종료' : '진행 중')) + '</small>' + (now ? '<small class="now">' + now + '</small>' : '') + '</div>' +
      '<div class="side r ' + (b ? 'lead' : '') + '">' + (b ? '▲ ' : '') + esc(m.b.name) + '</div>' +
      '<div class="holedots">' + st.holes.map(function (v) { return '<span class="' + (v === 1 ? 'a' : v === -1 ? 'b' : v === 0 ? 't' : '') + '">·</span>'; }).join('') + '</div></div>';
  }

  function tabMatch(r, all) {
    var res = all.match;
    var head = '<h2>매치 플레이 ' + moneyChip('match', res.enabled, !!res.error) + '<span class="hint">' + (r.games.match.mode === 'team' ? '팀' : '개인 리그') + (res.unit ? ' · 홀당 ' + won(res.unit) : '') + (res.net ? ' · 네트' : '') + '</span></h2>';
    var mteam = r.games.match.mode === 'team';
    var rule = ruleLine('홀마다 ' + (res.net ? '핸디를 뺀 ' : '') + '타수가 적은 쪽이 그 홀을 이기고, 이긴 홀이 많은 쪽이 매치를 이겨요.' +
      (mteam ? ' 팀은 그 홀에서 가장 잘 친 한 명의 타수로 겨뤄요.' : ' 개인 리그: 모든 사람이 서로 한 번씩 겨뤄요.') +
      (res.unit ? ' 진 ' + (mteam ? '팀 각자가 홀 차 × ' + won(res.unit) + '을 내요.' : '사람이 홀 차 × ' + won(res.unit) + '을 줘요.') + ' 매치가 끝나기 전에는 지금까지의 홀 차로 계산해요.' : ''));
    if (res.error) return '<div class="card">' + head + rule + '</div>' + teamHint(res.error + '. 설정에서 "방식"을 개인으로 바꾸거나 2팀을 지정하세요.');
    return '<div class="card">' + head + rule + '<div class="stack">' +
      res.matches.map(function (m) {
        // 진행 중인 매치는 '지금 …원'으로 적는다 (정산에도 그 금액이 들어간다). 끝난 매치와 지난 라운드의 기록은 금액만 적는다
        var fin = m.status.finished || state.readOnly;
        // 금액 줄의 자리는 동률일 때도 비워 둔다: 동률과 리드가 오갈 때마다 아래 표가 한 줄씩 밀리지 않게
        var now = fin || !res.enabled || !(res.unit > 0) ? null : m.running ? '지금 ' + (mteam ? '각자 ' : '') + won(m.running) : '&nbsp;';
        return matchBox(m, m.status, fin && m.money && res.enabled ? won(m.money) : null, now);
      }).join('') +
      '</div><div class="muted small" style="margin-top:8px"><span style="color:var(--team-A)">■</span> 왼쪽 승 &nbsp;<span style="color:var(--team-B)">■</span> 오른쪽 승 &nbsp;<span style="color:#cbd5d0">■</span> 무승부. ' +
      '금액은 지금까지의 홀 차 × 단가예요.' + (res.unit && res.enabled ? ' 매치가 진행 중이어도 정산에 들어가고, 끝나면 확정돼요.' : '') + '</div></div>' +
      (mteam ? res.matches.map(function (m) { return matchBestCard(r, m, res.net); }).join('') : '');
  }

  /** 팀 매치 · 팀 나소: 홀마다 두 팀에 적용된 타수(팀에서 가장 잘 친 타수)와 그 타수를 친 사람. 이긴 팀의 칸은 위 점 표시와 같은 색의 굵은 글씨 */
  function matchBestCard(r, m, net) {
    var rows = '';
    (m.best || []).forEach(function (b, h) {
      if (!b || !b.a || !b.b) return;
      var v = b.a.score < b.b.score ? 1 : b.a.score > b.b.score ? -1 : 0; // 타수가 적은 쪽이 그 홀을 이긴다 (매치 · 나소의 홀 승패와 같다)
      var cell = function (x, cls) {
        return '<td class="l' + cls + '">' + x.pids.map(function (pid) { return esc(nameOf(r, pid)); }).join(' · ') + ' <b>' + x.score + '</b></td>';
      };
      rows += '<tr><td>' + (h + 1) + '</td>' + cell(b.a, v === 1 ? ' win a' : '') + cell(b.b, v === -1 ? ' win b' : '') + '</tr>';
    });
    return '<div class="card"><h2>홀별 베스트<span class="hint">팀에 적용된 ' + (net ? '네트 ' : '') + '타수</span></h2>' +
      (rows ? '<table class="best"><thead><tr><th>홀</th><th class="l">' + esc(m.a.name) + '</th><th class="l">' + esc(m.b.name) + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="muted small" style="margin-top:8px">홀마다 팀에서 가장 잘 친 사람과 그 ' + (net ? '타수(핸디를 뺀 값)' : '타수') + '예요. 같은 타수면 함께 적어요. 굵은 색 글씨가 그 홀을 이긴 팀이에요.</div>'
        : '<div class="muted">두 팀 모두 점수를 넣은 홀부터 나와요.</div>') + '</div>';
  }

  function tabNassau(r, all) {
    var res = all.nassau;
    var head = '<h2>나소 ' + moneyChip('nassau', res.enabled, !!res.error) + '<span class="hint">' + (r.games.nassau.mode === 'team' ? '팀' : '개인') + (res.unit ? ' · 판당 ' + won(res.unit) : '') + '</span></h2>';
    var nteam = r.games.nassau.mode === 'team';
    var rule = ruleLine('18홀을 전반 9홀 · 후반 9홀 · 전체 18홀의 세 판으로 나눠, 판마다 매치 플레이(홀마다 ' + (res.net ? '핸디를 뺀 ' : '') + '타수가 적은 쪽이 승)로 겨뤄요.' +
      (nteam ? ' 팀은 그 홀에서 가장 잘 친 한 명의 타수로 겨뤄요.' : '') +
      (res.unit ? ' 판을 이기면 진 ' + (nteam ? '팀 각자에게서' : '사람에게서') + ' 판당 ' + won(res.unit) + '을 받아요. 비긴 판은 주고받지 않아요.' : ''));
    if (res.error) return '<div class="card">' + head + rule + '</div>' + teamHint(res.error + '.');
    return '<div class="card">' + head + rule + '</div>' + res.matches.map(function (m) {
      return '<div class="card"><h2>' + esc(m.a.name) + ' vs ' + esc(m.b.name) + '</h2><div class="stack">' +
        m.segments.map(function (s) {
          // 내기 시작 홀 때문에 한 홀도 남지 않은 판은 겨루지 않는다
          if (s.empty) return '<div class="small muted" style="margin-bottom:-4px">' + esc(s.name) + '</div><div class="matchbox none"><div class="st"><small>내기 시작 전이라 이 판은 겨루지 않아요</small></div></div>';
          return '<div class="small muted" style="margin-bottom:-4px">' + esc(s.name) + '</div>' + matchBox(m, s.status, s.money && res.enabled ? won(s.money) : null);
        }).join('') + '</div></div>' +
        (nteam ? matchBestCard(r, m, res.net) : '');
    }).join('');
  }

  function tabBestball(r, all) {
    var res = all.bestball;
    var head = '<h2>베스트볼 ' + moneyChip('bestball', res.enabled, !!res.error) + '<span class="hint">베스트 ' + res.count + (res.net ? ' · 네트' : '') + (res.unit ? ' · 홀당 ' + won(res.unit) : '') + '</span></h2>';
    var rule = ruleLine('팀에서 그 홀을 가장 잘 친 ' + (res.count > 1 ? res.count + '명의 ' + (res.net ? '핸디를 뺀 ' : '') + '타수 합이' : '한 명의 ' + (res.net ? '핸디를 뺀 ' : '') + '타수가') + ' 팀 점수예요. 팀 점수가 혼자 가장 낮은 팀이 그 홀을 이겨요.' +
      (res.unit ? ' 홀마다 진 팀 각자가 ' + won(res.unit) + '을 내고 이긴 팀이 나눠 가져요.' : ''));
    if (res.error) return '<div class="card">' + head + rule + '</div>' + teamHint(res.error + '.');
    var html = '<div class="card">' + head + rule + '<table class="teams"><thead><tr><th class="l">팀</th><th>팀 타수</th><th>±파</th><th>홀 승</th></tr></thead><tbody>';
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
    var rule = ruleLine('2명씩 두 팀이 겨뤄요. 홀마다 팀 두 사람의 ' + (r.games.vegas.net ? '핸디를 뺀 ' : '') + '타수를 작은 수부터 붙여 두 자리 수를 만들고(4타와 5타면 45), 숫자가 작은 팀이 그 차이만큼 점수를 얻어요. 상대 팀만 버디 이하를 하면 우리 숫자가 뒤집혀요(45가 54로).' +
      (res.unit ? ' 1점에 진 팀 각자가 ' + won(res.unit) + '을 내고 이긴 팀이 나눠 가져요.' : ''));
    if (res.error) return '<div class="card">' + head + rule + '</div>' + teamHint(res.error + '.');
    var html = '<div class="card">' + head + rule + '<div class="row" style="justify-content:space-around;text-align:center">' +
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

  /**
   * 스코어 입력 화면의 니어 / 롱기 카드. 보너스 설정에 따라 니어는 파3 홀, 롱기는 파5 홀에서만 나온다(둘 다 해당 없으면 카드가 없다).
   * 지우개 룰이 켜져 있으면 파3에서 니어를 고른 뒤 그 아래에 지운 사람을 고르는 줄이 나온다
   */
  function extrasCard(r, h, par) {
    var ex = (r.extras && r.extras[h]) || {}, bn = r.games.bonus;
    var showNear = !bn.parthree || par === 3, showLong = !bn.parfive || par === 5;
    if (!showNear && !showLong) return '';
    var ni = G.nearInfo(r, h, bn);
    var chips = function (type, list, cur) {
      return list.map(function (p) {
        return '<button class="chip accent ' + (cur === p.id ? 'active' : '') + (type === 'nearest' && ni.erased && cur === p.id ? ' erased' : '') + '" data-action="extra" data-type="' + type + '" data-pid="' + esc(p.id) + '">' + esc(p.name) + '</button>';
      }).join('');
    };
    var html = '<div class="card"><h2>' + (showNear && showLong ? '니어 / 롱기' : showNear ? '니어리스트' : '롱기스트') + ' <span class="hint">받는 사람 선택 (선택)</span></h2><div class="stack">';
    if (showNear) html += '<div class="chips"><span class="small muted blab">니어리스트</span>' + chips('nearest', r.players, ex.nearest) + '</div>';
    if (showNear && bn.eraser && par === 3 && ex.nearest && G.playerById(r, ex.nearest)) {
      var others = r.players.filter(function (p) { return p.id !== ex.nearest; });
      var who = ni.eraser ? esc(nameOf(r, ni.eraser)) : '', near = esc(nameOf(r, ex.nearest));
      html += '<div class="chips"><span class="small muted blab">지우개</span>' + chips('eraser', others, ex.eraser) + '</div>' +
        '<div class="muted small" data-eraser="' + (ni.erased ? 'on' : ni.eraser ? 'pending' : 'none') + '">' +
        (ni.erased ? '<b>' + who + '</b>의 지우개로 이 홀의 니어(' + near + ')는 없어요.'
          : ni.why === 'noscore' ? who + '의 타수를 입력하면 지우개가 정해져요 (파 이하일 때 인정).'
            : ni.why === 'over' ? '<b>' + who + '</b>: 파를 못 해서 지우개가 인정되지 않아요. 니어는 ' + near + ' 그대로예요.'
              : '지우개: 그린에 올리지 못한 사람이 파 이하로 마쳤으면 그 사람을 고르세요. 이 홀의 니어가 지워져요.') + '</div>';
    }
    if (showLong) html += '<div class="chips"><span class="small muted blab">롱기스트</span>' + chips('longest', r.players, ex.longest) + '</div>';
    return html + '</div></div>';
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
    // 돈은 정산에 넣은 보너스(칩)만 오간다: 룰 문장도 넣은 것만 적는다
    var paid = [];
    if (en.nearest) paid.push('니어리스트');
    if (en.longest) paid.push('롱기스트');
    if (en.birdie) paid.push('버디');
    var html = '<div class="card"><h2>보너스 <span class="hint">1회당 ' + won(g.unit) + '</span></h2>' +
      ruleLine((paid.length ? paid.join(' · ') + '를 한 사람이 다른 사람 각각에게서 1회당 ' + won(g.unit) + '을 받아요.' + (en.birdie ? ' 이글 이상은 2배예요.' : '')
        : '니어리스트 · 롱기스트 · 버디 횟수만 세고, 정산에 넣은 보너스는 없어요.' +
          (state.readOnly ? '' : ' 아래 칩을 눌러 넣으면 그 보너스를 한 사람이 다른 사람 각각에게서 1회당 ' + won(g.unit) + '을 받아요(이글 이상은 2배).')) +
        (res.rules.eraser ? ' 지우개: 파3에서 그린에 못 올린 사람이 파 이하로 마치면 그 홀의 니어를 지워요.' : '')) +
      '<div class="chips" style="margin-bottom:10px">' + chip('nearest', '니어리스트') + chip('longest', '롱기스트') + chip('birdie', '버디/이글') + '</div>' +
      '<table class="bonus"><thead><tr><th class="l">플레이어</th><th>니어</th><th>롱기</th><th>버디</th><th>이글+</th>' + (anyMoney ? '<th>금액</th>' : '') + '</tr></thead><tbody>';
    r.players.forEach(function (p) {
      var c = res.counts[p.id], m = money[p.id] || 0;
      html += '<tr class="' + (me === p.id ? 'me' : '') + '"><td class="l">' + badge(p.team) + ' ' + esc(p.name) + '</td><td>' + c.nearest + '</td><td>' + c.longest + '</td><td>' + c.birdie + '</td><td>' + c.eagle + '</td>' +
        (anyMoney ? '<td class="' + (m > 0 ? 'pos' : m < 0 ? 'neg' : '') + '">' + signedWon(m) + '</td>' : '') + '</tr>';
    });
    // 지우개로 지워진 니어: 누가 누구의 니어를 지웠는지 (횟수와 돈에는 들어가지 않는다)
    var erased = res.events.filter(function (e) { return e.type === 'erased'; });
    var limits = [];
    if (res.rules.parthree) limits.push('니어는 파3 홀');
    if (res.rules.parfive) limits.push('롱기는 파5 홀');
    html += '</tbody></table>' +
      (erased.length ? '<div class="stack" style="margin-top:10px">' + erased.map(function (e) {
        return '<div class="kv"><span class="k">' + (e.hole + 1) + '번홀 지우개</span><span><b>' + esc(nameOf(r, e.by)) + '</b> <span class="muted small">' + esc(nameOf(r, e.pid)) + '의 니어를 지움</span></span></div>';
      }).join('') + '</div>' : '') +
      '<div class="muted small" style="margin-top:6px">' + (state.readOnly ? '' : '칩을 눌러 정산에 포함할 보너스를 고르세요. ') + '니어/롱기 받는 사람은 스코어 입력 화면에서 홀마다 선택해요.' +
      (limits.length ? ' ' + limits.join(', ') + '에서만 세요.' : '') + (res.rules.eraser ? ' 지우개로 지워진 니어는 세지 않아요.' : '') + '</div></div>';
    return html;
  }

  function tabSettle(r, all) {
    var s = all.settlement, me = myPid();
    var included = ['skins', 'ojang', 'match', 'nassau', 'bestball', 'vegas'].filter(function (k) { return all[k] && all[k].enabled && !all[k].error; }).map(function (k) { return GAME_NAMES[k]; });
    if (r.games.stroke.unit > 0) included.unshift('스트로크');
    var b = r.games.bonus; if (b.nearest || b.longest || b.birdie) included.push('보너스');
    var html = '<div class="card"><h2>개인별 손익 <span class="hint">' + (included.length ? '포함: ' + esc(included.join(', ')) : '정산에 포함된 게임 없음') + '</span></h2><table class="settle"><thead><tr><th class="l">플레이어</th><th>손익</th></tr></thead><tbody>';
    s.rows.forEach(function (p) {
      var parts = Object.keys(p.byGame).filter(function (k) { return Math.round(p.byGame[k]) !== 0; }).map(function (k) { return GAME_NAMES[k] + ' ' + signedWon(p.byGame[k]); });
      var mine = me === p.id ? ' me' : '';
      // 게임별 내역은 이름·손익 줄 아래에 한 줄로 둔다 (옆 칸에 두면 좁은 화면에서 금액이 글자 중간에서 꺾인다)
      html += '<tr class="' + (parts.length ? 'hassub' : '') + mine + '"><td class="l">' + badge((G.playerById(r, p.id) || {}).team) + ' ' + esc(p.name) + '</td><td class="' + (p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : '') + '" style="font-size:16px">' + signedWon(p.net) + '</td></tr>' +
        (parts.length ? '<tr class="sub' + mine + '"><td class="l small muted brk" colspan="2">' + parts.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join(', ') + '</td></tr>' : '');
    });
    html += '</tbody></table></div>';
    // 송금 정리. 스킨스 공금을 미리 걷은 라운드는 걷어 둔 돈으로 할 일(장부의 "끝나고 나눌 돈"과 같은 줄)을 먼저 적고, 다른 게임은 플레이어끼리 따로 정리한다
    var fd = all.skins && all.skins.enabled && all.skins.fund ? all.skins.fund : null;
    var fundPays = s.payments.filter(function (p) { return p.fixed; }), otherPays = s.payments.filter(function (p) { return !p.fixed; });
    var payLine = function (p) { return '<div class="payline"><span><b>' + esc(payName(r, p.from)) + '</b> → <b>' + esc(payName(r, p.to)) + '</b></span><span class="amt">' + won(p.amount) + '</span></div>'; };
    html += '<div class="card"><h2>송금 정리' + (fundPays.length ? '' : ' <span class="hint">최소 횟수로 정산</span>') + '</h2>' +
      (s.payments.length
        ? (fundPays.length ? '<div class="paygroup">스킨스 공금 <span class="muted small">걷어 둔 돈 ' + won(fd.cash) + '</span></div>' + fundPays.map(payLine).join('') : '') +
          (fundPays.length && otherPays.length ? '<div class="paygroup">다른 게임 <span class="muted small">플레이어끼리 · 최소 횟수</span></div>' : '') + otherPays.map(payLine).join('')
        : '<div class="muted">정산할 금액이 없습니다.' + (included.length ? '' : ' 각 게임 탭의 "정산 포함"을 켜거나 설정에서 금액을 정하세요.') + '</div>') +
      '</div>';
    if (fd) {
      html += '<div class="notice">' + (fd.collect
        ? '스킨스 공금은 <b>미리 걷은 것</b>으로 정리했어요. 각자 ' + won(fd.stake) + '을 냈고 시작 지급도 이미 준 것으로 보고, "스킨스 공금" 줄은 걷어 둔 ' + won(fd.cash) + '으로 할 일입니다. 스킨스 탭 공금 장부의 "끝나고 나눌 돈"과 같아요.' +
          (otherPays.length ? ' 다른 게임의 돈은 공금과 섞지 않고 플레이어끼리 주고받는 줄로 따로 정리했어요.' : '') + ' 걷지 않았다면 스킨스 탭 공금 장부에서 "안 걷었어요"를 고르세요.'
        : '스킨스 공금은 <b>걷지 않은 것</b>으로 정리했어요. 위 송금대로만 주고받으면 ' + (fd.caddieDue ? '되고, 캐디에게 줄 돈 ' + won(fd.caddieDue) + '(' + (fd.tip && fd.caddie ? '시작 지급 + 캐디피' : fd.tip ? '시작 지급' : '캐디피') + ')은 "→ 캐디" 줄에 모입니다.' : '됩니다.') +
          (fd.total > fd.startOut ? ' 미리 걷었다면 스킨스 탭 공금 장부에서 "공금을 걷었어요"를 고르세요.' : '')) +
        ' 손익은 낸 돈' + (fd.caddieTotal ? '과 캐디 몫' : '') + '까지 넣은 금액이에요.</div>';
    }
    if (!state.readOnly && holesDone(r) < r.holes) {
      // 매치 · 나소 이야기는 그 게임의 돈이 실제로 정산에 걸려 있을 때만 한다 (꺼 둔 게임이나 금액 0이면 넣은 것이 없다)
      var mOn = all.match && all.match.enabled && !all.match.error && all.match.unit > 0;
      var nOn = all.nassau && all.nassau.enabled && !all.nassau.error && all.nassau.unit > 0;
      html += '<div class="notice">아직 ' + (r.holes - holesDone(r)) + '홀이 남았어요.' + (mOn ? ' 매치 금액은 지금까지의 홀 차로 넣었어요.' : '') + (nOn ? ' 나소는 판이 끝나야 들어가요.' : '') + '</div>';
    }
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
  /** 18홀 출발 홀: 기본은 입력 순서로 추정(자동). 지난 홀을 나중에 몰아서 입력해 순서가 틀리게 잡히면 직접 고를 수 있다 (진행 중인 라운드에서는 함께 보는 기기에도 전해진다) */
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
      '<div class="small muted" style="margin-top:10px">가장 좋았던 홀: <b>' + (st.best.h + 1) + '번홀 ' + G.toParLabel(st.best.diff) + '</b> · 가장 아쉬운 홀: <b>' + (st.worst.h + 1) + '번홀 ' + G.toParLabel(st.worst.diff, r.pars[st.worst.h]) + '</b></div></div>';
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
    var all = computeAll(r);
    var lines = ['⛳ ' + r.name + ' (' + r.date + ')', ''];
    all.stroke.rows.forEach(function (p) { if (p.played) lines.push((p.rank || '-') + '위 ' + p.name + ': ' + p.gross + '타 (' + G.fmtToPar(p.toPar) + ')' + (p.hcp ? ' / 네트 ' + p.net : '')); });
    // 내기 시작 홀을 정한 라운드: 아래 게임과 정산이 어느 홀부터 센 것인지 적는다
    if (all.betFrom > 1) lines.push('', '※ 내기는 ' + all.betFrom + '번째 홀(' + (A.playOrder(r).order[all.betFrom - 1] + 1) + '번홀)부터: 그 앞의 ' + holeRanges(betBefore(all, r)) + '은 순위에만 들어가요');
    if (all.skins && !all.skins.error) lines.push('', '🎯 스킨스: ' + all.skins.entrants.map(function (e) { return e.name + ' ' + e.skins + (e.oecd && all.skins.enabled ? '(OECD)' : ''); }).join(', ') +
      (r.holes === 18 && r.games.skins.playorder && A.playOrder(r).startBack ? ' (10번홀 출발 순서)' : ''));
    if (all.skins && all.skins.enabled && all.skins.fund) {
      var fd = all.skins.fund;
      lines.push('  공금 ' + won(fd.total) + ' (각자 ' + won(fd.stake) + ')' + (fd.startOut ? ' · 시작 지급 ' + won(fd.startOut) : '') + ' · 홀 상금 ' + won(fd.paid) + (fd.fines ? ' · OECD 벌금 +' + won(fd.fines) : '') +
        (fd.caddie ? ' · 캐디피 ' + won(fd.caddie) : '') + (fd.rest >= 0 ? ' · 남는 돈 ' + won(fd.rest) : ' · 모자란 돈 ' + won(-fd.rest) + ' (1인당 ' + (fd.even ? '' : '약 ') + won(Math.round(-fd.share)) + ')'));
      lines.push('  가져간 돈: ' + all.skins.entrants.map(function (e) { return e.name + ' ' + won(e.take); }).join(', ') + (fd.caddieTotal ? ', 캐디 ' + won(fd.caddieTotal) : ''));
    }
    if (all.ojang && all.ojang.enabled && !all.ojang.error) lines.push('', '🧾 오장(타당 ' + won(all.ojang.unit) + '): ' + all.ojang.rows.map(function (x) { return x.name + ' ' + signedWon(x.amount); }).join(', '));
    if (all.match && !all.match.error) { lines.push('', '⚔️ 매치:'); all.match.matches.forEach(function (m) { lines.push('  ' + m.a.name + ' vs ' + m.b.name + ' — ' + m.status.text + (m.status.leader ? ' (' + (m.status.leader === 'A' ? m.a.name : m.b.name) + ')' : '')); }); }
    if (all.vegas && !all.vegas.error) lines.push('', '🎰 라스베가스: ' + all.vegas.teams.map(function (t) { return t.name + ' ' + t.points + '점'; }).join(' vs '));
    if (all.bestball && !all.bestball.error) lines.push('', '👥 베스트볼: ' + all.bestball.teams.map(function (t) { return t.name + ' ' + t.total + '(' + G.fmtToPar(t.toPar) + ')'; }).join(' vs '));
    if (all.settlement.payments.length) {
      lines.push('', '💰 정산:');
      all.settlement.rows.forEach(function (p) { lines.push('  ' + p.name + ' ' + signedWon(p.net)); });
      // 미리 걷은 스킨스 공금은 걷어 둔 돈으로 할 일(장부의 "끝나고 나눌 돈")을 따로 묶어 적는다. 같은 돈을 두 번 적지 않는다
      var fixedPays = all.settlement.payments.filter(function (p) { return p.fixed; }), freePays = all.settlement.payments.filter(function (p) { return !p.fixed; });
      var payText = function (p) { lines.push('  ' + payName(r, p.from) + ' → ' + payName(r, p.to) + ' ' + won(p.amount)); };
      if (fixedPays.length) {
        lines.push('  스킨스 공금 (걷어 둔 돈 ' + won(all.skins.fund.cash) + '):');
        fixedPays.forEach(payText);
        if (freePays.length) { lines.push('  다른 게임 (플레이어끼리):'); freePays.forEach(payText); }
      } else {
        lines.push('  송금:');
        freePays.forEach(payText);
      }
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
    // 긴 안내는 읽을 시간을 더 준다 (글자 수에 맞춰, 최대 6초)
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, Math.min(6000, Math.max(2200, String(msg).length * 75)));
  }

  // ───────────────────────── 렌더 & 이벤트 ─────────────────────────
  // ───────────────────────── 골프장 받기 · 코스 보내기 ─────────────────────────
  // 코스 목록은 앱과 같은 곳의 courses/ 폴더에 있다 (index.json은 배포할 때 만들어진다. golf-score/courses/README.md)
  var COURSE_DIR = 'courses/';
  var courseIndex = { state: 'idle', list: null, pending: null }; // idle | loading | ok | error
  var libBusy = null; // 받는 중인 목록 항목의 파일 이름
  /** 목록 파일도 남이 고칠 수 있는 자료다: 쓸 것만 골라 정리한다 */
  function cleanIndex(j) {
    var out = [];
    if (!j || typeof j !== 'object' || !Array.isArray(j.courses)) return out;
    j.courses.slice(0, 500).forEach(function (e) {
      if (!e || typeof e !== 'object' || typeof e.file !== 'string' || !/^[^\/\\?#%]{1,120}$/.test(e.file) || !/\.json$/i.test(e.file) || e.file.charAt(0) === '.' || e.file === 'index.json') return;
      var name = typeof e.name === 'string' ? e.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, S.COURSE_MAX) : '';
      if (!name || (e.holes !== 9 && e.holes !== 18)) return;
      out.push({ file: e.file, name: name, holes: e.holes, map: e.map === true,
        updated: typeof e.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.updated) ? e.updated : '',
        note: typeof e.note === 'string' ? e.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '',
        sig: typeof e.sig === 'string' && SIG_RE.test(e.sig) ? e.sig : '' });
    });
    return out;
  }
  /**
   * 코스 폴더의 파일을 글로 받는다 → Promise<string>. 시간 제한이 있다: 응답이 오다가 멈춰도(신호가 약한 골프장 등)
   * 끝나지 않는 요청 때문에 "받는 중…"·"새로 고침" 단추가 계속 잠겨 있지 않게 한다
   */
  var FETCH_MS = 15000;
  function fetchText(url) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = null;
    // cache: 'no-store': 브라우저의 보관본을 거치지 않는다. 멈춘 요청이 하나 남아 있어도 다시 시도한 요청이 그 뒤에서 기다리지 않는다
    var work = Promise.resolve().then(function () { return fetch(url, ctl ? { cache: 'no-store', signal: ctl.signal } : { cache: 'no-store' }); })
      .then(function (res) { if (!res.ok) throw new Error('http ' + res.status); return res.text(); });
    var limit = new Promise(function (resolve, reject) {
      timer = setTimeout(function () { if (ctl) { try { ctl.abort(); } catch (e) { /* 이미 끝남 */ } } reject(new Error('timeout')); }, FETCH_MS);
    });
    return Promise.race([work, limit]).then(function (t) { clearTimeout(timer); return t; }, function (e) { clearTimeout(timer); throw e; });
  }
  function loadCourseIndex() {
    if (courseIndex.pending) return courseIndex.pending;
    courseIndex.state = 'loading';
    courseIndex.pending = fetchText(COURSE_DIR + 'index.json')
      .then(function (text) { courseIndex.list = cleanIndex(JSON.parse(text)); courseIndex.state = 'ok'; })
      .catch(function () { courseIndex.state = 'error'; })
      .then(function () { courseIndex.pending = null; if (state.view === 'courses') render(); });
    return courseIndex.pending;
  }
  /** 코스 파일의 글을 읽어 보관함에 넣는다 → { ok, course } 또는 { ok: false, why }. entry가 있으면 목록에 적힌 코스와 같은 것인지도 본다 */
  function takeCourseText(text, from, entry) {
    if (typeof text !== 'string' || text.length > S.COURSE_FILE_MAX) return { ok: false, why: 'size' };
    var obj;
    try { obj = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { return { ok: false, why: 'format' }; }
    var r = S.readCourseFile(obj);
    if (!r.ok) return r;
    // 목록에 적힌 내용 지문과 받은 파일의 내용이 다르면 목록이 가리키는 그 자료가 아니다 (중간의 저장소가 예전 파일로 답한 경우 등).
    // 받았다고 적어 두면 고쳐 올린 자료를 다시는 권하지 않게 되므로 받지 않는다.
    // 이름·홀 수도 지문에 들어 있으므로 이름을 고쳐 올린 자료가 목록과 엇갈린 때에도 여기서 걸린다 (그래서 이름 비교보다 먼저 본다)
    var sig = entry && entry.sig ? S.courseSig(r.course) : '';
    if (sig && sig !== entry.sig) return { ok: false, why: 'stale' };
    if (entry && (r.course.name !== entry.name || r.course.holes !== entry.holes)) return { ok: false, why: 'format' };
    if (staleCopy(r.course)) return { ok: false, why: 'older' };
    var bad = installCourse(r.course, from, sig);
    if (bad) return { ok: false, why: bad };
    return { ok: true, course: r.course };
  }
  /** 목록의 코스 하나를 받아 보관함에 넣는다 → Promise<{ ok, course } | { ok: false, why }> (거부되지 않는다) */
  function fetchCourse(entry) {
    var url;
    try { url = COURSE_DIR + encodeURIComponent(entry.file); } catch (e) { return Promise.resolve({ ok: false, why: 'bad' }); } // 주소로 쓸 수 없는 이름
    return fetchText(url)
      .then(function (text) { return takeCourseText(text, 'list', entry); }, function () { return { ok: false, why: 'net' }; })
      .catch(function () { return { ok: false, why: 'bad' }; });
  }
  var COURSE_WHY = { net: '받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.', size: '파일이 너무 커서 받을 수 없어요.', format: '코스 파일이 아니에요.',
    newer: '이 파일은 앱을 최신 버전으로 업데이트해야 받을 수 있어요.',
    space: '기기 저장 공간이 부족해 받지 못했어요. 오래된 기록이나 안 쓰는 받은 코스를 지운 뒤 다시 받아 주세요.',
    full: '받은 코스가 가득 찼어요. 아래 "이 폰의 코스"에서 안 쓰는 받은 코스를 지운 뒤 다시 받아 주세요.',
    older: '앱에 이미 더 새로운 자료가 들어 있는 코스예요.',
    stale: '새 자료가 아직 준비되지 않았어요. 잠시 뒤 "새로 고침"을 누르고 다시 받아 주세요.' };
  function courseWhy(why) { return Object.prototype.hasOwnProperty.call(COURSE_WHY, why) ? COURSE_WHY[why] : '코스 파일의 내용이 올바르지 않아 받지 못했어요.'; }
  /** 받았다는 알림. 새 라운드 화면이 이 코스와 다른 홀 수로 열릴 때는(지난 라운드가 9홀이었던 경우 등) 홀 수를 바꾸라고 알려 준다.
   *  새 라운드 화면에 있거나 그 화면에서 연 목록에 있으면(돌아갈 수 있으면) 그 화면에 지금 골라져 있는 홀 수로 본다.
   *  그 화면을 떠나 홈 등에 있으면 쓰던 새 라운드는 버려지므로("새 라운드 시작"은 늘 새로 만든다) 새로 열릴 때의 홀 수로 본다 */
  function gotCourseMsg(c) {
    var next = (state.view === 'setup' || (state.view === 'courses' && state.courseBack === 'setup')) && state.draft ? state.draft.holes : state.round ? state.round.holes : state.history && state.history[0] ? state.history[0].holes : 18;
    return "'" + c.name + "' 코스를 받았어요. " + (c.holes === next ? '새 라운드의 "코스 불러오기"에서 고르세요.' : '새 라운드에서 홀 수를 ' + c.holes + '홀로 바꾸면 "코스 불러오기"에 나와요.');
  }
  /**
   * 목록 항목의 상태: new(받을 수 있음) | have(받음) | update(새 자료가 있음) | shipped(앱에 기본으로 들어 있음).
   * 새 자료: 목록의 날짜가 이 폰의 것보다 늦거나, 날짜는 같은데 목록에서 받을 때의 내용 지문과 달라졌을 때 (같은 날 고쳐 올린 자료).
   * 이 폰의 것이 더 새로우면(파일로 따로 받은 경우 등) 예전 자료로 되돌리자고 하지 않는다
   */
  function indexState(e) {
    var lc = libCourse(e.name, e.holes), sc;
    if (lc) {
      var a = e.updated || '', b = lc.updated || '';
      return a > b || (a === b && e.sig && lc.sig && e.sig !== lc.sig) ? 'update' : 'have';
    }
    sc = shippedCourse(e.name, e.holes);
    if (sc) return (e.updated || '') > shippedDate(sc) ? 'update' : 'shipped';
    return 'new';
  }
  /** 이 폰에 있는 코스 전부: 내가 고쳐 저장한 것, 받은 것, 앱에 들어 있는 것 (같은 이름·홀 수는 앞의 것 하나만) */
  function deviceCourses() {
    var out = [], seen = {};
    function add(c, kind) {
      if (!c || !c.name || (c.holes !== 9 && c.holes !== 18) || !Array.isArray(c.pars) || c.pars.length !== c.holes) return;
      var k = c.holes + '|' + c.name; if (seen[k]) return; seen[k] = 1;
      out.push({ name: c.name, holes: c.holes, kind: kind, map: !!courseMapOf(c.name, c.holes), got: !!libCourse(c.name, c.holes) });
    }
    (state.courses || []).forEach(function (c) { add(c, 'mine'); });
    lib.courses.forEach(function (c) { add(c, 'lib'); });
    BUILTIN_COURSES.forEach(function (c) { add(c, 'shipped'); });
    return out;
  }
  function viewCourses() {
    var back = state.courseBack === 'setup' && state.draft ? 'setup' : 'home';
    // 이 화면을 연 채로 앱을 다시 열었을 때도 목록을 불러온다 (단추를 눌러 들어온 경우에는 이미 불러오는 중이다)
    if (courseIndex.state === 'idle') setTimeout(loadCourseIndex, 0);
    var html = topbar('골프장 받기', '', backBtn(back, back === 'setup' ? '새 라운드' : '홈'), '');
    html += '<div class="screen">';
    // 1. 코스 목록에서 받기
    html += '<div class="card" data-region="liblist"><h2>받을 수 있는 골프장</h2>';
    var list = courseIndex.list;
    if (courseIndex.state === 'error') html += '<div class="notice">목록을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.' + (list ? ' 아래는 조금 전에 받은 목록이에요.' : '') + '</div>';
    if (!list && (courseIndex.state === 'loading' || courseIndex.state === 'idle')) html += '<div class="muted">목록을 불러오는 중이에요…</div>';
    if (list && !list.length) html += '<div class="muted">아직 올라온 골프장이 없어요.</div>';
    if (list && list.length) {
      html += list.map(function (e) {
        var stt = indexState(e), busy = libBusy === e.file;
        var right = stt === 'have' ? '<span class="chip sm active">받음 ✓</span>' : stt === 'shipped' ? '<span class="chip sm">기본 포함</span>'
          : '<button class="btn sm primary" data-action="lib-get" data-file="' + esc(e.file) + '"' + (libBusy ? ' disabled' : '') + '>' + (busy ? '받는 중…' : stt === 'update' ? '새로 받기' : '받기') + '</button>';
        return '<div class="histrow"><div class="grow"><div class="t">' + esc(e.name) + '</div><div class="s">' + e.holes + '홀 · ' + (e.map ? '약도 있음' : '약도 없음') +
          (e.updated ? ' · ' + esc(e.updated) : '') + (e.note ? ' · ' + esc(e.note) : '') + '</div></div>' + right + '</div>';
      }).join('');
    }
    html += '<div class="row" style="margin-top:10px"><button class="btn sm" data-action="lib-refresh"' + (courseIndex.state === 'loading' ? ' disabled' : '') + '>새로 고침</button></div>' +
      '<div class="muted small" style="margin-top:8px">받은 골프장은 새 라운드의 "코스 불러오기"에 나와요(라운드의 홀 수와 같은 코스만 나옵니다). 고르면 파·핸디캡·홀 정보가 채워지고, 약도가 있는 골프장은 홀 약도가 나옵니다.</div></div>';
    // 2. 파일로 받기. 파일 입력 자체는 화면 밖에 하나만 있다 (courseFileInput): 여기서는 그것을 여는 단추만 그린다
    html += '<div class="card"><h2>파일로 받기</h2><div class="muted small">다른 사람이 보내 준 코스 파일(.json)을 열면 이 폰에 그 코스가 들어와요.</div>' +
      '<label class="btn block filebtn" for="course-file" role="button" tabindex="0" style="margin-top:10px">📂 코스 파일 열기</label></div>';
    // 3. 이 폰의 코스: 보내기 · 삭제
    var mine = deviceCourses();
    html += '<div class="card"><h2>이 폰의 코스 <span class="hint">보내기 · 삭제</span></h2>' + mine.map(function (c) {
      var tag = c.kind === 'mine' ? (c.got ? '받은 코스 · 내가 고쳐 저장함' : '내가 저장한 코스') : c.kind === 'lib' ? '받은 코스' : '기본 포함';
      return '<div class="histrow"><div class="grow"><div class="t">' + esc(c.name) + '</div><div class="s">' + c.holes + '홀 · ' + tag + (c.map ? ' · 약도 있음' : '') + '</div></div>' +
        '<button class="btn sm" data-action="course-send" data-name="' + esc(c.name) + '" data-holes="' + c.holes + '">보내기</button>' +
        (c.got ? '<button class="btn sm ghost danger" data-action="lib-del" data-name="' + esc(c.name) + '" data-holes="' + c.holes + '">삭제</button>' : '') + '</div>';
    }).join('') +
      '<div class="muted small" style="margin-top:8px"><b>보내기</b>를 누르면 코스 파일이 만들어져요. 카카오톡 등으로 보내면 받은 사람이 위의 "파일로 받기"로 열 수 있어요. ' +
      '직접 입력한 골프장은 새 라운드의 "코스" 칸에 이름을 적고 그 라운드를 마치면 여기에 "내가 저장한 코스"로 나옵니다.</div></div>';
    html += '</div>';
    return html;
  }
  /** 이 폰의 코스를 코스 파일로 만든다 → { name: 파일 이름, text } 또는 null */
  function courseFileOf(name, holes) {
    var c = findCourse(name, holes); if (!c) return null;
    var info = {};
    for (var h = 0; h < holes; h++) {
      var i = (c.holeInfo || {})[h], o = {};
      if (!i || typeof i !== 'object') continue;
      if (typeof i.dist === 'number' && Math.round(i.dist) >= 1 && Math.round(i.dist) <= 999) o.dist = Math.round(i.dist);
      if (i.shape === 'S' || i.shape === 'L' || i.shape === 'R') o.shape = i.shape;
      if (typeof i.haz === 'number' && (i.haz & 255) > 0) o.haz = i.haz & 255;
      if (typeof i.memo === 'string' && i.memo.trim()) o.memo = i.memo;
      if (Object.keys(o).length) info[h] = o;
    }
    var lc = libCourse(name, holes), mineCopy = savedCourse(name, holes);
    // 자료 기준일: 내가 고친 코스는 오늘, 받은 그대로면 받은 날짜, 앱에 들어 있는 그대로면 그 기준일
    var updated = mineCopy ? today() : lc ? (lc.updated || today()) : SHIPPED_UPDATED;
    var obj = S.makeCourseFile({ name: c.name, holes: holes, pars: c.pars, strokeIndex: c.strokeIndex, holeInfo: info }, courseMapOf(name, holes), { updated: updated, note: !mineCopy && lc ? lc.note : '' });
    var text = JSON.stringify(obj), check = null;
    try { check = S.readCourseFile(JSON.parse(text)); } catch (e) { check = null; }
    if (!check || !check.ok || text.length > S.COURSE_FILE_MAX) return null;
    var base = c.name.replace(/[\\\/:*?"<>|#%&{}$!'@+`=\s·()\[\],.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'course';
    return { name: base + '-' + holes + '.json', text: text };
  }
  function sendCourse(name, holes) {
    var f = courseFileOf(name, holes);
    if (!f) { toast('이 코스는 파일로 만들 수 없어요.'); return; }
    var file = null;
    try { file = new File([f.text], f.name, { type: 'application/json' }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.share) {
      var ok = false; try { ok = navigator.canShare({ files: [file] }); } catch (e2) { ok = false; }
      if (ok) { navigator.share({ files: [file], title: name }).catch(function () { }); return; }
    }
    // 파일 공유 창이 없는 환경: 파일로 내려받는다
    try {
      var url = URL.createObjectURL(new Blob([f.text], { type: 'application/json' })), a = document.createElement('a');
      a.href = url; a.download = f.name; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast('코스 파일을 저장했어요: ' + f.name);
    } catch (e3) { toast('이 기기에서는 파일로 저장할 수 없어요.'); }
  }
  /** "코스 파일 열기"에서 고른 파일을 읽어 받는다 */
  /** 코스를 받은 뒤 화면을 맞춘다. 그 사이에 새 라운드 화면으로 돌아가 있었으면 "코스 불러오기"에 방금 받은 코스가 나오게 한다 (이름을 치는 중이면 다 친 뒤에).
   *  그 화면을 아래로 내려 보고 있었다면 보던 내용이 밀리지 않게 render()가 스크롤을 맞춘다 */
  function afterCourseChange() {
    if (state.view === 'courses') render(); else if (state.view === 'setup') softRender();
  }
  function importCourseFile(el) {
    var file = el.files && el.files[0];
    el.value = '';
    if (!file) return;
    if (file.size > S.COURSE_FILE_MAX * 4) { toast(courseWhy('size')); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var res = takeCourseText(String(rd.result || ''), 'file');
      toast(res.ok ? gotCourseMsg(res.course) : courseWhy(res.why));
      afterCourseChange();
    };
    rd.onerror = function () { toast('파일을 읽지 못했어요.'); };
    rd.readAsText(file);
  }
  // "코스 파일 열기"의 파일 입력은 다시 그려지는 화면(#app) 밖에 하나만 둔다: 파일을 고르는 동안 화면이 다시 그려져도
  // (함께 입력하는 동반자의 점수가 들어오는 등) 고른 파일이 버려지지 않는다. 화면에는 이것을 여는 단추(label)만 그린다
  var courseFileInput = document.createElement('input');
  courseFileInput.type = 'file'; courseFileInput.id = 'course-file'; courseFileInput.accept = '.json,application/json,text/plain';
  courseFileInput.tabIndex = -1; courseFileInput.setAttribute('aria-hidden', 'true');
  courseFileInput.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
  courseFileInput.addEventListener('change', function () { importCourseFile(courseFileInput); });
  document.body.appendChild(courseFileInput);
  /**
   * 진행 중인 라운드의 코스가 이 폰에 없으면 코스 목록에서 찾아 받아 둔다: 함께 입력하는 폰에도 호스트와 같은 홀 약도가 나오게 한다.
   * 약도가 있는 코스만 조용히 시도한다 (안 되면 약도 없이 그대로 쓴다). 답이 분명하면(목록에 없다, 받았다, 파일이 올바르지 않다)
   * 그 코스는 다시 시도하지 않고, 연결이 안 되어 못 받았으면 앱으로 돌아오거나 연결이 돌아왔을 때 다시 시도한다 (AUTO_COURSE_GAP 간격을 두고)
   */
  var autoCourse = {}, AUTO_COURSE_GAP = 30000;
  function ensureRoundCourse() {
    var r = state.round; if (!r) return;
    var name = (r.course || '').trim(), holes = r.holes, key = holes + '|' + name, t = autoCourse[key];
    if (!name || (t && t.done) || courseMapOf(name, holes) || libCourse(name, holes)) return;
    if (t && (t.busy || Date.now() - t.at < AUTO_COURSE_GAP)) {
      // 시도하는 중이거나 간격이 덜 지났다: 버리지 않고 간격이 끝날 때 한 번 다시 본다
      // (연결이 몇 초 만에 돌아오면 그때의 신호가 간격 안에 들어와서, 화면을 켜 둔 채로는 다시 시도할 계기가 없어진다)
      if (!t.timer) t.timer = setTimeout(function () { t.timer = null; ensureRoundCourse(); }, Math.max(1000, AUTO_COURSE_GAP - (Date.now() - t.at)));
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (t && t.timer) clearTimeout(t.timer);
    t = autoCourse[key] = { done: false, busy: true, at: Date.now(), timer: null };
    loadCourseIndex().then(function () {
      if (courseIndex.state !== 'ok') return; // 목록을 받지 못했다: 나중에 다시
      var e = (courseIndex.list || []).filter(function (x) { return x.name === name && x.holes === holes && x.map; })[0];
      if (!e) { t.done = true; return; }
      var cur = state.round;
      if (!cur || (cur.course || '').trim() !== name || cur.holes !== holes) return; // 목록을 기다리는 사이에 그 라운드를 떠났다: 받지 않는다
      return fetchCourse(e).then(function (res) {
        if (res.ok || (res.why !== 'net' && res.why !== 'stale')) t.done = true; // 연결 문제나 아직 준비되지 않은 자료는 나중에 다시
        if (res.ok && state.round && (state.round.course || '').trim() === name) softRender();
      });
    }).catch(function () { /* 조용히 그만둔다 */ }).then(function () { t.busy = false; });
  }

  function viewHtml() {
    var views = { home: viewHome, setup: viewSetup, settings: viewSettings, play: viewPlay, board: viewBoard, card: viewCard, analysis: viewAnalysis, share: viewShare, joining: viewJoining, courses: viewCourses };
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
  /**
   * 새 라운드 화면이 그려져 있을 때 스크롤을 맞추는 기준 위치. 다른 화면이면 null.
   * 기본은 코스 칸에서 높이가 바뀌는 부분("코스 불러오기"와 그 아래 안내) 바로 밑에 있는 단추의 윗변.
   * whole이면 그 단추가 든 카드("라운드 정보")의 아랫변: 단추 아래의 설명 줄도 고른 코스에 따라 높이가 달라지기 때문이다
   */
  function setupAnchorTop(whole) {
    var a = $app.querySelector('[data-action="open-courses"][data-back="setup"]'), card = whole && a && a.closest ? a.closest('.card') : null;
    return card ? card.getBoundingClientRect().bottom : a ? a.getBoundingClientRect().top : null;
  }
  /**
   * 리더보드의 탭 줄: 화면을 다시 그리면 옆으로 밀어 둔 위치가 맨 왼쪽으로 돌아가서, 뒤쪽 탭을 고를 때마다 줄을 다시 밀어야 했다.
   * 그리기 전의 위치(x)를 되돌린다. 고른 탭을 보이는 자리로 데려오는 것(줄 끝에서 36px 안쪽까지: 옆 탭이 조금 보이게)은
   * 탭을 눌렀을 때, 탭 줄이 새로 생겼을 때(다른 화면에서 옴 · 앱을 다시 엶), 탭 줄의 내용이 바뀌었을 때(게임을 켜고 끔),
   * 화면 폭이 바뀌었을 때(화면을 돌림: 아래의 resize 처리)만 한다.
   * was: 그리기 전 탭 줄의 내용. 그대로면(동반자의 점수가 들어와 다시 그린 경우 등) 위치만 되돌린다: 다른 탭을 보려고 줄을 밀어 둔 것을 되돌리지 않는다
   */
  function keepTabStrip(x, was) {
    var strip = $app.querySelector('.tabs'), cur = strip && strip.querySelector('button.active');
    if (!strip) return;
    if (x) strip.scrollLeft = x;
    if (!cur || strip.innerHTML === was) return;
    var sr = strip.getBoundingClientRect(), cr = cur.getBoundingClientRect(), peek = 36;
    if (cr.left < sr.left + peek) strip.scrollLeft += cr.left - sr.left - peek;
    else if (cr.right > sr.right - peek) strip.scrollLeft += cr.right - sr.right + peek;
  }
  /** 지금 그려진 화면을 가리키는 표시: 같은 화면을 다시 그릴 때만 옆으로 민 표의 위치를 되돌린다 (keepWraps) */
  function screenSig() { return state.view + '|' + (state.view === 'board' ? state.boardTab : '') + '|' + (state.viewRoundId || ''); }
  var drawnSig = null;
  /**
   * 옆으로 미는 표(.tablewrap: 플레이어가 많은 홀별 스코어, 스코어카드 등)는 다시 그리면 맨 왼쪽으로 돌아간다. 함께 보는 라운드에서는
   * 점수가 들어올 때마다 다시 그리므로 보던 칸이 계속 사라진다 → 같은 화면을 다시 그린 것이면 그리기 전 위치(xs)로 되돌린다
   */
  function keepWraps(xs, same) {
    var wraps = $app.querySelectorAll('.tablewrap');
    if (!same || wraps.length !== xs.length) return;
    for (var i = 0; i < wraps.length; i++) if (xs[i]) wraps[i].scrollLeft = xs[i];
  }
  /** showTab: 탭을 눌러서 다시 그리는 것이면 true (고른 탭을 보이는 자리로 데려온다: keepTabStrip) */
  function render(showTab) {
    var y = window.scrollY, mz = $app.querySelector('.mapzoom'), my = mz ? mz.scrollTop : 0; // 약도 크게 보기 창은 따로 스크롤된다
    var tabs0 = $app.querySelector('.tabs'), tabsX = tabs0 ? tabs0.scrollLeft : 0, tabsWas = tabs0 && showTab !== true ? tabs0.innerHTML : null;
    var wrapsX = [].map.call($app.querySelectorAll('.tablewrap'), function (w) { return w.scrollLeft; }), sig0 = drawnSig;
    var keep = setupAnchorTop(), bar = keep === null ? null : $app.querySelector('.topbar'), lim = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
    var whole = keep !== null && setupAnchorTop(true) <= lim; // 카드가 통째로 화면 위로 지나갔으면 카드의 아랫변을 기준으로 삼는다
    if (whole) keep = setupAnchorTop(true); else if (keep !== null && keep > lim) keep = null; // 코스 칸이 보이는 중이면 그대로 둔다
    $app.innerHTML = viewHtml();
    mz = $app.querySelector('.mapzoom');
    document.documentElement.classList.toggle('noscroll', !!mz); // 약도 창이 열려 있는 동안 뒤 화면이 따라 움직이지 않게
    window.scrollTo(0, y);
    // 새 라운드 화면: 코스 칸이 화면 위로 지나가 있는 동안 그 칸의 높이가 바뀌면(받던 코스가 도착해 "코스 불러오기"가 한 줄 늘 때 등)
    // 보고 있던 내용이 손가락 아래에서 밀린다. 코스 칸 아래 내용이 제자리에 있도록 스크롤을 맞춘다
    var now = keep === null ? null : setupAnchorTop(whole), dy = now === null ? 0 : Math.round(now - keep);
    if (dy) window.scrollBy(0, dy);
    if (mz && my) mz.scrollTop = my;
    centerHoleStrip();
    keepTabStrip(tabsX, tabsWas);
    drawnSig = screenSig();
    keepWraps(wrapsX, sig0 === drawnSig);
    fitSummary();
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
    flushKwDraft(true); // 쓰던 키워드가 있으면 종료 전에 넣는다
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
    flushKwDraft(true); // 쓰던 키워드가 있으면 코스 저장 전에 넣는다
    r.finishedAt = r.finishedAt || Date.now();
    autoSaveCourse(r); // 코스 이름을 넣은 라운드는 코스 정보를 기기에 저장 (이미 저장해 둔 코스에는 이번 라운드에서 고친 칸만 반영)
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
        // 예전 버전에서 만든 라운드에는 그 뒤에 생긴 설정(공금 방식, 니어·롱기 홀 제한과 지우개)이 없었다. 그대로 베끼면 꺼진 채로 시작하므로 새 기본값을 준다.
        // 이 버전에서 만든 라운드를 베낄 때는 본인이 고른 값(끈 것 포함)을 그대로 따른다
        state.draft.games = upgradeDefaults(fillGames(clone(prev.games || {})), copiedFrom(prev));
        state.draft.games.skins.playorder = true;
        // 내기 시작 홀은 이어받지 않는다: 그날의 동반자에 따라 정하는 값이라 새 라운드는 늘 '처음부터'로 시작한다
        state.draft.games.stroke.from = 1;
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
      // 홀 수를 줄였는데 내기 시작 홀이 그보다 뒤이면 처음부터로 되돌린다 (18홀의 '후반부터'가 9홀 라운드에 남지 않게)
      if (d.path === 'draft.holes' && state.draft && state.draft.games && state.draft.games.stroke && state.draft.games.stroke.from > v) state.draft.games.stroke.from = 1;
      save(); render();
    },
    'toggle-money': function (d) {
      var r = state.round; if (!r || state.readOnly || !r.games[d.key]) return;
      r.games[d.key].enabled = !r.games[d.key].enabled; save(); render();
    },
    'fund-collect': function (d) { // 공금을 미리 걷었는지: 손익은 그대로이고 송금 정리만 달라진다. 끝난 기록에서도 바꿀 수 있다(그 기기에서만)
      var r = getRound(); if (!r || !r.games || !r.games.skins) return;
      r.games.skins.collect = d.v === '1'; save(); render();
    },
    'toggle-bonus': function (d) {
      var r = state.round; if (!r || ['nearest', 'longest', 'birdie'].indexOf(d.type) < 0) return;
      r.games.bonus[d.type] = !r.games.bonus[d.type]; save(); render();
    },
    tab: function (d) { state.boardTab = d.tab; save(); render(true); },
    'tab-settle': function () { state.boardTab = 'settle'; go('board'); },
    hole: function (d) { var i = Number(d.i); if (i >= 0 && i < state.round.holes) { state.round.currentHole = i; save(); render(); } },
    score: function (d) {
      var r = state.round, h = r.currentHole, delta = Number(d.delta);
      if (!r.scores[d.pid] || !canEdit(r, d.pid)) return;
      var auto = autoScore(r, d.pid, h);
      if (auto !== null && auto === G.gross(r, d.pid, h)) { // 자동 계산 중인 칸: ±는 샷 수를 바꾼다 (합계와 구성 요소가 어긋나지 않게)
        var want = auto + (delta > 0 ? 1 : -1); // 화면에 보이는 타수에서 ±1 (합이 상한(15타, 양파 한도면 파의 두 배)을 넘어 있어도 한 번에 움직이게)
        var sh = want - penaltyOf(r, d.pid, h) - A.stat(r, d.pid, h, 'pt');
        if (want > G.maxScore(r, h) || sh < 1 || sh > S.STAT_FIELDS.sh.max) return;
        setStat(r, d.pid, h, 'sh', sh); applyAutoScore(r, d.pid, h);
        save(); render(); return;
      }
      var cur = G.gross(r, d.pid, h); // 화면에 보이는 타수 기준 (양파 한도보다 크게 저장돼 있던 값은 한도에서 움직인다)
      var v = cur === null ? r.pars[h] + delta : cur + delta;
      r.scores[d.pid][h] = Math.min(G.maxScore(r, h), Math.max(1, v));
      save(); render();
    },
    'score-tap': function (d) {
      var r = state.round, h = r.currentHole;
      if (!r.scores[d.pid] || !canEdit(r, d.pid)) return;
      if (r.scores[d.pid][h] === null || r.scores[d.pid][h] === undefined) { r.scores[d.pid][h] = r.pars[h]; save(); render(); }
    },
    'score-clear': function (d, el, ev) {
      ev.stopPropagation(); var r = state.round; if (!r.scores[d.pid] || !canEdit(r, d.pid)) return;
      r.scores[d.pid][r.currentHole] = null;
      setStat(r, d.pid, r.currentHole, 'sh', null); // 샷 수도 지운다: 남아 있으면 다음 입력 때 타수가 다시 계산돼 버림
      save(); render();
    },
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
    stat: function (d) { // 샷 수 · OB · 해저드 · 벙커 횟수 ±1
      var r = state.round, f = d.f;
      if (!r || !G.playerById(r, d.pid) || !canEdit(r, d.pid) || (f !== 'sh' && f !== 'ob' && f !== 'hz' && f !== 'bk')) return;
      var h = r.currentHole, up = Number(d.delta) > 0;
      if (f === 'sh') {
        var sh = A.stat(r, d.pid, h, 'sh'), v;
        if (sh === null) { // 처음 누를 때: 이미 넣은 타수가 있으면 거기서 벌타·퍼트(없으면 2퍼트로 가정)를 뺀 값, 없으면 파 온 기준(파 − 2)
          var sc = r.scores[d.pid][h], pt0 = A.stat(r, d.pid, h, 'pt');
          v = (sc !== null && sc !== undefined) ? sc - penaltyOf(r, d.pid, h) - (pt0 === null ? 2 : pt0) : r.pars[h] - 2;
          v = Math.max(1, v);
        } else v = sh + (up ? 1 : -1);
        setStat(r, d.pid, h, 'sh', v < 1 ? null : Math.min(S.STAT_FIELDS.sh.max, v)); // 1에서 −를 누르면 지움
      } else {
        var cur = A.stat(r, d.pid, h, f) || 0;
        setStat(r, d.pid, h, f, Math.min(S.STAT_FIELDS[f].max, Math.max(0, cur + (up ? 1 : -1))));
      }
      applyAutoScore(r, d.pid, h);
      save(); render();
    },
    'stat-set': function (d) { // 퍼트 수 · 페어웨이: 값을 눌러 정하고, 같은 값을 다시 누르면 지움
      var r = state.round, f = d.f;
      if (!r || !G.playerById(r, d.pid) || !canEdit(r, d.pid) || (f !== 'pt' && f !== 'fw')) return;
      var h = r.currentHole, v = Number(d.v), cur = A.stat(r, d.pid, h, f);
      var same = cur !== null && (cur === v || (f === 'pt' && v === 4 && cur >= 4));
      setStat(r, d.pid, h, f, same ? null : v);
      applyAutoScore(r, d.pid, h);
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
    // 아래 hi-*/kw-* 동작은 입력란이 있는 홀에서만 일어난다. 보기 전용 홀인데 눌렸다면(코스 이름이 방금 바뀌어 입력란이 아직 남아 있던 경우) 다시 그려 입력란을 치운다
    'map-zoom': function () { var r = state.round; if (!r) return; state.mapZoom = r.currentHole; save(); render(); }, // 그 홀에서만 열려 있다(홀을 옮기면 닫힘)
    'map-close': function () { state.mapZoom = null; save(); render(); },
    'map-stay': function () { }, // 창 안쪽을 눌렀을 때는 닫지 않는다
    'course-jump': function () { // 홀 카드의 요약 줄 → 아래 코스 정보 카드로 이동 (접힌 카드에 보여 줄 내용이 없는 홀이면 입력란을 펼침: 정보가 없거나 거리만 있는 홀)
      var r = state.round; if (!r) return;
      if (!state.courseOpen && !courseLive(r, r.currentHole, r.pars[r.currentHole])) { state.courseOpen = true; save(); render(); }
      var card = document.getElementById('course-card');
      if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    'hi-shape': function (d) {
      var r = state.round; if (!r || state.readOnly) return;
      var h = r.currentHole, cur = A.holeInfo(r, h).shape;
      if (courseFixed(r, h)) { render(); return; }
      setHoleInfo(r, h, 'shape', cur === d.v ? null : d.v); save(); render();
    },
    'hi-haz': function (d) {
      var r = state.round, bit = Number(d.bit); if (!r || state.readOnly) return;
      var h = r.currentHole;
      if (courseFixed(r, h)) { render(); return; }
      settleUpgrade(r, h);
      // 누른 위험 요소 하나만 바꾼다(비트별 공유 키) → 동반자가 같은 홀의 다른 위험 요소를 동시에 표시해도 서로 지우지 않음
      if (!setHoleInfo(r, h, 'z' + bit, (A.holeInfo(r, h).haz & bit) ? null : 1)) return;
      save(); render();
    },
    'kw-add': function (d, el, ev) { // 공략 키워드 추가 (쉼표로 나눠 여러 개를 한 번에 넣을 수 있다)
      var r = state.round; if (!r || state.readOnly) return;
      var h = r.currentHole, inp = document.getElementById('kw-in');
      if (courseFixed(r, h)) { state.kwDraft = null; render(); return; }
      var text = inp ? inp.value : kwDraft(r, h);
      if (!A.memoWords(text).length) { if (inp) inp.focus(); return; }
      // 너무 긴 키워드나 한도를 넘는 추가는 넣지 않고 알려 준다. 쓰던 글은 입력란에 그대로 둔다
      var n = addKeywords(r, h, text);
      if (n === 'long') { toast('키워드 하나는 ' + KW_MAX + '자까지예요. 쉼표로 나눠 짧게 적어 주세요'); return; }
      if (n === 'full') { toast('키워드가 너무 많아요. 안 쓰는 키워드를 지우고 추가해 주세요'); return; }
      if (!n) toast('이미 있는 키워드예요');
      state.kwDraft = null;
      save(); render();
      if (ev && ev.type === 'keydown') { var again = document.getElementById('kw-in'); if (again) again.focus(); } // 자판으로 이어서 넣는 중이면 입력란에 머문다
    },
    'kw-del': function (d) {
      var r = state.round; if (!r || state.readOnly) return;
      var h = r.currentHole, words = A.memoWords(A.holeInfo(r, h).memo), i = words.indexOf(d.kw);
      if (courseFixed(r, h)) { render(); return; }
      if (i < 0) return;
      words.splice(i, 1);
      var memo = joinKw(words);
      while (memo === null) { words.pop(); memo = joinKw(words); } // 일어나지 않는 경우(지우면 늘 짧아진다)지만, 중간이 잘린 토막을 남기지는 않는다
      settleUpgrade(r, h);
      setHoleInfo(r, h, 'memo', memo);
      save(); render();
    },
    'del-course': function () { // 저장한 코스 삭제 (같은 이름의 기본 제공 코스가 있으면 그 값으로 되돌아감)
      var d = state.draft; if (!d) return;
      var name = (d.course || '').trim(), bi = builtinCourse(name, d.holes);
      if (!savedCourse(name, d.holes)) return;
      if (!confirm(bi ? "내가 저장한 '" + name + "' 코스를 지우고 " + (libCourse(name, d.holes) ? '받은 값' : '기본 제공 값') + "으로 되돌릴까요?" : "저장한 '" + name + "' 코스를 삭제할까요? (지난 라운드 기록은 그대로예요)")) return;
      state.courses = (state.courses || []).filter(function (c) { return !(c && c.name === name && c.holes === d.holes); });
      if (!bi) d.course = '';
      save(); render();
    },
    'pick-course': function (d) { if (!state.draft) return; state.draft.course = (state.draft.course || '').trim() === d.name ? '' : d.name; save(); render(); },
    // 골프장 받기 · 코스 보내기
    'open-courses': function (d) { state.courseBack = d.back === 'setup' ? 'setup' : 'home'; go('courses'); loadCourseIndex(); },
    'lib-refresh': function () { loadCourseIndex(); render(); },
    'lib-get': function (d) {
      var e = (courseIndex.list || []).filter(function (x) { return x.file === d.file; })[0];
      if (!e || libBusy) return;
      libBusy = e.file; render();
      fetchCourse(e).then(function (res) {
        libBusy = null;
        toast(res.ok ? gotCourseMsg(res.course) : courseWhy(res.why));
        afterCourseChange();
      });
    },
    'lib-del': function (d) {
      var holes = Number(d.holes), r = state.round;
      if (!libCourse(d.name, holes)) return;
      // 진행 중인 라운드가 쓰는 코스는 지우지 않는다: 치는 도중에 홀 약도가 사라지고, 다음에 앱을 열면 자동으로 다시 받아져서 지운 것이 되돌아온다
      if (r && (r.course || '').trim() === d.name && r.holes === holes) { toast('진행 중인 라운드가 이 코스를 쓰고 있어요. 라운드를 마친 뒤에 지울 수 있어요.'); return; }
      var mine = !!savedCourse(d.name, holes); // 받은 코스를 내가 고쳐 저장한 사본이 있으면 함께 지운다 (사본만 남으면 지운 코스가 계속 보인다)
      if (!confirm("받은 '" + d.name + "' 코스를 이 폰에서 지울까요?" + (mine ? ' 내가 고쳐 저장한 값도 함께 지워져요.' : '') + ' (지난 라운드 기록은 그대로예요)')) return;
      removeLibCourse(d.name, holes);
      if (mine) { state.courses = (state.courses || []).filter(function (c) { return !(c && c.name === d.name && c.holes === holes); }); save(); }
      render();
    },
    'course-send': function (d) { sendCourse(d.name, Number(d.holes)); },
    // 분석 화면
    'an-player': function (d) { state.anPid = d.pid; state.anHole = null; save(); render(); },
    'an-hole': function (d) { var i = Number(d.i); state.anHole = state.anHole === i ? null : i; save(); render(); },
    'an-start': function (d) { // 출발 홀 직접 지정. 스킨스 이월·오장의 순서가 따라 바뀌므로 아직 열려 있는 공유 라운드에서는 함께 보는 기기에도 전해진다 (sync.js의 'start' 키). 기록으로 저장된 라운드는 이 기기에서만 바뀐다
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
      var r = state.round, h = r.currentHole, bn = r.games.bonus, par = r.pars[h];
      if (!G.playerById(r, d.pid) || ['nearest', 'longest', 'eraser'].indexOf(d.type) < 0) return;
      // 홀 제한: 니어는 파3, 롱기는 파5 홀에서만 (설정이 켜져 있을 때)
      if ((d.type === 'nearest' && bn.parthree && par !== 3) || (d.type === 'longest' && bn.parfive && par !== 5)) return;
      var ex = (r.extras && r.extras[h]) || {};
      // 지우개: 파3에서 니어를 고른 뒤에, 니어를 한 사람이 아닌 사람만 고를 수 있다
      if (d.type === 'eraser' && (!bn.eraser || par !== 3 || !ex.nearest || ex.nearest === d.pid)) return;
      r.extras = r.extras || {}; r.extras[h] = ex;
      // 함께 쓰는 기기끼리 니어와 지우개를 겹쳐 고치면, 화면에는 안 보이는 지우개(니어가 없거나 니어와 같은 사람)가 남을 수 있다.
      // 그대로 두면 다음에 고르는 니어가 곧바로 지워지므로, 니어를 누를 때 그런 지우개는 먼저 없앤다
      if (d.type === 'nearest' && ex.eraser && (!ex.nearest || ex.nearest === ex.eraser)) ex.eraser = null;
      ex[d.type] = ex[d.type] === d.pid ? null : d.pid;
      // 니어가 없어지거나 지우개로 적힌 사람이 니어가 되면 지우개 표시는 뜻이 없으므로 함께 지운다
      if (d.type === 'nearest' && ex.eraser && (!ex.nearest || ex.nearest === ex.eraser)) ex.eraser = null;
      if (!ex.nearest && !ex.longest && !ex.eraser) delete r.extras[h];
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
    flushKwDraft(); // 쓰던 키워드를 둔 채 다른 홀·다른 화면으로 넘어갔으면 그 홀에 넣어 준다
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
    el._typed = el.value; // 이 입력란에서 마지막으로 받은 값 (아래 change 처리에서 쓴다)
    if (el.dataset && el.dataset.hi) { courseInput(el); return; }
    if (el.dataset && el.dataset.kwin) { // 치는 대로 기기에 적어 둔다 (전화가 잠기거나 앱이 다시 열려도 잃지 않게. 라운드에 넣는 것은 추가를 누르거나 홀을 떠날 때)
      var kr = state.round; state.kwDraft = kr ? { rid: kr.id, h: kr.currentHole, v: el.value } : null;
      save(); return;
    }
    if (!el.dataset || !el.dataset.bind) return;
    if (el.type === 'checkbox' || el.tagName === 'SELECT') return; // change 이벤트에서 처리
    bindInput(el, false);
  });
  $app.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.dataset || !el.dataset.bind) return;
    var toggle = el.type === 'checkbox' || el.tagName === 'SELECT';
    // 글·숫자 입력란은 칠 때마다(input) 이미 저장했다. 입력란을 떠날 때의 change에서 같은 값을 또 쓰면, 그 사이 동반자가 고친 새 값을
    // (커서가 있는 입력란은 다시 그리지 않아 화면에는 옛 글이 남아 있다) 옛 글로 덮어쓰게 된다 → 마지막 input 뒤로 달라진 게 없으면 쓰지 않는다
    if (!toggle && el._typed === el.value) return;
    // 숫자/텍스트 입력은 blur 시점에 change가 발생하므로 재렌더하면 다음 탭이 유실됨 → 체크박스/셀렉트만 재렌더
    bindInput(el, toggle);
  });
  $app.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'join-code') { ev.preventDefault(); joinRoom(ev.target.value, 0); }
    // 키워드 입력란에서 Enter = 추가. 한글 조합 중의 Enter(글자 확정)는 넘긴다
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'kw-in' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); actions['kw-add']({}, ev.target, ev); }
    // "코스 파일 열기"는 label이라 키보드로는 눌리지 않는다: Enter·스페이스로도 열리게 한다
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.tagName === 'LABEL' && ev.target.htmlFor === 'course-file') { ev.preventDefault(); courseFileInput.click(); }
  });
  function wakeSession() {
    ensureRoundCourse(); // 연결이 안 되어 받지 못한 라운드의 코스가 있으면 다시 시도한다
    fgAt = Date.now();
    setTimeout(function () { if (session && sharingActive()) { session.wake(); softRender(); } }, 400);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') wakeSession(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) wakeSession(); });
  window.addEventListener('online', wakeSession);
  // 화면을 돌리거나 폭이 바뀌면 요약 줄 맞춤을 다시 보고, 리더보드에서는 고른 탭이 줄 밖으로 나가지 않게 한다.
  // 높이만 바뀐 경우(폰 브라우저의 주소창이 숨거나 나올 때)에는 탭 줄을 건드리지 않는다: 다른 탭을 보려고 밀어 둔 줄이 되돌아가면 안 된다
  var seenWidth = document.documentElement.clientWidth;
  window.addEventListener('resize', function () {
    var w = document.documentElement.clientWidth, strip = w !== seenWidth ? $app.querySelector('.tabs') : null;
    seenWidth = w;
    fitSummary();
    if (strip) keepTabStrip(strip.scrollLeft, null);
  });
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
  try { render(); }
  catch (err) {
    // 저장된 화면(새 라운드 초안 등)이 이 버전과 맞지 않아 그리다 실패한 경우: 홈으로 돌아가 다시 그린다 (라운드와 기록은 그대로)
    if (window.console) console.warn('[render]', err && err.message ? err.message : err);
    state.view = 'home'; state.draft = null; state.readOnly = false; state.viewRoundId = null;
    try { save(); render(); } catch (err2) { $app.innerHTML = '<div class="screen"><div class="card"><h2>화면을 열지 못했어요</h2><div class="muted">앱을 다시 열어 주세요. 입력해 둔 점수는 기기에 그대로 있어요.</div></div></div>'; }
  }
  ensureRoundCourse();
  if (pendingJoin) setTimeout(function () {
    var seq = sessionSeq;
    joinRoom(pendingJoin.code, pendingJoin.b);
    // 참여가 시작되지 않았으면(잘못된 코드, 취소 등) 진행 중이던 내 공유를 다시 연결
    if (!state.joining && !scan && sessionSeq === seq) ensureSession();
  }, 50);
  else ensureSession();
})();
