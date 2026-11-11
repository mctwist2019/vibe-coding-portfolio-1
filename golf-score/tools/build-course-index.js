#!/usr/bin/env node
/*
 * 코스 폴더(golf-score/courses)의 코스 파일들을 읽어 목록 파일(index.json)을 만든다.
 * 배포할 때 GitHub Actions가 실행하므로, 폴더에 코스 파일을 넣기만 하면 앱의 "골프장 받기" 목록에 나온다.
 * 올바르지 않은 파일은 목록에 넣지 않고 이유를 출력한다 (배포는 멈추지 않는다: 잘못 올린 파일 하나 때문에 앱 갱신이 막히지 않게).
 * 같은 코스(이름 + 홀 수)의 파일이 여럿이면 updated가 가장 늦은 것, 같으면 파일 이름이 앞선 것 하나만 쓴다.
 *
 *   node golf-score/tools/build-course-index.js [폴더]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../sync.js');

// 목록의 sig: 코스 내용의 지문 (sync.js의 courseSig). 앱은 목록에서 코스를 받을 때 받은 내용이 이 값과 맞는지 보고 함께 적어 두며,
// 나중에 목록의 값이 달라졌으면 "새로 받기"를 띄운다: 같은 날 고쳐서 다시 올린 자료는 날짜(updated)만으로는 알아볼 수 없기 때문이다.
// 읽어서 정리한 내용으로 만든다 (줄바꿈·공백만 다른 파일은 같은 값)

/** 폴더를 읽어 { index: { v, courses: [{ file, name, holes, map, updated, note, sig }] }, skipped: [[파일, 이유]] } */
function build(dir) {
  const valid = [], skipped = [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { files = []; }
  files.filter((f) => /\.json$/i.test(f) && f !== 'index.json' && f.charAt(0) !== '.').sort().forEach((file) => {
    if (!/^[^/\\?#%]{1,120}$/.test(file)) { skipped.push([file, 'file name']); return; } // 주소에 그대로 쓰기 어려운 이름
    let text;
    try { text = fs.readFileSync(path.join(dir, file), 'utf8'); } catch (e) { skipped.push([file, 'unreadable']); return; }
    if (text.length > S.COURSE_FILE_MAX) { skipped.push([file, 'too large']); return; }
    let obj;
    try { obj = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { skipped.push([file, 'not JSON']); return; }
    const r = S.readCourseFile(obj);
    if (!r.ok) { skipped.push([file, r.why]); return; }
    valid.push({ file, name: r.course.name, holes: r.course.holes, map: !!r.course.map, updated: r.course.updated, note: r.course.note, sig: S.courseSig(r.course) });
  });
  // 같은 코스가 여럿이면 하나만
  const best = {};
  valid.forEach((e) => {
    const k = e.holes + '|' + e.name, cur = best[k];
    if (!cur) { best[k] = e; return; }
    if (e.updated > cur.updated) { skipped.push([cur.file, 'same course as ' + e.file]); best[k] = e; } else skipped.push([e.file, 'same course as ' + cur.file]);
  });
  const courses = Object.keys(best).map((k) => best[k]).sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.holes - b.holes);
  return { index: { v: 1, courses }, skipped };
}

if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, '..', 'courses');
  const res = build(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(res.index) + '\n');
  console.log('course list: ' + res.index.courses.length + ' course(s)');
  res.index.courses.forEach((c) => console.log('  ' + c.name + ' (' + c.holes + '홀' + (c.map ? ', 약도' : '') + ') <- ' + c.file));
  res.skipped.forEach((s) => console.log('  SKIPPED ' + s[0] + ': ' + s[1]));
}

module.exports = { build };
