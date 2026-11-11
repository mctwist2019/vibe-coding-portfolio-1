#!/usr/bin/env node
/*
 * 앱에 들어 있는 기본 제공 코스(courses.js, coursemaps.js)를 코스 파일로 꺼내 코스 폴더에 쓴다.
 * 코스 폴더의 첫 내용이자 코스 파일의 본보기다. 기본 제공 코스의 자료를 고친 뒤 다시 실행하면 폴더의 파일도 같은 내용이 된다.
 *
 *   node golf-score/tools/export-builtin-courses.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../sync.js');
const courses = require('../courses.js');
const maps = require('../coursemaps.js');

// 파일 이름과 자료 기준일 (앱에 들어 있는 자료와 같은 날짜: 목록에서 '기본 포함'으로 보인다. app.js의 SHIPPED_UPDATED와 같아야 한다)
const FILES = {
  '베어크리크 포천 · 베어 (화이트티)': 'bearcreek-pocheon-bear-18.json',
  '베어크리크 포천 · 크리크 (화이트티)': 'bearcreek-pocheon-creek-18.json'
};
const UPDATED = '2026-11-11';

/** 기본 제공 코스를 코스 파일로 dir에 쓴다 → 쓴 파일 이름들 */
function exportTo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return courses.map((c) => {
    const file = FILES[c.name];
    if (!file) throw new Error('no file name for ' + c.name);
    const obj = S.makeCourseFile(c, maps[c.name], { updated: UPDATED });
    const check = S.readCourseFile(JSON.parse(JSON.stringify(obj)));
    if (!check.ok) throw new Error(c.name + ': ' + check.why);
    fs.writeFileSync(path.join(dir, file), JSON.stringify(obj) + '\n');
    return file;
  });
}

if (require.main === module) {
  exportTo(path.join(__dirname, '..', 'courses')).forEach((file) => console.log('wrote ' + file));
}

module.exports = { exportTo, UPDATED };
