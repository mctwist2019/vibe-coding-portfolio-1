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

test('course fingerprint: the same content gives the same value; every change to the content changes it', () => {
  const read = (f) => { const r = S.readCourseFile(f); assert.equal(r.ok, true); return r.course; };
  const base = S.courseSig(read(creekFile()));
  assert.match(base, /^[0-9a-f]{16}$/);
  assert.equal(S.courseSig(read(creekFile())), base);
  // 파일의 모양(키 순서, 모르는 칸)이 달라도 읽은 내용이 같으면 같다
  const f = creekFile(), other = { extra: 1 };
  Object.keys(f).reverse().forEach((k) => { other[k] = f[k]; });
  assert.equal(S.courseSig(read(other)), base);
  // 앱에 저장되는 내용이 달라지면 달라진다
  const changes = {
    par: (x) => { x.pars[0] = x.pars[0] === 4 ? 5 : 4; },
    handicap: (x) => { const t = x.strokeIndex[0]; x.strokeIndex[0] = x.strokeIndex[1]; x.strokeIndex[1] = t; },
    distance: (x) => { x.holeInfo[0].dist += 1; },
    shape: (x) => { x.holeInfo[0].shape = x.holeInfo[0].shape === 'L' ? 'R' : 'L'; },
    hazard: (x) => { x.holeInfo[0].haz ^= 4; },
    keyword: (x) => { x.holeInfo[0].memo += ' · 추가'; },
    'map number': (x) => { x.map[17].g[0][0] += 1; },
    'map tee distance': (x) => { x.map[0].t[0][3] += 1; },
    name: (x) => { x.name += ' 2'; },
    note: (x) => { x.note = '다른 설명'; },
    date: (x) => { x.updated = '2026-11-12'; },
    'no map': (x) => { delete x.map; }
  };
  const seen = new Set([base]);
  Object.keys(changes).forEach((k) => { const x = creekFile(); changes[k](x); const sig = S.courseSig(read(x)); assert.equal(seen.has(sig), false, k); seen.add(sig); });
  // 약도의 숫자 하나만 달라도 달라진다 (좌표를 하나씩 바꿔 가며)
  let n = 0;
  maps[creek.name].forEach((hm, h) => hm.o[0].forEach((v, i) => {
    if (i % 2) return; // 가로 좌표만: 1을 더해도 그림 안에 있다
    const x = creekFile(); x.map[h].o[0][i] = v + 1;
    const r = S.readCourseFile(x);
    if (!r.ok) return;
    const sig = S.courseSig(r.course); assert.equal(seen.has(sig), false, 'hole ' + h + ' point ' + i); seen.add(sig); n++;
  }));
  assert.ok(n > 200, 'checked ' + n + ' single-number changes');
});

