// 관리자 화면용 집계 API. 사원/부서 목록은 employees 테이블, 제출 현황은 tasks(사원별 행)에서 실시간 집계한다.
// PostgREST 는 GROUP BY 를 지원하지 않으므로 필요한 최소 컬럼만 읽어 서버에서 집계한다.
const express = require('express');
const { listEmployees, listDepartments, allTaskFacts, recentRequests } = require('../lib/data');
const { todayStr, fmtKst } = require('../lib/time');
const { wrap } = require('../lib/http');

const router = express.Router();

const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);

async function overview() {
  const [depts, facts, requestRows] = await Promise.all([listDepartments(), allTaskFacts(), recentRequests(30)]);
  const today = todayStr();
  const isDone = (t) => t.status === 'done';
  const isOverdue = (t) => !isDone(t) && String(t.due).slice(0, 10) < today;

  const perDept = new Map();      // dept -> { total, done, overdue, pendingEmps:Set }
  const perRequest = new Map();   // request_id -> { total, done }
  for (const t of facts) {
    const d = perDept.get(t.emp_dept) || { total: 0, done: 0, overdue: 0, pendingEmps: new Set() };
    d.total += 1;
    if (isDone(t)) d.done += 1; else d.pendingEmps.add(t.emp_no);
    if (isOverdue(t)) d.overdue += 1;
    perDept.set(t.emp_dept, d);

    if (t.request_id != null) {
      const r = perRequest.get(Number(t.request_id)) || { total: 0, done: 0 };
      r.total += 1; if (isDone(t)) r.done += 1;
      perRequest.set(Number(t.request_id), r);
    }
  }

  const byDept = depts.map((dp) => {
    const r = perDept.get(dp.dept) || { total: 0, done: 0, overdue: 0, pendingEmps: new Set() };
    return {
      dept: dp.dept, employees: dp.employees,
      total: r.total, done: r.done, pending: r.total - r.done, overdue: r.overdue,
      pendingEmployees: r.pendingEmps.size,
      rate: pct(r.done, r.total),
    };
  });

  const totalTasks = byDept.reduce((n, d) => n + d.total, 0);
  const doneTasks = byDept.reduce((n, d) => n + d.done, 0);

  const requests = requestRows.map((r) => {
    const c = perRequest.get(Number(r.id)) || { total: 0, done: 0 };
    return {
      id: Number(r.id), title: r.title, cat: r.cat, requesterDept: r.requester_dept, targetDept: r.target_dept,
      due: String(r.due).slice(0, 10), createdAt: fmtKst(r.created_at),
      total: c.total, done: c.done, rate: pct(c.done, c.total),
    };
  });

  return {
    totalEmployees: depts.reduce((n, d) => n + d.employees, 0),
    totalTasks,
    doneTasks,
    submitRate: pct(doneTasks, totalTasks),
    notSubmitted: byDept.reduce((n, d) => n + d.pendingEmployees, 0), // 미제출 업무가 1건이라도 있는 사원 수
    overdueTasks: byDept.reduce((n, d) => n + d.overdue, 0),          // 기한이 지났는데 미제출인 (사원×업무) 건수
    byDept,
    requests,
    generatedAt: new Date().toISOString(),
  };
}

router.get('/overview', wrap(async (req, res) => res.json(await overview())));

// 부서 목록(사원 DB 기준) — 제출요청 발송 폼의 대상 부서 선택지
router.get('/departments', wrap(async (req, res) => {
  const depts = await listDepartments();
  res.json({ totalEmployees: depts.reduce((n, d) => n + d.employees, 0), departments: depts });
}));

// GET /api/admin/employees?dept=&status=all|done|pending|overdue|none&q=&requestId=&page=&pageSize=
// 사원 전원을 기준으로 사원별 제출 현황을 돌려준다(업무가 없는 사원은 state='none').
router.get('/employees', wrap(async (req, res) => {
  const { dept, q } = req.query;
  const status = ['done', 'pending', 'overdue', 'none'].includes(req.query.status) ? req.query.status : 'all';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 15, 1), 100);
  const requestId = parseInt(req.query.requestId, 10) || null;

  const [emps, allFacts] = await Promise.all([listEmployees(), allTaskFacts()]);
  const today = todayStr();
  const facts = requestId ? allFacts.filter((t) => Number(t.request_id) === requestId) : allFacts;

  const agg = new Map();
  for (const t of facts) {
    const a = agg.get(t.emp_no) || { total: 0, done: 0, overdue: 0, lastSubmittedAt: null };
    a.total += 1;
    if (t.status === 'done') {
      a.done += 1;
      if (!a.lastSubmittedAt || t.updated_at > a.lastSubmittedAt) a.lastSubmittedAt = t.updated_at;
    } else if (String(t.due).slice(0, 10) < today) a.overdue += 1;
    agg.set(t.emp_no, a);
  }

  const keyword = String(q || '').trim();
  let rows = emps.map((e) => {
    const a = agg.get(e.empNo) || { total: 0, done: 0, overdue: 0, lastSubmittedAt: null };
    const pending = a.total - a.done;
    const state = a.total === 0 ? 'none' : pending === 0 ? 'done' : a.overdue > 0 ? 'overdue' : 'pending';
    return { ...e, total: a.total, done: a.done, pending, overdue: a.overdue, state, lastSubmittedAt: fmtKst(a.lastSubmittedAt) };
  });
  if (dept) rows = rows.filter((r) => r.dept === dept);
  if (keyword) rows = rows.filter((r) => r.name.includes(keyword) || r.empNo.includes(keyword) || r.dept.includes(keyword));

  const summary = { all: rows.length, done: 0, pending: 0, overdue: 0, none: 0 };
  rows.forEach((r) => { summary[r.state] += 1; });
  // 상태 필터 'pending' = 미제출 전체(기한초과 포함)
  if (status === 'pending') rows = rows.filter((r) => r.state === 'pending' || r.state === 'overdue');
  else if (status !== 'all') rows = rows.filter((r) => r.state === status);

  const order = { overdue: 0, pending: 1, done: 2, none: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name, 'ko') || a.empNo.localeCompare(b.empNo));

  const total = rows.length;
  res.json({ total, page, pageSize, summary, employees: rows.slice((page - 1) * pageSize, page * pageSize) });
}));

module.exports = router;
module.exports.overview = overview;
