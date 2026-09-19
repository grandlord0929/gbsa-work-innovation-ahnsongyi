const express = require('express');
const { reply } = require('../lib/chat');
const { resolveEmp, tasksByEmp, addChatLog, chatHistory } = require('../lib/data');
const { wrap } = require('../lib/http');

const router = express.Router();

// POST /api/chat  { question: "...", empNo?: "..." } — 해당 사원의 업무 기준으로 답변
router.post('/', wrap(async (req, res) => {
  const question = String((req.body && req.body.question) || '').slice(0, 500);
  if (!question.trim()) return res.status(400).json({ error: 'question 이 필요합니다.' });

  const emp = await resolveEmp(req.body && req.body.empNo);
  const answer = reply(question, await tasksByEmp(emp.empNo));
  await addChatLog(question, answer);
  res.json({ question, answer });
}));

// GET /api/chat/history?limit=20
router.get('/history', wrap(async (req, res) => {
  res.json(await chatHistory(Math.min(parseInt(req.query.limit, 10) || 20, 100)));
}));

module.exports = router;