// 코스 폴더에 든 실제 파일의 내용을 여기서 못 박지 않는다: 그 파일들은 배포자가 GitHub에서 지우거나 바꿀 수 있고,
// 시험이 그 때문에 실패하면 앱 배포 전체가 막힌다. 대신 꺼내기 도구가 만드는 파일이 기본 제공 자료와 같은지 본다
test('built-in course export: the files written by the export tool equal the built-in courses', () => {
  const { exportTo, UPDATED } = require('../tools/export-builtin-courses.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
  try {
    const files = exportTo(dir);
    assert.equal(files.length, courses.length);
    files.forEach((file) => {
      const r = S.readCourseFile(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      assert.equal(r.ok, true, file);
      const c = courses.find((x) => x.name === r.course.name);
      assert.ok(c, file + ' names a built-in course');
      assert.deepEqual([r.course.pars, r.course.strokeIndex, r.course.holeInfo], [c.pars, c.strokeIndex, c.holeInfo], file);
      assert.deepEqual(r.course.map, maps[c.name] || null, file);
      assert.equal(r.course.updated, UPDATED);
    });
    // 앱이 아는 기본 제공 자료의 기준일과 같아야 목록에서 '기본 포함'으로 보인다
    const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    assert.equal((/var SHIPPED_UPDATED = '(\d{4}-\d{2}-\d{2})'/.exec(app) || [])[1], UPDATED);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('course folder: whatever files are in the real folder, the list is built and lists only valid courses', () => {
  const dir = path.join(__dirname, '..', 'courses');
  const res = build(dir); // 올바르지 않은 파일은 건너뛸 뿐 실패하지 않는다
  assert.equal(Array.isArray(res.index.courses), true);
  res.index.courses.forEach((e) => {
    const r = S.readCourseFile(JSON.parse(fs.readFileSync(path.join(dir, e.file), 'utf8').replace(/^\uFEFF/, '')));
    assert.equal(r.ok, true, e.file);
    assert.deepEqual([r.course.name, r.course.holes, !!r.course.map], [e.name, e.holes, e.map], e.file);
  });
  // 폴더가 비어 있어도, 본보기 파일이 지워져도 목록은 만들어진다
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
  try { assert.deepEqual(build(empty), { index: { v: 1, courses: [] }, skipped: [] }); } finally { fs.rmSync(empty, { recursive: true, force: true }); }
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
    put('creek.json.txt', creekFile()); // 메모장이 붙인 .txt
    put('README.md', '# 안내'); put('.gitkeep', '');
    fs.mkdirSync(path.join(dir, '내 코스')); put(path.join('내 코스', 'inside.json'), creekFile()); // 폴더째 올린 것
    fs.mkdirSync(path.join(dir, 'folder.json'));
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
    // 목록에 넣지 않은 것은 이름이나 자리 때문에 읽지 않은 것까지 모두 이유가 남는다 (각각 한 줄씩). README.md, .gitkeep, 만들어진 index.json은 말없이 넘어간다
    assert.deepEqual(res.skipped.map((s) => s[0]).sort(), ['.hidden.json', 'badmap.json', 'bear.json', 'broken.json', 'creek.json.txt', 'folder.json/', 'notes.txt', 'other.json', '내 코스/']);
    assert.deepEqual(Object.fromEntries(res.skipped), { 'badmap.json': 'map', 'bear.json': 'same course as bear-newer.json', 'broken.json': 'not JSON', 'other.json': 'format',
      '.hidden.json': 'the file name starts with a dot', 'notes.txt': 'the file name must end in .json', 'creek.json.txt': 'the file name must end in .json',
      '내 코스/': 'a folder: course files inside a folder are not read', 'folder.json/': 'a folder: course files inside a folder are not read' });
    // 이름 순 (같은 이름이면 홀 수 순)
    const names = res.index.courses.map((c) => c.name);
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b, 'ko')));
    // 내용 지문: 같은 날 고쳐 올린 자료를 앱이 알아보는 데 쓴다. 내용이 같으면 같고(파일 모양만 다른 것 포함), 내용이 달라지면 달라진다
    const sigs = () => Object.fromEntries(build(dir).index.courses.map((c) => [c.file, c.sig]));
    const before = sigs();
    Object.keys(before).forEach((f) => assert.match(before[f], /^[0-9a-f]{16}$/, f));
    // 앱이 받은 파일을 읽어 만드는 지문과 같은 값이다 (앱은 이것으로 목록이 가리키는 그 파일을 받았는지 확인한다)
    Object.keys(before).forEach((f) => assert.equal(before[f], S.courseSig(S.readCourseFile(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, ''))).course), f));
    assert.equal(new Set(Object.values(before)).size, 4, 'different courses have different fingerprints');
    put('creek.json', JSON.stringify(creekFile(), null, 2) + '\n\n');
    assert.deepEqual(sigs(), before, 'the same course written with other spacing keeps its fingerprint');
    const fixed = creekFile(); fixed.pars[0] = fixed.pars[0] === 4 ? 5 : 4; // 날짜는 그대로, 1번홀 파만 고침
    put('creek.json', fixed);
    const after = sigs();
    assert.notEqual(after['creek.json'], before['creek.json'], 'a correction changes the fingerprint even when the date is the same');
    assert.deepEqual([after['bom.json'], after['nine.json'], after['bear-newer.json']], [before['bom.json'], before['nine.json'], before['bear-newer.json']]);
    const memo = creekFile(); memo.holeInfo[0].memo = '고친 키워드';
    put('creek.json', memo);
    assert.notEqual(sigs()['creek.json'], before['creek.json']);
    // 코스 파일을 index.json이라는 이름으로 올린 경우: 목록 파일로 덮어써지므로 이유를 남긴다
    put('index.json', creekFile());
    assert.equal(Object.fromEntries(build(dir).skipped)['index.json'], 'the name index.json is used for the list itself: upload the course under another name');
    // 빈 폴더, 없는 폴더
    assert.deepEqual(build(path.join(dir, 'nope')), { index: { v: 1, courses: [] }, skipped: [] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
