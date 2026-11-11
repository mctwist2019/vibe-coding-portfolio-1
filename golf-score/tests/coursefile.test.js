const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../sync.js');
const courses = require('../courses.js');
const maps = require('../coursemaps.js');
const { build } = require('../tools/build-course-index.js');

const creek = courses.find((c) => maps[c.name]);
const bear = courses.find((c) => !maps[c.name]);
const copy = (o) => JSON.parse(JSON.stringify(o));
const creekFile = () => copy(S.makeCourseFile(creek, maps[creek.name], { updated: '2026-11-11', note: '설명' }));
const why = (o) => { const r = S.readCourseFile(o); return r.ok ? 'ok' : r.why; };

test('course file: the built-in courses survive a round trip unchanged', () => {
  const r = S.readCourseFile(creekFile());
  assert.equal(r.ok, true);
  assert.deepEqual(r.course.pars, creek.pars);
  assert.deepEqual(r.course.strokeIndex, creek.strokeIndex);
  assert.deepEqual(r.course.holeInfo, creek.holeInfo);
  assert.deepEqual(r.course.map, maps[creek.name], 'the hole maps come back exactly as drawn');
  assert.deepEqual([r.course.name, r.course.holes, r.course.note, r.course.updated], [creek.name, 18, '설명', '2026-11-11']);
  // 약도가 없는 코스
  const b = S.readCourseFile(copy(S.makeCourseFile(bear)));
  assert.equal(b.ok, true); assert.equal(b.course.map, null); assert.deepEqual(b.course.holeInfo, bear.holeInfo);
  assert.deepEqual([b.course.note, b.course.updated], ['', '']);
  // 돌려받은 것은 새 객체다 (원본을 고쳐도 영향을 받지 않는다)
  const f = creekFile(), out = S.readCourseFile(f).course;
  f.pars[0] = 6; f.map[0].o[0][0] = 499; f.holeInfo[0].memo = 'x';
  assert.equal(out.pars[0], creek.pars[0]); assert.equal(out.map[0].o[0][0], maps[creek.name][0].o[0][0]); assert.equal(out.holeInfo[0].memo, creek.holeInfo[0].memo);
});

test('course file: anything that is not a well-formed course is refused', () => {
  const f = creekFile;
  assert.equal(why(null), 'format'); assert.equal(why([]), 'format'); assert.equal(why('x'), 'format'); assert.equal(why({}), 'format');
  assert.equal(why(Object.assign(f(), { format: 'other' })), 'format');
  assert.equal(why(Object.assign(f(), { v: 0 })), 'format'); assert.equal(why(Object.assign(f(), { v: '1' })), 'format'); assert.equal(why(Object.assign(f(), { v: 1.5 })), 'format');
  assert.equal(why(Object.assign(f(), { v: 2 })), 'newer', 'a file from a newer app is not half-read');
  assert.equal(why(Object.assign(f(), { name: '' })), 'name'); assert.equal(why(Object.assign(f(), { name: '   ' })), 'name'); assert.equal(why(Object.assign(f(), { name: 7 })), 'name');
  assert.equal(why(Object.assign(f(), { holes: 12 })), 'holes'); assert.equal(why(Object.assign(f(), { holes: '18' })), 'holes');
  assert.equal(why(Object.assign(f(), { pars: creek.pars.slice(0, 17) })), 'pars');
  assert.equal(why(Object.assign(f(), { pars: creek.pars.map((p, i) => (i ? p : 7)) })), 'pars');
  assert.equal(why(Object.assign(f(), { pars: creek.pars.map((p, i) => (i ? p : '4')) })), 'pars');
  assert.equal(why(Object.assign(f(), { strokeIndex: creek.strokeIndex.map((p, i) => (i ? p : 19)) })), 'si');
  assert.equal(why(Object.assign(f(), { strokeIndex: undefined })), 'si');
  assert.equal(why(Object.assign(f(), { holeInfo: [] })), 'info');
  const info = (patch) => { const x = f(); Object.assign(x.holeInfo[0], patch); return why(x); };
  assert.equal(info({ dist: 0 }), 'info'); assert.equal(info({ dist: 1000 }), 'info'); assert.equal(info({ dist: '362' }), 'info'); assert.equal(info({ dist: 1.5 }), 'info');
  assert.equal(info({ shape: 'X' }), 'info'); assert.equal(info({ haz: 256 }), 'info'); assert.equal(info({ haz: -1 }), 'info'); assert.equal(info({ memo: 5 }), 'info');
  assert.equal(info({ dist: 400, shape: 'R', haz: 3, memo: '새 키워드' }), 'ok');
});

