const express = require('express');
const multer = require('multer');
const {
  resolveEmp, tasksByEmp, getTask, pendingEduTasks, recordSubmission, recordReviewSubmission, updateTask, deleteTask,
} = require('../lib/data');
const { pickMatch } = require('../lib/certMatch');
const CertExtract = require('../public/certExtract'); // 브라우저와 동일한 파서/성명 검증 로직
const { createRequest, httpError } = require('../lib/assign');
const { isValidDate } = require('../lib/time');
const { wrap } = require('../lib/http');
const { formatMethod, EXT_BY_MIME } = require('../lib/review');
const { saveCertFile } = require('../lib/storage');

const router = express.Router();

// multer(busboy)는 multipart 파일명을 latin1로 해석하므로, 한글 파일명이 깨진 경우 UTF-8로 복원한다.
function fixName(name) {
  if (!name) return '';
  return [...name].every((c) => c.charCodeAt(0) <= 0xff) ? Buffer.from(name, 'latin1').toString('utf8') : name;
}

// 업로드 파일은 디스크에 저장하지 않는다(서버리스는 디스크가 휘발성). 자동 제출은 파일명만 이력에 남기고,
// 본인 확인 제출(관리자 확인 대상)만 관리자가 열람할 수 있도록 Supabase Storage 에 보관한다.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const clean = (v, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function certFromBody(body = {}) {
  return {
    course_name: clean(body.courseName),
    issuer: clean(body.issuer),
    completed_date: clean(body.completedDate, 20),
    ocr_text: clean(body.ocrText, 8000),
  };
}

const fileInfo = (file) => (file ? { fixedName: fixName(file.originalname) } : null);

// GET /api/tasks?empNo=&cat=&status=  — 해당 사원의 업무 체크리스트
router.get('/', wrap(async (req, res) => {
  const emp = await resolveEmp(req.query.empNo);
  res.json(await tasksByEmp(emp.empNo, { cat: req.query.cat, status: req.query.status }));
}));

router.get('/:id', wrap(async (req, res) => {
  const task = await getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json(task);
}));

// POST /api/tasks/bulk — 부서(또는 전체) 사원 전원에게 새 제출요청을 배포한다. 사원별로 업무 1행씩 생성.
//   { tasks: [{ title, cat, due(YYYY-MM-DD), targetDept('전체'|부서명), dept?(요청부서), raw? }, ...] }
router.post('/bulk', wrap(async (req, res) => {
  const list = (req.body && req.body.tasks) || [];
  if (!Array.isArray(list) || list.length === 0) return res.status(400).json({ error: 'tasks 배열이 필요합니다.' });
  if (list.length > 20) return res.status(400).json({ error: '한 번에 최대 20건까지 발송할 수 있습니다.' });
  list.forEach((r, i) => {
    if (!r || !r.targetDept) throw httpError(400, `${i + 1}번째 항목: targetDept(대상 부서 또는 '전체')가 필요합니다.`);
  });

  const requests = [];
  for (const r of list) {
    requests.push(await createRequest({ title: r.title, cat: r.cat, dept: r.dept, due: r.due, targetDept: r.targetDept, raw: r.raw }));
  }
  res.status(201).json({ created: requests.reduce((n, r) => n + r.count, 0), requests });
}));

