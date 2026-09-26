// seed-data/*.csv → Supabase 교체 시더 검증 (인메모리 가짜 Supabase 사용)
process.env.SEED_SOURCE = 'csv';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./fakeSupabase');
const client = require('../lib/supabaseClient');
const data = require('../lib/data');
const { parseCsv, buildSeed, seedFromCsv } = require('../lib/seedCsv');

test('CSV 파서: BOM, 따옴표, 빈 칸', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n1,"x,y"\r\n,2\r\n'), [{ a: '1', b: 'x,y' }, { a: '', b: '2' }]);
});

test('buildSeed: 사원 19명, 업무 = 교육 38 + 복무 36 + 요구자료 36', () => {
  const s = buildSeed();
  assert.equal(s.employees.length, 19);
  const n = (c) => s.tasks.filter((t) => t.row.cat === c).length;
  assert.deepEqual([n('edu'), n('service'), n('doc')], [38, 36, 36]);
  assert.equal(s.tasks.filter((t) => t.sub).length, 22 + 6); // 교육 제출완료 22 + 확인중 6
});

test('seedFromCsv: 기존 데이터를 교체하고 API 로 읽힌다', async () => {
  const fake = createFakeSupabase();
  client.__setClientForTests(fake);
  fake._tables.employees.push({ emp_no: 'OLD001', name: '옛사원', dept: '옛부서' });
  const r = await seedFromCsv();
  data.invalidateEmployees();
  assert.deepEqual([r.employees, r.tasks], [19, 110]);
  assert.equal(fake._tables.employees.some((e) => e.emp_no === 'OLD001'), false);
  const me = await data.getDefaultUser();
  assert.equal(me.name, '안송이');
  const mine = await data.tasksByEmp(me.empNo, {});
  assert.equal(mine.filter((t) => t.cat === 'edu').length, 3);
  assert.equal(mine.filter((t) => t.cat === 'service').length, 2);
  assert.equal(mine.filter((t) => t.cat === 'doc').length, 4);
  const pend = (await data.tasksByEmp('GBSA2020045', {})).find((t) => t.cat === 'edu' && t.review);
  assert.equal(pend.review.state, 'pending');
});
