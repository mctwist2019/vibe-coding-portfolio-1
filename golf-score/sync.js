/*
 * sync.js — 실시간 공유(동기화) 모듈
 *  - 라운드를 필드 단위 key/value 맵으로 투영하고, 키별 last-writer-wins(하이브리드 논리 시계)로 병합
 *  - 방 코드(8자리)에서 PBKDF2로 토픽과 AES-GCM 키를 함께 유도. 공개 MQTT 브로커(WebSocket)로 전송 (mqtt.js 필요)
 *  - 브로커는 방 단위로 고정(자동 전환 없음). 늦게 참여한 기기는 retained 스냅샷 또는 hello 요청 응답으로 상태를 받음
 * 브라우저(window.GolfSync2)와 Node(require) 양쪽에서 사용 가능. 순수 로직은 Node 테스트로 검증.
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
  root.GolfSync2 = api; // 이름의 2: games.js의 같은 줄 설명 참고
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I 제외, 32자
  var CODE_LEN = 8;
  var TOPIC_ROOT = 'golfscore/v2/';
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://mqtt.eclipseprojects.io:443/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];
  var TEAMS = ['A', 'B', 'C', 'D'];
  // 홀마다 적는 사람: 니어리스트 · 롱기스트 · 지우개(파3에서 니어를 지운 사람). 값은 플레이어 id
  var EXTRA_FIELDS = ['nearest', 'longest', 'eraser'];
  var GAME_SCHEMA = {
    stroke: { enabled: 'bool', net: 'bool', unit: 'money', cap: 'bool' },
    stableford: { enabled: 'bool', net: 'bool' },
    skins: { enabled: 'bool', net: 'bool', mode: 'mode', unit: 'money', fund: 'bool', stake: 'money', prize: 'money', start: 'money', tip: 'money', caddie: 'money', collect: 'bool', oecd: 'bool', fine: 'money', playorder: 'bool' },
    ojang: { enabled: 'bool', net: 'bool', unit: 'money', carry: 'bool', birdie: 'bool', near: 'bool' },
    match: { enabled: 'bool', net: 'bool', mode: 'mode', unit: 'money' },
    nassau: { enabled: 'bool', net: 'bool', mode: 'mode', unit: 'money' },
    bestball: { enabled: 'bool', net: 'bool', count: 'count', unit: 'money' },
    vegas: { enabled: 'bool', net: 'bool', unit: 'money' },
    bonus: { nearest: 'bool', longest: 'bool', birdie: 'bool', unit: 'money', parthree: 'bool', parfive: 'bool', eraser: 'bool' }
  };
  /**
   * 홀별 상세 기록(선택 입력): round.stats[pid][hole][field]
   *   ob/hz/bk = 횟수(1 이상만 저장, 0은 '기록 없음'), pt = 퍼트 수(0 = 칩인), fw = 티샷 결과 1 페어웨이 안착 / 2 왼쪽 / 3 오른쪽
   */
  var STAT_FIELDS = { sh: { min: 1, max: 15 }, ob: { min: 1, max: 9 }, hz: { min: 1, max: 9 }, bk: { min: 1, max: 9 }, pt: { min: 0, max: 9 }, fw: { min: 1, max: 3 } };
  var STAT_NAMES = Object.keys(STAT_FIELDS);
  /**
   * 홀별 코스 정보(선택 입력): round.holeInfo[hole] = { dist: 거리(1~999), shape: 'S' 직선 | 'L' 좌 도그렉 | 'R' 우 도그렉,
   *   haz: 위험 요소 비트(1 OB좌, 2 OB우, 4 해저드좌, 8 해저드우, 16 그린 앞 해저드, 32 벙커좌, 64 벙커우, 128 그린 주변 벙커), memo: 공략 메모 }
   * 코스 이름은 round.course
   * 18홀 출발 홀을 직접 고른 값은 round.startBack(true 10번홀 · false 1번홀 · 없으면 입력 순서로 추정)이고 키 'start'('in' · 'out' · '')로 공유한다.
   *   스킨스 이월과 오장의 '앞 홀'이 이 순서를 따르므로, 기기마다 다르면 같은 라운드의 정산이 달라진다
   * 위험 요소는 라운드 안에서는 비트마스크(haz) 하나지만 공유할 때는 비트마다 따로 보낸다: hi:<홀>:z<비트> = 1 | null.
   * 마스크를 한 키에 실으면 같은 홀의 서로 다른 위험 요소를 두 기기가 따로 표시했을 때 늦게 쓴 쪽이 다른 쪽 입력을 지운다.
   */
  var HOLE_FIELDS = ['dist', 'shape', 'memo'];
  var HAZ_BITS = [1, 2, 4, 8, 16, 32, 64, 128];
  function hazBit(f) { var m = /^z(\d{1,3})$/.exec(f), b = m ? +m[1] : 0; return HAZ_BITS.indexOf(b) >= 0 ? b : 0; }
  function hazMask(info) { var m = info ? info.haz : 0; return typeof m === 'number' && isFinite(m) && m > 0 ? m & 255 : 0; }
  var MEMO_MAX = 200, COURSE_MAX = 40;
  var PRESENCE_INTERVAL = 25000;
  var PRESENCE_TTL = 75000;
  var OP_DEBOUNCE = 250;
  var SNAP_DEBOUNCE = 2000;
  var HYDRATE_GRACE = 2000;
  var HELLO_REPLY_MIN = 200, HELLO_REPLY_SPREAD = 700;
  var SKEW_WARN = 60000;
  /** 이보다 먼 미래의 타임스탬프는 신뢰하지 않음 (시계 오염/악의적 값 방지). 통상적인 폰 시계 오차(분~시간)는 허용 */
  var MAX_FUTURE = 24 * 3600 * 1000;

  function cryptoObj() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
    if (typeof self !== 'undefined' && self.crypto) return self.crypto;
    return null;
  }
  function subtle() { var c = cryptoObj(); return c && c.subtle ? c.subtle : null; }
  function cryptoAvailable() { return !!subtle(); }

  // ───────────────────────── 방 코드 ─────────────────────────
  function randomFrom(alpha, len) {
    var c = cryptoObj(), out = '';
    if (c && c.getRandomValues) {
      var arr = new Uint8Array(len); c.getRandomValues(arr);
      for (var i = 0; i < len; i++) out += alpha[arr[i] % alpha.length];
    } else {
      for (var k = 0; k < len; k++) out += alpha[Math.floor(Math.random() * alpha.length)];
    }
    return out;
  }
  function randomCode() { return randomFrom(ALPHABET, CODE_LEN); } // 32 % 256 == 0 → 균등
  function randomId(len) { return randomFrom('abcdefghijklmnopqrstuvwxyz0123456789', len || 8); }
  function normalizeCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I');
  }
  function isValidCode(s) {
    if (!s || s.length !== CODE_LEN) return false;
    for (var i = 0; i < s.length; i++) if (ALPHABET.indexOf(s[i]) < 0) return false;
    return true;
  }
  function formatCode(s) { s = String(s || ''); return s.length === CODE_LEN ? s.slice(0, 4) + '-' + s.slice(4) : s; }

  // ───────────────────────── 하이브리드 논리 시계 ─────────────────────────
  function createClock(nowFn) {
    nowFn = nowFn || function () { return Date.now(); };
    var last = 0;
    return {
      now: function () { var t = nowFn(); if (t <= last) t = last + 1; last = t; return t; },
      observe: function (ts) { if (typeof ts === 'number' && isFinite(ts) && ts > last && ts <= nowFn() + MAX_FUTURE) last = ts; },
      peek: function () { return last; }
    };
  }
  /** 라운드에 저장된 rev 중 최대 ts (재시작 후 시계 seed용) */
  function maxRevTs(round) {
    var m = 0, rev = (round && round.rev) || {};
    Object.keys(rev).forEach(function (k) { if (rev[k] && rev[k].ts > m) m = rev[k].ts; });
    return m;
  }

  // ───────────────────────── 값 검증 ─────────────────────────
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi) { v = Math.round(Number(v)); if (!isFinite(v)) return null; return Math.min(hi, Math.max(lo, v)); }
  function cleanStr(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max); }
  /** 플레이어 id는 객체 키로 쓰이므로 Object.prototype의 멤버 이름(__proto__, constructor, isPrototypeOf …)과 겹치면 안 됨 */
  function isReservedPid(id) { id = String(id); return id === 'prototype' || id in Object.prototype; }
  function cleanPid(v) { var s = String(v == null ? '' : v).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24); return isReservedPid(s) ? '' : s; }
  function playerOf(round, pid) {
    for (var i = 0; i < round.players.length; i++) if (round.players[i].id === pid) return round.players[i];
    return null;
  }
  function validGameValue(type, v) {
    switch (type) {
      case 'bool': return typeof v === 'boolean' ? v : (v === 1 || v === 'true' ? true : v === 0 || v === 'false' ? false : undefined);
      case 'money': { var m = clampInt(v, 0, 100000000); return m === null ? undefined : m; }
      case 'mode': return v === 'individual' || v === 'team' ? v : undefined;
      case 'count': return v === 1 || v === 2 ? v : undefined;
    }
    return undefined;
  }

  // ───────────────────────── 키 투영 ─────────────────────────
  function ensureScores(round) {
    round.scores = round.scores || {};
    if (Array.isArray(round.players)) round.players = round.players.filter(function (p) { return p && !isReservedPid(p.id); });
    (round.players || []).forEach(function (p) {
      if (!Array.isArray(round.scores[p.id]) || round.scores[p.id].length !== round.holes) {
        var old = round.scores[p.id] || [];
        var arr = new Array(round.holes).fill(null);
        for (var i = 0; i < Math.min(old.length, round.holes); i++) arr[i] = old[i];
        round.scores[p.id] = arr;
      }
    });
  }

  function metaOf(round) {
    return {
      id: round.id, holes: round.holes, date: round.date, createdAt: round.createdAt,
      host: round.share ? round.share.host || null : null,
      playerIds: (round.players || []).map(function (p) { return p.id; })
    };
  }

  function getKey(round, key) {
    var p = key.split(':');
    switch (p[0]) {
      case 'meta': return metaOf(round);
      case 'name': return round.name == null ? '' : round.name;
      case 'course': return round.course == null ? '' : String(round.course);
      case 'start': return round.startBack === true ? 'in' : round.startBack === false ? 'out' : '';
      case 'hi': {
        var hi = round.holeInfo && round.holeInfo[+p[1]], hv = hi ? hi[p[2]] : null, gb = hazBit(p[2]);
        if (gb) return hazMask(hi) & gb ? 1 : null;
        if (p[2] === 'dist') return typeof hv === 'number' && isFinite(hv) && hv > 0 ? hv : null; // 정수화는 setKey에서
        return typeof hv === 'string' && hv ? hv : null;
      }
      case 'status': return round.status || 'live';
      case 'pl': { var pl = playerOf(round, p[1]); if (!pl) return undefined; return p[2] === 'hcp' ? (Number(pl.hcp) || 0) : p[2] === 'team' ? (pl.team || '') : (pl.name || ''); }
      case 'gm': { var g = round.games && round.games[p[1]]; return g ? g[p[2]] : undefined; }
      case 'par': return round.pars[+p[1]];
      case 'si': return round.strokeIndex[+p[1]];
      case 'score': { var s = round.scores[p[1]]; var v = s ? s[+p[2]] : null; return isInt(v) ? v : null; }
      case 'extra': { var e = round.extras && round.extras[+p[1]]; return e && e[p[2]] ? e[p[2]] : null; }
      case 'st': { var ss = round.stats && round.stats[p[1]] && round.stats[p[1]][+p[2]]; var sv = ss ? ss[p[3]] : null; return typeof sv === 'number' && isFinite(sv) ? sv : null; }
    }
    return undefined;
  }

  /** 값 검증 후 적용. 적용되면 true */
  function setKey(round, key, v) {
    var p = key.split(':');
    var h;
    switch (p[0]) {
      case 'meta': return false; // 불변
      case 'name': round.name = cleanStr(v, 60); return true;
      case 'course': round.course = cleanStr(v, COURSE_MAX); return true;
      case 'start':
        if (v === 'in') round.startBack = true; else if (v === 'out') round.startBack = false;
        else if (v === '' || v === null || v === undefined) delete round.startBack; else return false;
        return true;
      case 'hi': {
        h = +p[1];
        var zb = hazBit(p[2]), hf = zb ? 'haz' : p[2];
        if (!(h >= 0 && h < round.holes) || (!zb && HOLE_FIELDS.indexOf(hf) < 0)) return false;
        var iv = null;
        if (zb) { // 위험 요소 한 비트만 켜거나 끈다 (나머지 비트는 그대로)
          var on = v === 1 || v === true;
          if (!on && !(v === null || v === undefined || v === '' || v === 0 || v === false)) return false;
          var cm = hazMask(round.holeInfo && round.holeInfo[h]);
          iv = (on ? cm | zb : cm & ~zb) || null;
        } else if (!(v === null || v === undefined || v === '')) {
          if (hf === 'dist') { iv = clampInt(v, 0, 999); if (iv === null) return false; }
          else if (hf === 'shape') { if (v !== 'S' && v !== 'L' && v !== 'R') return false; iv = v; }
          else iv = cleanStr(String(v).replace(/[\r\n\t]+/g, ' '), MEMO_MAX).trim();
          if (iv === 0 || iv === '') iv = null; // 0과 빈 문자열은 '정보 없음'과 같은 값으로 저장
        }
        round.holeInfo = round.holeInfo || {};
        var info = round.holeInfo[h] || {};
        if (iv === null) delete info[hf]; else info[hf] = iv;
        if (Object.keys(info).length) round.holeInfo[h] = info; else delete round.holeInfo[h];
        return true;
      }
      case 'status': if (v === 'live' || v === 'finished' || v === 'closed') { round.status = v; return true; } return false;
      case 'pl': {
        var pl = playerOf(round, p[1]); if (!pl) return false;
        if (p[2] === 'name') { pl.name = cleanStr(v, 20); return true; }
        if (p[2] === 'hcp') { var hc = clampInt(v, 0, 54); if (hc === null) return false; pl.hcp = hc; return true; }
        if (p[2] === 'team') { if (v === '' || v === null || TEAMS.indexOf(v) >= 0) { pl.team = v || ''; return true; } return false; }
        return false;
      }
      case 'gm': {
        var schema = GAME_SCHEMA[p[1]]; if (!schema || !schema[p[2]]) return false;
        var gv = validGameValue(schema[p[2]], v); if (gv === undefined) return false;
        round.games = round.games || {}; round.games[p[1]] = round.games[p[1]] || {};
        round.games[p[1]][p[2]] = gv; return true;
      }
      case 'par': { h = +p[1]; var pv = clampInt(v, 3, 6); if (!(h >= 0 && h < round.holes) || pv === null) return false; round.pars[h] = pv; return true; }
      case 'si': { h = +p[1]; var sv = clampInt(v, 1, round.holes); if (!(h >= 0 && h < round.holes) || sv === null) return false; round.strokeIndex[h] = sv; return true; }
      case 'score': {
        h = +p[2]; if (!(h >= 0 && h < round.holes) || !playerOf(round, p[1])) return false;
        var sc = v === null || v === undefined ? null : clampInt(v, 1, 15);
        if (sc === undefined) return false;
        if (!round.scores[p[1]]) round.scores[p[1]] = new Array(round.holes).fill(null);
        round.scores[p[1]][h] = sc; return true;
      }
      case 'extra': {
        h = +p[1]; if (!(h >= 0 && h < round.holes) || EXTRA_FIELDS.indexOf(p[2]) < 0) return false;
        var pid = v === null || v === undefined || v === '' ? null : cleanPid(v);
        if (pid && !playerOf(round, pid)) return false;
        round.extras = round.extras || {};
        var cur = round.extras[h] || {};
        cur[p[2]] = pid;
        if (!cur.nearest && !cur.longest && !cur.eraser) delete round.extras[h]; else round.extras[h] = cur;
        return true;
      }
      case 'st': {
        h = +p[2]; var sf = STAT_FIELDS[p[3]];
        if (!sf || !STAT_FIELDS.hasOwnProperty(p[3]) || !(h >= 0 && h < round.holes) || !playerOf(round, p[1])) return false;
        var nv = null;
        if (!(v === null || v === undefined)) {
          nv = clampInt(v, 0, sf.max);
          if (nv === null) return false;
          if (nv < sf.min) nv = null; // 횟수 0은 '기록 없음'과 같은 값으로 저장 (복제본 간 표현 통일)
        }
        round.stats = round.stats || {};
        var ps = round.stats[p[1]] || {}, hs = ps[h] || {};
        if (nv === null) delete hs[p[3]]; else hs[p[3]] = nv;
        if (Object.keys(hs).length) ps[h] = hs; else delete ps[h];
        if (Object.keys(ps).length) round.stats[p[1]] = ps; else delete round.stats[p[1]];
        return true;
      }
    }
    return false;
  }

  /** 라운드에 존재하는 모든 키 (값이 있거나 rev가 있는 것) */
  function allKeys(round) {
    var rev = round.rev || {};
    var keys = ['meta', 'name', 'status', 'course'];
    if (round.startBack === true || round.startBack === false || rev.start) keys.push('start'); // 고른 적이 있을 때만 (rev가 남아 있으면 '자동'으로 되돌린 것도 전달)
    var h;
    (round.players || []).forEach(function (p) { keys.push('pl:' + p.id + ':name', 'pl:' + p.id + ':hcp', 'pl:' + p.id + ':team'); });
    Object.keys(GAME_SCHEMA).forEach(function (g) {
      Object.keys(GAME_SCHEMA[g]).forEach(function (f) { if (round.games && round.games[g] && round.games[g][f] !== undefined) keys.push('gm:' + g + ':' + f); });
    });
    for (h = 0; h < round.holes; h++) keys.push('par:' + h, 'si:' + h);
    (round.players || []).forEach(function (p) {
      var s = round.scores && round.scores[p.id];
      for (var i = 0; i < round.holes; i++) {
        var k = 'score:' + p.id + ':' + i;
        if ((s && isInt(s[i])) || rev[k]) keys.push(k);
      }
    });
    for (h = 0; h < round.holes; h++) {
      var e = round.extras && round.extras[h];
      EXTRA_FIELDS.forEach(function (f) {
        var k = 'extra:' + h + ':' + f;
        if ((e && e[f]) || rev[k]) keys.push(k);
      });
    }
    for (h = 0; h < round.holes; h++) {
      var info = round.holeInfo && round.holeInfo[h];
      for (var m = 0; m < HOLE_FIELDS.length; m++) {
        var hk = 'hi:' + h + ':' + HOLE_FIELDS[m];
        if ((info && info[HOLE_FIELDS[m]] != null) || rev[hk]) keys.push(hk);
      }
      var hm = hazMask(info);
      for (var z = 0; z < HAZ_BITS.length; z++) {
        var zk = 'hi:' + h + ':z' + HAZ_BITS[z];
        if ((hm & HAZ_BITS[z]) || rev[zk]) keys.push(zk); // rev가 남아 있으면 지운 것도 전달(tombstone)
      }
    }
    (round.players || []).forEach(function (p) {
      var ps = round.stats && round.stats[p.id];
      for (var i = 0; i < round.holes; i++) {
        var hs = ps && ps[i];
        for (var j = 0; j < STAT_NAMES.length; j++) {
          var k = 'st:' + p.id + ':' + i + ':' + STAT_NAMES[j];
          if ((hs && typeof hs[STAT_NAMES[j]] === 'number') || rev[k]) keys.push(k);
        }
      }
    });
    return keys;
  }

  /** 모든 키를 {v, ts, by} 형태로 내보내기 */
  function exportKeys(round, onlyKeys) {
    var rev = round.rev || {};
    var out = {};
    (onlyKeys || allKeys(round)).forEach(function (k) {
      var v = getKey(round, k);
      if (v === undefined) return;
      // meta는 불변이므로 rev와 무관하게 생성 시각으로 고정 (복제본 간 동일하게 내보내기 위함)
      var r = k === 'meta' ? { ts: round.createdAt || 1, by: '' } : (rev[k] || { ts: 0, by: '' });
      out[k] = { v: v, ts: r.ts, by: r.by };
    });
    return out;
  }

  /** 공유용 투영: key → JSON 문자열 (meta 제외). 변경 감지용 */
  function project(round) {
    var out = {};
    allKeys(round).forEach(function (k) {
      if (k === 'meta') return;
      var v = getKey(round, k);
      if (v !== undefined) out[k] = JSON.stringify(v);
    });
    return out;
  }

  /** baseline 투영과 비교해 바뀐 키에 rev를 찍는다. 반환 {changed, projection} */
  function diffAndStamp(round, baseline, clock, by) {
    var cur = project(round), changed = [];
    Object.keys(cur).forEach(function (k) { if (!baseline || baseline[k] !== cur[k]) changed.push(k); });
    if (baseline) Object.keys(baseline).forEach(function (k) { if (!(k in cur)) changed.push(k); });
    if (changed.length) {
      // 로컬 값도 원격 수신(setKey)과 같은 규칙으로 정규화 → 복제본이 같은 rev 아래 같은 값을 갖도록
      changed.forEach(function (k) { if (k !== 'meta') { var v = getKey(round, k); if (v !== undefined) setKey(round, k, v); } });
      cur = project(round);
      stamp(round, changed, clock, by);
    }
    return { changed: changed, projection: cur };
  }

  /** rev가 없는 키에 기본 타임스탬프 부여 (공유 시작 시 / 라운드 생성 시) */
  function stampAll(round, ts, by) {
    round.rev = round.rev || {};
    allKeys(round).forEach(function (k) {
      if (k !== 'meta' && !round.rev[k]) round.rev[k] = { ts: ts, by: by };
    });
  }

  /** 로컬 변경 표시: rev 갱신 */
  function stamp(round, keys, clock, by) {
    round.rev = round.rev || {};
    var ts = clock.now();
    keys.forEach(function (k) { if (k !== 'meta') round.rev[k] = { ts: ts, by: by }; });
    return ts;
  }

  function newer(inc, loc) {
    if (inc.ts !== loc.ts) return inc.ts > loc.ts;
    return String(inc.by || '') > String(loc.by || '');
  }
  // 홀 번호는 앞자리 0 없는 표기만 허용: 'score:a:07'이 'score:a:7'과 같은 칸을 다른 rev 키로 덮어쓰지 못하게 함
  var KEY_RE = /^(meta|name|status|course|start|hi:(0|[1-9]\d?):(dist|shape|memo|z(1|2|4|8|16|32|64|128))|pl:[A-Za-z0-9_-]{1,24}:(name|hcp|team)|gm:[a-z]+:[a-z]+|par:(0|[1-9]\d?)|si:(0|[1-9]\d?)|score:[A-Za-z0-9_-]{1,24}:(0|[1-9]\d?)|extra:(0|[1-9]\d?):(nearest|longest|eraser)|st:[A-Za-z0-9_-]{1,24}:(0|[1-9]\d?):(sh|ob|hz|bk|pt|fw))$/;

  /**
   * 들어온 키들을 LWW로 병합. 반환: {changed:[키], localNewer:bool, maxTs}
   * opts.force: 비교 없이 모두 적용 (새로 참여해 스냅샷을 채택할 때)
   */
  function merge(round, keys, opts) {
    opts = opts || {};
    round.rev = round.rev || {};
    var changed = [], localNewer = false, maxTs = 0, dropped = 0;
    var limit = (opts.now || Date.now)() + MAX_FUTURE;
    Object.keys(keys || {}).forEach(function (k) {
      var inc = keys[k];
      if (!inc || typeof inc !== 'object' || !KEY_RE.test(k)) return;
      if (typeof inc.ts === 'number' && isFinite(inc.ts) && inc.ts > maxTs) maxTs = inc.ts;
      if (k === 'meta') return;
      var loc = round.rev[k] || { ts: 0, by: '' };
      var incRev = { ts: typeof inc.ts === 'number' && isFinite(inc.ts) ? inc.ts : 0, by: cleanStr(inc.by, 32) };
      if (incRev.ts > limit) { dropped++; return; } // 터무니없는 미래 시각: 적용/저장하지 않음
      if (opts.force || newer(incRev, loc)) {
        if (setKey(round, k, inc.v)) {
          round.rev[k] = incRev;
          changed.push(k);
        }
      } else if (loc.ts !== incRev.ts || String(loc.by) !== String(incRev.by)) {
        localNewer = true;
      }
    });
    return { changed: changed, localNewer: localNewer, maxTs: maxTs, dropped: dropped };
  }

  /** 스냅샷에 없는, 로컬에서 변경된 키가 있는지 */
  function hasKeysMissingFrom(round, keys) {
    var rev = round.rev || {};
    var mine = allKeys(round);
    for (var i = 0; i < mine.length; i++) {
      var k = mine[i];
      if (k !== 'meta' && rev[k] && rev[k].ts > 0 && !(k in keys)) return true;
    }
    return false;
  }

  /** 스냅샷으로부터 새 라운드 생성 (참여자가 처음 들어올 때) */
  function roundFromSnapshot(keys, defaults) {
    var meta = keys && keys.meta && keys.meta.v;
    if (!meta || !(meta.holes === 9 || meta.holes === 18) || !Array.isArray(meta.playerIds)) return null;
    var ids = [];
    meta.playerIds.forEach(function (id) { id = cleanPid(id); if (id && ids.indexOf(id) < 0 && ids.length < 8) ids.push(id); });
    if (ids.length < 1) return null;
    var r = {
      id: cleanStr(meta.id, 40) || randomId(8), holes: meta.holes, date: cleanStr(meta.date, 10), createdAt: Number(meta.createdAt) || Date.now(),
      name: '', pars: defaults.pars(meta.holes), strokeIndex: defaults.strokeIndex(meta.holes),
      players: ids.map(function (id) { return { id: id, name: '', hcp: 0, team: '' }; }),
      scores: {}, extras: {}, games: defaults.games(), status: 'live', rev: {}, currentHole: 0,
      share: { host: cleanPid(meta.host) || null }
    };
    ensureScores(r);
    merge(r, keys, { force: true });
    return r;
  }

  // ───────────────────────── 인코딩 / 암호화 ─────────────────────────
  function utf8(s) { return new TextEncoder().encode(s); }
  function unutf8(b) { return new TextDecoder().decode(b); }
  function toB64(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16); return s; }

  var roomCache = {};
  /** 코드 → {topic, key}. PBKDF2(150k)로 토픽 식별자와 AES 키를 함께 유도 (무차별 대입 비용 상승) */
  function deriveRoom(code) {
    var st = subtle();
    if (!st) return Promise.reject(new Error('crypto unavailable'));
    if (roomCache[code]) return roomCache[code];
    roomCache[code] = st.importKey('raw', utf8(code), 'PBKDF2', false, ['deriveBits']).then(function (k) {
      return st.deriveBits({ name: 'PBKDF2', salt: utf8('golfscore/v2'), iterations: 150000, hash: 'SHA-256' }, k, 384);
    }).then(function (bits) {
      var u8 = new Uint8Array(bits);
      return st.importKey('raw', u8.slice(16, 48), 'AES-GCM', false, ['encrypt', 'decrypt']).then(function (key) {
        return { topic: TOPIC_ROOT + hex(u8.slice(0, 16)), key: key };
      });
    });
    roomCache[code].catch(function () { delete roomCache[code]; });
    return roomCache[code];
  }
  function seal(key, obj) {
    if (!key) return Promise.reject(new Error('no key'));
    var json = JSON.stringify(obj);
    var iv = new Uint8Array(12); cryptoObj().getRandomValues(iv);
    return subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, utf8(json)).then(function (ct) {
      return 'E2.' + toB64(iv) + '.' + toB64(new Uint8Array(ct));
    });
  }
  function open(key, str) {
    // 모든 실패(잘못된 base64 포함)를 reject로 통일 — 동기 예외가 mqtt 수신 스트림을 멈추지 않도록
    return Promise.resolve().then(function () {
      str = String(str || '');
      if (str.indexOf('E2.') !== 0 || !key) throw new Error('unknown payload format');
      var parts = str.split('.');
      if (parts.length !== 3) throw new Error('bad payload');
      var iv = fromB64(parts[1]), ct = fromB64(parts[2]);
      if (iv.length !== 12) throw new Error('bad iv');
      return subtle().decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    }).then(function (pt) { return JSON.parse(unutf8(new Uint8Array(pt))); });
  }

  function parseBrokerUrl(u) {
    var m = /^(wss?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(String(u).trim());
    if (!m) return null;
    return { protocol: m[1], host: m[2], port: m[3] ? Number(m[3]) : (m[1] === 'wss' ? 443 : 80), path: m[4] || '/mqtt' };
  }

  // ───────────────────────── 세션 (전송 계층) ─────────────────────────
  /**
   * opts: { mqtt, code, broker(url), clientId(기기 id), tabId?, name, clock?, getRound,
   *         onApply(changedKeys, msg), onSnapshot(keys), onStatus(status, detail), onPeers(list),
   *         onReady(), onError(err), onConflict(meta), onSkew(ms) }
   * 상태: connecting | connected | offline | idle | error
   */
  function createSession(opts) {
    var mqtt = opts.mqtt, code = opts.code, clientId = opts.clientId;
    var tabId = opts.tabId || randomId(4);
    var broker = parseBrokerUrl(opts.broker || BROKERS[0]);
    var clock = opts.clock || createClock();
    var client = null, topic = null, cryptoKey = null, stopped = false, status = 'idle';
    var pending = {}, dirty = false, opTimer = null, snapTimer = null, presenceTimer = null, hydrateTimer = null, helloTimer = null;
    var peers = {}, displayName = opts.name || '';
    var hydrated = false, gotRetained = false, seededEarly = false, ready = false, lastSyncAt = 0, reconnectPeriod = 2000;
    var seenHello = {};
    function setReady() { if (!ready) { ready = true; if (opts.onReady) opts.onReady(); } }

    function setStatus(s, detail) { status = s; if (opts.onStatus) opts.onStatus(s, detail); }
    function peerList() {
      var now = Date.now(), out = [];
      Object.keys(peers).forEach(function (cid) {
        if (now - peers[cid].seen <= PRESENCE_TTL) out.push({ id: cid, name: peers[cid].name });
        else delete peers[cid];
      });
      return out;
    }
    function emitPeers() { if (opts.onPeers) opts.onPeers(peerList()); }
    function isConnected() { return !!(client && client.connected); }
    function currentRound() { var r = opts.getRound(); return r || null; }

    function rawPublish(sub, payload, pubOpts) {
      return new Promise(function (resolve) {
        if (!isConnected()) return resolve(false);
        client.publish(topic + sub, payload, pubOpts, function (err) {
          if (err && opts.onError) opts.onError(err);
          resolve(!err);
        });
      });
    }
    function publish(sub, obj, pubOpts) {
      if (!isConnected() || !topic) return Promise.resolve(false);
      return seal(cryptoKey, obj).then(function (payload) { return rawPublish(sub, payload, pubOpts); })
        .catch(function (e) { if (opts.onError) opts.onError(e); return false; });
    }

    function publishPresence() {
      if (!isConnected()) return;
      publish('/p/' + clientId, { name: displayName, ts: Date.now() }, { qos: 0, retain: true });
    }

    function publishSnapshot(extra) {
      var round = currentRound();
      if (!round || !isConnected()) return Promise.resolve(false);
      var msg = { t: 'snap', rid: round.id, from: clientId, keys: exportKeys(round) };
      if (extra) Object.keys(extra).forEach(function (k) { msg[k] = extra[k]; });
      var early = !gotRetained; // 브로커의 retained 스냅샷을 보기 전에 올리는 것인지
      return publish('/s', msg, { qos: 1, retain: true }).then(function (ok) {
        if (ok) { if (early) seededEarly = true; dirty = false; lastSyncAt = Date.now(); setReady(); }
        return ok;
      });
    }
    function scheduleSnapshot(delay) {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(function () {
        snapTimer = null;
        if (!hydrated || !isConnected()) { dirty = true; return; }
        publishSnapshot();
      }, delay == null ? SNAP_DEBOUNCE : delay);
    }
    function flushOps() {
      opTimer = null;
      var round = currentRound();
      var keys = Object.keys(pending);
      if (!round || !keys.length) return;
      if (!hydrated || !isConnected()) { dirty = true; return; } // 재접속 후 스냅샷으로 전달
      pending = {};
      publish('/s', { t: 'op', rid: round.id, from: clientId, keys: exportKeys(round, keys) }, { qos: 1, retain: false })
        .then(function (ok) { if (ok) lastSyncAt = Date.now(); });
    }

    /** 로컬에서 keys가 (이미 rev가 찍힌 채로) 변경되었음을 알림 → 전송 예약 */
    function markDirty(keys) {
      if (!keys || !keys.length) return;
      keys.forEach(function (k) { pending[k] = 1; });
      dirty = true;
      if (!opTimer) opTimer = setTimeout(flushOps, OP_DEBOUNCE);
      scheduleSnapshot();
    }
    /** rev를 찍고 전송 예약 (명시적 변경 경로용) */
    function touch(keys) {
      var round = currentRound();
      if (!round) return;
      stamp(round, keys, clock, clientId);
      markDirty(keys);
    }

    function onHydrated() {
      hydrated = true;
      var round = currentRound();
      if (round && (!gotRetained || dirty)) publishSnapshot(); // 브로커에 스냅샷이 없거나 로컬 변경이 쌓였으면 재시드
      if (Object.keys(pending).length) flushOps();
    }

    function sendHello() {
      if (!isConnected()) return;
      var n = randomId(6);
      publish('/q', { t: 'hello', from: clientId, n: n }, { qos: 1, retain: false });
    }

    function onMessage(t, payload, packet) {
      // 수신 핸들러의 예외가 mqtt.js 패킷 처리 스트림을 멈추지 않도록 격리
      try { handleMessage(t, payload, packet); } catch (e) { if (opts.onError) opts.onError(e); }
    }
    function handleMessage(t, payload, packet) {
      if (!topic || t.indexOf(topic) !== 0) return;
      var suffix = t.slice(topic.length);
      var text = typeof payload === 'string' ? payload : (payload && payload.length ? unutf8(payload) : '');
      var retained = !!(packet && packet.retain);
      if (suffix.indexOf('/p/') === 0) {
        var cid = suffix.slice(3);
        if (cid === clientId) return;
        if (!text) { delete peers[cid]; emitPeers(); return; }
        open(cryptoKey, text).then(function (m) {
          peers[cid] = { name: cleanStr(m && m.name, 20), seen: Date.now() };
          emitPeers();
        }).catch(function () { /* 다른 방/버전의 메시지 무시 */ });
        return;
      }
      if (suffix === '/q') {
        if (!text) return;
        open(cryptoKey, text).then(function (m) {
          if (!m || m.t !== 'hello' || m.from === clientId) return;
          var round = currentRound(); if (!round) return;
          var n = cleanStr(m.n, 12);
          // 다른 기기가 먼저 응답하면 생략. 무작위 지연으로 응답 폭주 방지
          var delay = HELLO_REPLY_MIN + Math.floor(Math.random() * HELLO_REPLY_SPREAD);
          setTimeout(function () {
            if (seenHello[n] || !isConnected()) return;
            seenHello[n] = 1;
            publishSnapshot({ re: n });
          }, delay);
        }).catch(function () { /* ignore */ });
        return;
      }
      if (suffix !== '/s') return;
      if (!text) { // 호스트가 서버에서 삭제함 (빈 retained)
        if (retained) { gotRetained = false; }
        return;
      }
      open(cryptoKey, text).then(function (msg) {
        if (!msg || !msg.keys || typeof msg.keys !== 'object') return;
        if (msg.re) seenHello[cleanStr(msg.re, 12)] = 1;
        var round = currentRound();
        if (msg.from === clientId && round) {
          // 내 메시지의 에코: 라운드가 있으면 무시 (내 retained 스냅샷이 서버에 있다는 사실만 기록)
          if (msg.t === 'snap' && retained) { gotRetained = true; setReady(); }
          return;
        }
        // 라운드가 없으면(삭제 후 재참여 등) 내 예전 스냅샷도 다른 기기의 것과 똑같이 채택
        var maxTs = 0, limit = Date.now() + MAX_FUTURE;
        Object.keys(msg.keys).forEach(function (k) { var e = msg.keys[k]; if (e && typeof e.ts === 'number' && isFinite(e.ts)) { if (e.ts <= limit) clock.observe(e.ts); if (e.ts > maxTs) maxTs = e.ts; } });
        if (maxTs - Date.now() > SKEW_WARN && opts.onSkew) opts.onSkew(maxTs - Date.now());
        var meta = msg.keys.meta && msg.keys.meta.v;
        var rid = msg.rid || (meta && meta.id);
        if (!round) {
          if (msg.t === 'snap' && meta) { if (retained) gotRetained = true; hydrated = true; if (opts.onSnapshot) opts.onSnapshot(msg.keys); if (retained) setReady(); }
          return;
        }
        if (rid && round.id && rid !== round.id) { if (opts.onConflict) opts.onConflict(meta || { id: rid }); return; }
        if (meta && meta.holes && meta.holes !== round.holes) { if (opts.onConflict) opts.onConflict(meta); return; }
        var res = merge(round, msg.keys);
        lastSyncAt = Date.now();
        if (msg.t === 'snap') {
          if (retained) {
            gotRetained = true;
            if (!hydrated) { clearTimeout(hydrateTimer); hydrated = true; }
            // 이 retained 스냅샷이 오기 전에 내 (병합 전) 스냅샷을 먼저 올렸다면 서버에 옛 상태가 남은 것 → 병합본 재발행
            else if (seededEarly && res.changed.length) scheduleSnapshot(500 + Math.floor(Math.random() * 1000));
            seededEarly = false;
            setReady();
          }
          // 내 쪽이 더 새롭거나 스냅샷에 없는 키가 있으면 병합본을 다시 올림 (지터로 폭주 방지)
          if (res.localNewer || hasKeysMissingFrom(round, msg.keys)) scheduleSnapshot(1000 + Math.floor(Math.random() * 2000));
          if (hydrated && Object.keys(pending).length) flushOps();
        }
        if (res.changed.length && opts.onApply) opts.onApply(res.changed, msg);
      }).catch(function () { /* 복호화 실패: 다른 코드/버전 → 무시 */ });
    }

    function start() {
      if (stopped) return Promise.resolve();
      if (!broker) { setStatus('error', 'bad broker'); return Promise.resolve(); }
      setStatus('connecting', broker.host);
      return deriveRoom(code).then(function (room) {
        topic = room.topic; cryptoKey = room.key;
        if (stopped) return;
        var connOpts = {
          clientId: 'gs' + String(clientId).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) + tabId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6),
          clean: true, keepalive: 30, reschedulePings: true, reconnectPeriod: reconnectPeriod, connectTimeout: 8000, protocolVersion: 4,
          resubscribe: true, queueQoSZero: false,
          protocol: broker.protocol, host: broker.host, port: broker.port, path: broker.path,
          will: { topic: topic + '/p/' + clientId, payload: '', qos: 0, retain: true }
        };
        var c = client = mqtt.connect(connOpts);
        // wake()로 클라이언트를 교체한 뒤 옛 클라이언트의 늦은 이벤트가 세션 상태를 건드리지 않도록 동일성 검사
        c.on('connect', function () {
          if (c !== client) return;
          reconnectPeriod = 2000; c.options.reconnectPeriod = reconnectPeriod;
          hydrated = false; gotRetained = false; seededEarly = false;
          setStatus('connected', broker.host);
          c.subscribe(topic + '/#', { qos: 1 }, function (err) {
            if (c !== client) return;
            if (err) { if (opts.onError) opts.onError(err); }
            else if (!currentRound()) sendHello(); // 참여자: 스냅샷 요청
            // SUBACK 이후부터 유예 시간을 재서 retained 스냅샷이 도착할 시간을 충분히 줌
            clearTimeout(hydrateTimer);
            hydrateTimer = setTimeout(function () { if (!hydrated) onHydrated(); else if (currentRound() && (dirty || !gotRetained)) publishSnapshot(); }, HYDRATE_GRACE);
          });
          publishPresence();
          clearInterval(presenceTimer);
          presenceTimer = setInterval(publishPresence, PRESENCE_INTERVAL);
        });
        c.on('reconnect', function () { if (c === client) setStatus('connecting', broker.host); });
        c.on('offline', function () { if (c === client && !stopped) setStatus('offline'); });
        c.on('close', function () {
          if (c !== client) return;
          clearInterval(presenceTimer); clearTimeout(hydrateTimer); hydrated = false;
          if (stopped) return;
          // 수동 백오프 (지터 포함, 최대 15초)
          reconnectPeriod = Math.min(15000, Math.round(reconnectPeriod * 1.6) + Math.floor(Math.random() * 700));
          c.options.reconnectPeriod = reconnectPeriod;
          setStatus('offline');
        });
        c.on('error', function (e) { if (c === client && opts.onError) opts.onError(e); });
        c.on('message', function (t, p, pk) { if (c === client) onMessage(t, p, pk); });
      }).catch(function (e) { setStatus('error', e && e.message); if (opts.onError) opts.onError(e); });
    }

    /** 포그라운드 복귀/온라인 복귀 시: 죽은 소켓을 즉시 재연결 */
    function wake() {
      if (!client || stopped) return;
      reconnectPeriod = 2000;
      if (client.connected || (client.disconnecting && !client.disconnected)) {
        // 조용히 죽은 소켓은 connected=true로 남는다. 이때 mqtt.js의 reconnect()→end(false)는 PUBACK을 못 받은
        // QoS1 발행이 있으면 'outgoingEmpty'를 영원히 기다려 재연결이 되지 않으므로 클라이언트 자체를 교체한다.
        // (보내지 못한 변경은 dirty/pending에 남아 새 연결의 hydration 뒤 스냅샷으로 다시 전송됨)
        forceClose(client); client = null;
        clearInterval(presenceTimer); clearTimeout(hydrateTimer); hydrated = false; gotRetained = false;
        start();
        return;
      }
      try { client.options.reconnectPeriod = reconnectPeriod; client.reconnect(); setStatus('connecting', broker.host); } catch (e) { /* ignore */ }
    }
    /** 가능하면 정상 종료(DISCONNECT), 미확인 QoS1 발행 때문에 끝나지 않으면 잠시 후 강제 종료 */
    function forceClose(c) {
      var forced = false;
      var t = setTimeout(function () { forced = true; try { c.end(true); } catch (e) { /* ignore */ } }, 1500);
      try { c.end(false, {}, function () { if (!forced) clearTimeout(t); }); } catch (e2) { clearTimeout(t); try { c.end(true); } catch (e3) { /* ignore */ } }
    }

    /** 서버의 retained 스냅샷/내 presence 삭제 (호스트가 공유 종료 시) */
    function clearRetained() {
      if (!isConnected()) return Promise.resolve(false);
      return rawPublish('/s', '', { qos: 1, retain: true }).then(function (ok1) {
        return rawPublish('/p/' + clientId, '', { qos: 0, retain: true }).then(function (ok2) { return ok1 && ok2; });
      });
    }

    function stop() {
      stopped = true;
      clearTimeout(opTimer); clearTimeout(snapTimer); clearInterval(presenceTimer); clearTimeout(hydrateTimer); clearTimeout(helloTimer);
      if (client) {
        var c = client; client = null;
        try { if (c.connected) c.publish(topic + '/p/' + clientId, '', { qos: 0, retain: true }); } catch (e) { /* ignore */ }
        forceClose(c);
      }
      setStatus('idle');
    }

    return {
      start: start, stop: stop, wake: wake, touch: touch, markDirty: markDirty,
      publishSnapshot: function () { return publishSnapshot(); },
      clearRetained: clearRetained,
      flush: function () { clearTimeout(opTimer); opTimer = null; pending = {}; clearTimeout(snapTimer); snapTimer = null; return publishSnapshot(); },
      requestSnapshot: sendHello,
      setName: function (n) { displayName = n || ''; publishPresence(); },
      peers: peerList,
      status: function () { return status; },
      connected: isConnected,
      hydrated: function () { return hydrated; },
      ready: function () { return ready; },
      lastSyncAt: function () { return lastSyncAt; },
      broker: function () { return broker; },
      clock: clock
    };
  }

  return {
    BUILD: 12, // 앱 버전(sw.js의 캐시 번호와 같다). app.js가 파일들의 짝이 맞는지 확인하는 데 쓴다
    ALPHABET: ALPHABET, CODE_LEN: CODE_LEN, BROKERS: BROKERS, TOPIC_ROOT: TOPIC_ROOT, GAME_SCHEMA: GAME_SCHEMA, STAT_FIELDS: STAT_FIELDS, HOLE_FIELDS: HOLE_FIELDS, HAZ_BITS: HAZ_BITS, MEMO_MAX: MEMO_MAX, COURSE_MAX: COURSE_MAX, TEAMS: TEAMS, MAX_FUTURE: MAX_FUTURE,
    cryptoAvailable: cryptoAvailable,
    randomCode: randomCode, normalizeCode: normalizeCode, isValidCode: isValidCode, formatCode: formatCode, randomId: randomId,
    createClock: createClock, maxRevTs: maxRevTs, cleanPid: cleanPid, isReservedPid: isReservedPid,
    getKey: getKey, setKey: setKey, allKeys: allKeys, exportKeys: exportKeys, project: project, diffAndStamp: diffAndStamp,
    stampAll: stampAll, stamp: stamp, merge: merge, hasKeysMissingFrom: hasKeysMissingFrom, roundFromSnapshot: roundFromSnapshot, ensureScores: ensureScores,
    deriveRoom: deriveRoom, seal: seal, open: open, parseBrokerUrl: parseBrokerUrl,
    createSession: createSession
  };
});
