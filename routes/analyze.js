const express = require('express');
const multer = require('multer');
const { analyze } = require('../lib/analyze');
const { getEmployee } = require('../lib/data');
const { wrap } = require('../lib/http');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// POST /api/analyze  { text: "..." }  - OCR 결과 텍스트 → 구조화된 업무 항목 미리보기(비영속)
// 요청부서는 공문 본문이 아니라 로그인한 관리자의 현재 소속 부서(사원 DB 기준, 없으면 세션 값)로 채운다.
async function requesterDept(req) {
  const emp = req.session && (await getEmployee(req.session.empNo));
  return (emp && emp.dept) || (req.session && req.session.dept) || '';
}

router.post('/', wrap(async (req, res) => {
  const text = (req.body && req.body.text) || '';
  if (!text.trim()) return res.status(400).json({ error: 'text 가 필요합니다.' });
  res.json(analyze(text, { dept: await requesterDept(req) }));
}));

// POST /api/analyze/file  (multipart, .txt만 서버에서 즉시 분석; 그 외 포맷은 OCR 연동 지점)
router.post('/file', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 필요합니다.' });
  const isTxt = req.file.mimetype === 'text/plain' || /\.txt$/i.test(req.file.originalname);
  if (!isTxt) {
    return res.status(422).json({
      error: 'TXT 이외 형식은 OCR API 연동이 필요합니다. text 필드로 OCR 결과를 전달해 /api/analyze 를 호출하세요.',
      fileName: req.file.originalname,
    });
  }
  const text = req.file.buffer.toString('utf-8');
  res.json(analyze(text, { dept: await requesterDept(req) }));
}));

module.exports = router;
