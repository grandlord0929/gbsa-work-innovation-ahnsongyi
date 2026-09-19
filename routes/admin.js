// 관리자 화면용 집계 API. 사원/부서 목록은 employees.xlsx(사원 DB), 제출 현황은 tasks(사원별 행)에서 실시간 집계한다.
const express = require('express');
const { db } = require('../db');
const { listEmployees, listDepartments } = require('../lib/excelDb');

const router = express.Router();

const OVERDUE = "status!='done' AND due < date('now','+9 hours')";
const pct = (done, total) => (total ? Math.round((done / total) * 100) : 0);

function overview() {
  const depts = listDepartments();
  const totalEmployees = depts.reduce((n, d) => n + d.employees, 0);

  const perDept = new Map(db.prepare(`
    SELECT emp_dept AS dept, COUNT(*) AS total,
           SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN ${OVERDUE} THEN 1 ELSE 0 END) AS overdue
    FROM tasks GROUP BY emp_dept
  `).all().map((r) => [r.dept, r]));

  const pendingEmp = new Map(db.prepare(`
    SELECT emp_dept AS dept, COUNT(DISTINCT emp_no) AS n FROM tasks WHERE status!='done' GROUP BY emp_dept
  `).all().map((r) => [r.dept, r.n]));

  const byDept = depts.map((d) => {
    const r = perDept.get(d.dept) || { total: 0, done: 0, overdue: 0 };
    return {
      dept: d.dept, employees: d.employees,
      total: r.total, done: r.done, pending: r.total - r.done, overdue: r.overdue,
      pendingEmployees: pendingEmp.get(d.dept) || 0,
      rate: pct(r.done, r.total),
    };
  });

  const totalTasks = byDept.reduce((n, d) => n + d.total, 0);
  const doneTasks = byDept.reduce((n, d) => n + d.done, 0);

  const requests = db.prepare(`
    SELECT r.id, r.title, r.cat, r.requester_dept AS requesterDept, r.target_dept AS targetDept, r.due,
           r.created_at AS createdAt, COUNT(t.id) AS total,
           SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done
    FROM requests r LEFT JOIN tasks t ON t.request_id = r.id
    GROUP BY r.id ORDER BY r.id DESC LIMIT 30
  `).all().map((r) => ({ ...r, done: r.done || 0, rate: pct(r.done || 0, r.total) }));

  return {
    totalEmployees,
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

router.get('/overview', (req, res) => res.json(overview()));

// 부서 목록(엑셀 사원 DB 기준) — 제출요청 발송 폼의 대상 부서 선택지
router.get('/departments', (req, res) => {
  const depts = listDepartments();
  res.json({ totalEmployees: depts.reduce((n, d) => n + d.employees, 0), departments: depts });
});

// GET /api/admin/employees?dept=&status=all|done|pending|overdue|none&q=&requestId=&page=&pageSize=
// 사원 200명 전원을 기준으로 사원별 제출 현황을 돌려준다(업무가 없는 사원은 state='none').
router.get('/employees', (req, res) => {
  const { dept, q } = req.query;
  const status = ['done', 'pending', 'overdue', 'none'].includes(req.query.status) ? req.query.status : 'all';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 15, 1), 100);
  const requestId = parseInt(req.query.requestId, 10) || null;

  const agg = new Map(db.prepare(`
    SELECT emp_no AS empNo, COUNT(*) AS total,
           SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN ${OVERDUE} THEN 1 ELSE 0 END) AS overdue,
           MAX(CASE WHEN status='done' THEN updated_at END) AS lastSubmittedAt
    FROM tasks ${requestId ? 'WHERE request_id=?' : ''} GROUP BY emp_no
  `).all(...(requestId ? [requestId] : [])).map((r) => [r.empNo, r]));

  const keyword = String(q || '').trim();
  let rows = listEmployees().map((e) => {
    const a = agg.get(e.empNo) || { total: 0, done: 0, overdue: 0, lastSubmittedAt: null };
    const pending = a.total - a.done;
    const state = a.total === 0 ? 'none' : pending === 0 ? 'done' : a.overdue > 0 ? 'overdue' : 'pending';
    return { ...e, total: a.total, done: a.done, pending, overdue: a.overdue, state, lastSubmittedAt: a.lastSubmittedAt };
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
});

module.exports = router;
module.exports.overview = overview;
