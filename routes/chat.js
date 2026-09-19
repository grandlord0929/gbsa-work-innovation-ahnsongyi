const express = require('express');
const { db } = require('../db');
const { reply } = require('../lib/chat');
const { recomputeStatus } = require('../lib/dday');
const { getEmployee, getDefaultUser } = require('../lib/excelDb');

const router = express.Router();

// POST /api/chat  { question: "...", empNo?: "..." } — 해당 사원의 업무 기준으로 답변
router.post('/', (req, res) => {
  const question = (req.body && req.body.question) || '';
  if (!question.trim()) return res.status(400).json({ error: 'question 이 필요합니다.' });

  const empNo = req.body && req.body.empNo;
  const emp = empNo ? getEmployee(empNo) : getDefaultUser();
  if (!emp) return res.status(404).json({ error: `사원 DB에 없는 사번입니다: ${empNo}` });

  const tasks = db.prepare('SELECT * FROM tasks WHERE emp_no=?').all(emp.empNo)
    .map((t) => ({ ...t, status: recomputeStatus(t.due, t.status) }));
  const answer = reply(question, tasks);

  db.prepare('INSERT INTO chat_logs (question, answer) VALUES (?, ?)').run(question, answer);
  res.json({ question, answer });
});

// GET /api/chat/history?limit=20
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const rows = db.prepare('SELECT * FROM chat_logs ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows.reverse());
});

module.exports = router;
