const express = require('express');
const { overview } = require('./admin');

const router = express.Router();

// GET /api/stats — 관리자 대시보드 통계 (GET /api/admin/overview 와 동일한 집계)
router.get('/', (req, res) => res.json(overview()));

module.exports = router;