test('course file: text is cleaned like text typed into a round; unknown fields are dropped', () => {
  const f = creekFile();
  f.name = '  새\u0000 골프장\n ' + 'x'.repeat(80);
  f.holeInfo[0].memo = ' 좌측 OB\n\t우측 벙커 ' + 'y'.repeat(400);
  f.holeInfo[1] = { memo: '   ' };
  f.holeInfo[2] = { haz: 0 };
  f.holeInfo[99] = { dist: 100 };
  f.extra = '<script>alert(1)</script>'; f.holeInfo[3].extra = 'x';
  f.note = '<b>설명</b>\n둘째 줄'; f.updated = '2026/11/11';
  const r = S.readCourseFile(f);
  assert.equal(r.ok, true);
  assert.equal(r.course.name.length <= S.COURSE_MAX && r.course.name.indexOf('\u0000') < 0 && r.course.name.indexOf('\n') < 0, true);
  assert.equal(r.course.name.indexOf('새 골프장'), 0);
  // 길이를 자른 뒤 앞뒤 공백을 떼므로(라운드에 넣을 때와 같다) 한도보다 한 글자 짧을 수 있다
  assert.ok(r.course.holeInfo[0].memo.length <= S.MEMO_MAX && r.course.holeInfo[0].memo.length >= S.MEMO_MAX - 1); assert.equal(r.course.holeInfo[0].memo.indexOf('좌측 OB 우측 벙커'), 0);
  assert.equal(r.course.holeInfo[1], undefined, 'an empty memo leaves no entry');
  assert.equal(r.course.holeInfo[2], undefined, 'haz 0 leaves no entry');
  assert.equal(r.course.holeInfo[99], undefined, 'holes outside the course are ignored');
  assert.deepEqual(Object.keys(r.course).sort(), ['holeInfo', 'holes', 'map', 'name', 'note', 'pars', 'strokeIndex', 'updated']);
  assert.deepEqual(Object.keys(r.course.holeInfo[3]).sort(), Object.keys(creek.holeInfo[3]).sort());
  assert.equal(r.course.note, '<b>설명</b> 둘째 줄', 'kept as plain text (the app escapes it when shown)');
  assert.equal(r.course.updated, '', 'a date in another form is dropped');
});

test('course file: the map accepts numbers only, within the drawing area', () => {
  const m = (fn) => { const x = creekFile(); fn(x.map[0], x); return why(x); };
  assert.equal(m(() => {}), 'ok');
  // 화면에서 숫자가 SVG에 그대로 들어가는 자리마다: 글자를 넣으면 거부
  assert.equal(m((h) => { h.m[0][2] = '<img src=x onerror=alert(1)>'; }), 'map');
  assert.equal(m((h) => { h.cy[0][2] = '170"><script>'; }), 'map');
  assert.equal(m((h) => { h.t[0][3] = '397'; }), 'map');
  assert.equal(m((h) => { h.t[0][0] = '"/><script>'; }), 'map');
  assert.equal(m((h) => { h.t[0][0] = 'X'; }), 'map');
  assert.equal(m((h) => { h.cy[0][3] = 'X'; }), 'map');
  assert.equal(m((h) => { h.c[0][0] = '143'; }), 'map');
  assert.equal(m((h) => { h.o[0][0] = '1 1"/><script>'; }), 'map');
  assert.equal(m((h) => { h.ip[0] = ['1', 2]; }), 'map');
  assert.equal(m((h) => { h.h = '1170'; }), 'map'); assert.equal(m((h) => { h.s = null; }), 'map');
  assert.equal(m((h) => { h.e[0] = 'x'; }), 'map');
  // 숫자라도 그림 밖이거나 터무니없으면 거부
  assert.equal(m((h) => { h.o[0][0] = 9999; }), 'map'); assert.equal(m((h) => { h.o[0][1] = h.h + 50; }), 'map'); assert.equal(m((h) => { h.c[0][0] = NaN; }), 'map');
  assert.equal(m((h) => { h.h = 50; }), 'map'); assert.equal(m((h) => { h.h = 5000; }), 'map'); assert.equal(m((h) => { h.s = 0; }), 'map'); assert.equal(m((h) => { h.s = Infinity; }), 'map');
  assert.equal(m((h) => { h.o = []; }), 'map', 'an outline is required'); assert.equal(m((h) => { h.g = []; }), 'map', 'a green is required');
  assert.equal(m((h) => { h.o[0] = [1, 2, 3, 4]; }), 'map'); assert.equal(m((h) => { h.o[0] = h.o[0].concat([1]); }), 'map');
  assert.equal(m((h) => { h.t = []; }), 'map'); assert.equal(m((h) => { h.c = []; }), 'map');
  assert.equal(m((h) => { h.f = new Array(61).fill([0, 0, 10, 0, 10, 10]); }), 'map', 'too many shapes');
  assert.equal(m((h) => { h.o[0] = new Array(602).fill(1); }), 'map', 'too many points');
  // 홀 수와 맞지 않는 약도, 약도 자리에 다른 것
  assert.equal(m((h, x) => { x.map.pop(); }), 'map'); assert.equal(m((h, x) => { x.map = {}; }), 'map'); assert.equal(m((h, x) => { x.map[3] = null; }), 'map');
  // 없어도 되는 것은 빈 목록으로 채워진다
  const x = creekFile(); delete x.map[0].ip; delete x.map[0].cy; delete x.map[0].m; delete x.map[0].e; delete x.map[0].w; x.map[0].c[0][0] = 143.4;
  const r = S.readCourseFile(x);
  assert.equal(r.ok, true);
  assert.deepEqual([r.course.map[0].ip, r.course.map[0].cy, r.course.map[0].m, r.course.map[0].e, r.course.map[0].w], [[], [], [], [], []]);
  assert.equal(r.course.map[0].c[0][0], 143, 'coordinates are rounded to whole numbers');
  // 약도가 틀리면 코스 전체를 받지 않는다 (약도만 빼고 받지 않는다)
  assert.equal(S.readCourseFile(Object.assign(creekFile(), { map: 'x' })).ok, false);
});

