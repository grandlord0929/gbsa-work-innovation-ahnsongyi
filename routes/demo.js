const express = require('express');
const { resetDemo } = require('../lib/seedData');
const { wrap } = require('../lib/http');

const router = express.Router();

// POST /api/demo/reset - 시연을 처음 상태로 되돌린다 (업무·제출·요청 이력 삭제 후 초기 시드 재삽입, 사원은 유지)
router.post('/reset', wrap(async (req, res) => {
  res.json({ ok: true, ...(await resetDemo()) });
}));

module.exports = router;