// POST /api/tasks/cert-upload  (multipart)
//   empNo?, file?, courseName?, issuer?, completedDate?, certName?, ocrText?, taskId?
// 프론트(Tesseract.js)가 추출한 값으로 '해당 사원의' 미제출 교육 업무를 매칭해 제출완료 처리.
// 수료증 성명이 로그인 사원과 다르거나 확인되지 않으면 403(NAME_MISMATCH/NAME_UNVERIFIED)으로 거부한다.
// 업무 매칭이 모호하면 422 + candidates, 프론트가 taskId 를 지정해 다시 호출한다.
router.post('/cert-upload', upload.single('file'), wrap(async (req, res) => {
  const body = req.body || {};
  const emp = await resolveEmp(clean(body.empNo, 30));
  const cert = certFromBody(body);
  const file = fileInfo(req.file);
  const fileName = file ? file.fixedName : clean(body.fileName) || '';

  if (!req.file && !cert.ocr_text && !cert.course_name) {
    return res.status(400).json({ error: '파일 또는 OCR 추출 결과(courseName/ocrText)가 필요합니다.' });
  }

  // ---- 본인 성명 검증 (strict) ----
  // 서버가 OCR 원문에서 성명을 다시 추출해 로그인 사원의 성명과 비교한다. 프론트가 보낸 certName 이 원문과 다르면 거부한다.
  const serverName = CertExtract.extractName(cert.ocr_text || '').name;
  const claimedName = clean(body.certName, 50);
  if (serverName && claimedName && CertExtract.normalizeName(serverName) !== CertExtract.normalizeName(claimedName)) {
    return res.status(400).json({ error: '수료증 성명 값이 OCR 원문과 일치하지 않습니다.', code: 'NAME_TAMPERED', isNameMatched: false });
  }
  const nameCheck = CertExtract.verifyName(emp.name, { certName: serverName || claimedName || '', text: cert.ocr_text || '' });
  // 성명을 못 읽었거나(unverified) 한 글자 차이(OCR 오인식 가능)면 본인 확인(nameConfirmed)을 받아 통과시키고 제출 이력에 남긴다.
  // 수료증 성명이 명확히 다른 사람이면(두 글자 이상 차이) 확인해도 거부한다.
  const nameConfirmed = String(body.nameConfirmed) === 'true' && nameCheck.confirmable === true && nameCheck.status !== 'match';
  if (nameCheck.status !== 'match' && !nameConfirmed) {
    return res.status(403).json({
      error: CertExtract.nameMessage(nameCheck),
      code: nameCheck.status === 'mismatch' ? 'NAME_MISMATCH' : 'NAME_UNVERIFIED',
      isNameMatched: false,
      matchedName: nameCheck.matchedName,
      expectedName: emp.name,
      similar: nameCheck.similar,
      confirmable: nameCheck.confirmable === true,
    });
  }

  const pending = await pendingEduTasks(emp.empNo);
  if (pending.length === 0) {
    return res.status(404).json({ error: '제출 대기 중인 교육 수료증 업무가 없습니다.', fileName });
  }

  let task; let matchedBy; let score = 0;
  if (body.taskId) {
    task = pending.find((t) => String(t.id) === String(body.taskId));
    if (!task) return res.status(404).json({ error: '지정한 업무가 없거나 이미 제출되었습니다.' });
    matchedBy = 'manual-select';
  } else {
    const m = pickMatch(pending, { courseName: cert.course_name, ocrText: cert.ocr_text, fileName });
    if (!m.task) {
      return res.status(422).json({
        error: '수료증과 일치하는 업무를 자동으로 특정하지 못했습니다. 아래 후보에서 선택해 주세요.',
        candidates: m.candidates.map(({ id, title, due }) => ({ id, title, due })),
        cert,
      });
    }
    ({ task, matchedBy, score } = m);
  }

  // 본인 확인으로 통과한 제출은 바로 완료하지 않고 관리자 확인 대기로 둔다(수료증 이미지 필수).
  if (nameConfirmed) {
    if (!req.file) return res.status(400).json({ error: '본인 확인 제출에는 수료증 파일이 필요합니다.', code: 'FILE_REQUIRED' });
    const ext = EXT_BY_MIME[req.file.mimetype];
    if (!ext) return res.status(400).json({ error: '이미지(PNG/JPG/WEBP/GIF/BMP) 또는 PDF 수료증만 제출할 수 있습니다.', code: 'FILE_TYPE' });
    const path = `${task.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await saveCertFile(path, req.file.buffer, req.file.mimetype);
    const subId = await recordReviewSubmission(task.id, { ...cert, file_name: fileName }, formatMethod({ base: matchedBy, nameConfirmed: true, review: 'pending', file: path }));
    if (!subId) return res.status(409).json({ error: '이미 제출 처리된 업무입니다.' });
    return res.status(202).json({
      review: 'pending', submissionId: subId, matchedTask: await getTask(task.id), matchedBy, score, cert, fileName,
      nameCheck: { isNameMatched: false, confirmedByUser: true, matchedName: nameCheck.matchedName, expectedName: emp.name },
    });
  }
  const changed = await recordSubmission(task.id, file, cert, matchedBy);
  if (!changed) return res.status(409).json({ error: '이미 제출 처리된 업무입니다.' });
  res.json({
    matchedTask: await getTask(task.id), matchedBy, score, cert, fileName,
    nameCheck: { isNameMatched: true, confirmedByUser: false, matchedName: nameCheck.matchedName, expectedName: emp.name },
  });
}));

// PATCH /api/tasks/:id  { title?, dept?, assignee?, due?, status?, cat? } - 기한 연기 등 수정
router.patch('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || !(await getTask(id))) return res.status(404).json({ error: 'task not found' });

  const b = req.body || {};
  const updates = {};
  for (const f of ['title', 'dept', 'assignee']) {
    if (b[f] !== undefined) {
      const v = String(b[f]).trim();
      if (!v || v.length > 200) throw httpError(400, `${f} 는 1~200자여야 합니다.`);
      updates[f] = v;
    }
  }
  if (b.due !== undefined) {
    if (!isValidDate(String(b.due))) throw httpError(400, 'due 는 YYYY-MM-DD 형식이어야 합니다.');
    updates.due = String(b.due);
  }
  if (b.cat !== undefined) {
    if (!['service', 'edu', 'doc'].includes(b.cat)) throw httpError(400, 'cat 은 service|edu|doc 중 하나여야 합니다.');
    updates.cat = b.cat;
  }
  if (b.status !== undefined) {
    if (!['normal', 'warn', 'urgent', 'overdue', 'done'].includes(b.status)) throw httpError(400, '올바르지 않은 status 입니다.');
    updates.status = b.status;
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: '수정할 필드가 없습니다.' });

  await updateTask(id, updates);
  res.json(await getTask(id));
}));

// POST /api/tasks/:id/submit - 직원 "제출완료" (수동 제출)
// - 이미 제출된 업무는 다시 처리하지 않고 현재 상태를 그대로 돌려준다(중복 제출 이력 방지).
// - 교육 수료증(edu) 업무는 성명 검증을 거치는 /cert-upload 로만 제출할 수 있다. (수동 제출로 검증을 우회 불가)
//   시연 등에서 예외가 필요하면 ALLOW_MANUAL_EDU_SUBMIT=true
// - 수동 제출은 수료증 OCR 필드(교육명/발급기관/이수일자/원문)를 기록하지 않는다. (검증되지 않은 값이 'OCR 자동 제출'처럼 보이는 것 방지)
const NO_CERT = { course_name: null, issuer: null, completed_date: null, ocr_text: null };
router.post('/:id/submit', upload.single('file'), wrap(async (req, res) => {
  const task = await getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.status === 'done') return res.json(task);

  if (task.cat === 'edu' && process.env.ALLOW_MANUAL_EDU_SUBMIT !== 'true') {
    return res.status(403).json({
      error: '교육 수료증 업무는 수료증을 업로드해 본인 성명 검증을 거쳐야 제출할 수 있습니다.',
      code: 'CERT_REQUIRED',
    });
  }
  await recordSubmission(task.id, fileInfo(req.file), NO_CERT, 'manual');
  res.json(await getTask(task.id));
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || !(await deleteTask(id))) return res.status(404).json({ error: 'task not found' });
  res.status(204).end();
}));

module.exports = router;