test('course folder: the shipped files are valid and equal the built-in courses', () => {
  const dir = path.join(__dirname, '..', 'courses');
  ['bearcreek-pocheon-bear-18.json', 'bearcreek-pocheon-creek-18.json'].forEach((file) => {
    const r = S.readCourseFile(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
    assert.equal(r.ok, true, file);
    const c = courses.find((x) => x.name === r.course.name);
    assert.ok(c, file + ' names a built-in course');
    assert.deepEqual([r.course.pars, r.course.strokeIndex, r.course.holeInfo], [c.pars, c.strokeIndex, c.holeInfo], file);
    assert.deepEqual(r.course.map, maps[c.name] || null, file);
    assert.equal(r.course.updated, '2026-11-11');
  });
});

test('course list builder: valid files are listed, broken ones are skipped, the newest of a duplicate wins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'courses-'));
  const put = (name, v) => fs.writeFileSync(path.join(dir, name), typeof v === 'string' ? v : JSON.stringify(v));
  try {
    put('creek.json', creekFile());
    put('bear.json', S.makeCourseFile(bear, null, { updated: '2026-11-01' }));
    put('bear-newer.json', Object.assign(S.makeCourseFile(bear, null, { updated: '2026-12-01' }), { note: '고친 것' }));
    put('nine.json', { format: S.COURSE_FORMAT, v: 1, name: bear.name, holes: 9, pars: [4, 4, 3, 5, 4, 4, 3, 4, 5], strokeIndex: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    put('broken.json', '{ not json');
    put('other.json', { hello: 1 });
    put('badmap.json', Object.assign(creekFile(), { name: '다른 골프장', map: [1] }));
    put('index.json', { v: 1, courses: [{ file: 'stale.json' }] });
    put('.hidden.json', creekFile());
    put('notes.txt', 'x');
    put('﻿bom.json'.slice(1), '﻿' + JSON.stringify(Object.assign(creekFile(), { name: 'BOM 골프장' })));
    const res = build(dir);
    assert.deepEqual(res.index.v, 1);
    assert.deepEqual(res.index.courses.map((c) => [c.file, c.holes, c.map, c.updated]), [
      ['bom.json', 18, true, '2026-11-11'],
      ['nine.json', 9, false, ''],
      ['bear-newer.json', 18, false, '2026-12-01'],
      ['creek.json', 18, true, '2026-11-11']
    ].sort((a, b) => res.index.courses.findIndex((c) => c.file === a[0]) - res.index.courses.findIndex((c) => c.file === b[0])));
    assert.deepEqual(res.index.courses.map((c) => c.file).sort(), ['bear-newer.json', 'bom.json', 'creek.json', 'nine.json']);
    assert.equal(res.index.courses.find((c) => c.file === 'bear-newer.json').note, '고친 것');
    assert.deepEqual(res.skipped.map((s) => s[0]).sort(), ['badmap.json', 'bear.json', 'broken.json', 'other.json']);
    assert.deepEqual(Object.fromEntries(res.skipped), { 'badmap.json': 'map', 'bear.json': 'same course as bear-newer.json', 'broken.json': 'not JSON', 'other.json': 'format' });
    // 이름 순 (같은 이름이면 홀 수 순)
    const names = res.index.courses.map((c) => c.name);
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b, 'ko')));
    // 빈 폴더, 없는 폴더
    assert.deepEqual(build(path.join(dir, 'nope')), { index: { v: 1, courses: [] }, skipped: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
