const test = require('node:test');
const assert = require('node:assert/strict');
const courses = require('../courses.js');
const maps = require('../coursemaps.js');

test('course maps: every map belongs to a built-in course and is drawable', () => {
  const names = Object.keys(maps);
  assert.ok(names.length >= 1);
  names.forEach((name) => {
    const course = courses.find((c) => c.name === name);
    assert.ok(course, 'map for an unknown course: ' + name);
    const holes = maps[name];
    assert.equal(holes.length, course.holes);
    holes.forEach((m, h) => {
      const tag = name + ' #' + (h + 1);
      assert.ok(m.h > 100 && m.h < 2500, tag + ' height');
      assert.ok(m.s > 0.5 && m.s < 10, tag + ' scale');
      assert.ok(Array.isArray(m.c) && m.c.length >= 1, tag + ' green centre');
      ['o', 'f', 'g', 'b', 'w', 'd'].forEach((k) => {
        assert.ok(Array.isArray(m[k]), tag + ' ' + k);
        m[k].forEach((poly) => {
          assert.ok(poly.length >= 6 && poly.length % 2 === 0, tag + ' ' + k + ' polygon');
          poly.forEach((v, i) => assert.ok(Number.isInteger(v) && v >= -5 && v <= (i % 2 ? m.h + 5 : 505), tag + ' ' + k + ' coordinate ' + v));
        });
      });
      assert.equal(m.o.length, 1, tag + ' outline');
      assert.ok(m.g.length >= 1, tag + ' green');
      // 티: 색·좌표·거리. 화이트티(첫 번째) 거리는 기본 제공 코스의 홀 거리와 같다
      assert.ok(m.t.length >= 5, tag + ' tees');
      m.t.forEach((t) => { assert.ok('KBWYR'.indexOf(t[0]) >= 0 && t.length === 4 && t[3] > 50 && t[3] < 650, tag + ' tee ' + JSON.stringify(t)); });
      const white = m.t.find((t) => t[0] === 'W');
      assert.equal(white[3], course.holeInfo[h].dist, tag + ' white tee distance matches the course data');
      // 그린 중심에서 화이트티까지의 그림상 거리(꺾은선)가 실제 거리와 대략 맞는다
      const pts = [[white[1], white[2]]].concat(m.ip || []).concat([m.c[0]]);
      let len = 0;
      for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      assert.ok(Math.abs(len / m.s - white[3]) < white[3] * 0.08, tag + ' scale consistent: ' + Math.round(len / m.s) + ' vs ' + white[3]);
      (m.cy || []).forEach((q) => assert.ok(q.length === 4 && (q[3] === 'L' || q[3] === 'R' || q[3] === 'C') && q[2] > 30, tag + ' carry'));
      // 거리 표시의 숫자는 그림상 그린 중심까지의 거리와 크게 다르지 않아야 한다 (이웃 표시의 숫자가 잘못 붙는 것을 잡는다)
      (m.m || []).forEach((q) => { const g = Math.hypot(q[0] - m.c[0][0], q[1] - m.c[0][1]) / m.s; assert.ok(q.length === 3 && Math.abs(g - q[2]) <= Math.max(20, 0.15 * q[2]), tag + ' marker ' + q[2] + ' vs drawn ' + Math.round(g)); });
    });
  });
});
