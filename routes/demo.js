const express = require('express');
const { resetDemo } = require('../lib/assign');

const router = express.Router();

// POST /api/demo/reset - 시연을 처음 상태로 되돌린다 (업무·제출·요청 이력 초기화 후 시드 재삽입)
router.post('/reset', (req, res, next) => {
  try {
    resetDemo();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
