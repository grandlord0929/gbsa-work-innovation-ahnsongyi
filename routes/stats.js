const express = require('express');
const { overview } = require('./admin');
const { wrap } = require('../lib/http');

const router = express.Router();

// GET /api/stats — 관리자 대시보드 통계 (GET /api/admin/overview 와 동일한 집계)
router.get('/', wrap(async (req, res) => res.json(await overview())));

module.exports = router;
