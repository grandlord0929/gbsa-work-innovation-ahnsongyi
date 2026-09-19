const express = require('express');
const multer = require('multer');
const path = require('path');
const { db, UPLOAD_DIR, transaction } = require('../db');
const { recomputeStatus } = require('../lib/dday');
const { pickMatch } = require('../lib/certMatch');
const { getEmployee, getDefaultUser } = require('../lib/excelDb');
const { createRequest, httpError } = require('../lib/assign');

const router = express.Router();

// multer(busboy)는 multipart 파일명을 latin1로 해석하므로, 한글 파일명이 깨진 경우 UTF-8로 복원한다.
function fixName(name) {
  if (!name) return '';
  return [...name].every((c) => c.charCodeAt(0) <= 0xff) ? Buffer.from(name, 'latin1').toString('utf8') : name;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const safe = Date.now() + '_' + fixName(file.originalname).replace(/[^\w.\-가-힣]/g, '_');
      cb(null, safe);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const clean = (v, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// 요청을 보낸 사원. empNo 가 없으면 기본 로그인 사원, 엑셀 DB에 없는 사번이면 404.
function resolveEmp(empNo) {
  const emp = empNo ? getEmployee(empNo) : getDefaultUser();
  if (!emp) throw httpError(404, `사원 DB에 없는 사번입니다: ${empNo}`);
  return emp;
}

function certFromBody(body = {}) {
  return {
    course_name: clean(body.courseName),
    issuer: clean(body.issuer),
    completed_date: clean(body.completedDate, 20),
    ocr_text: clean(body.ocrText, 8000),
  };
}

function recordSubmission(taskId, file, cert, matchMethod) {
  transaction(() => {
    db.prepare(`UPDATE tasks SET status='done', updated_at=datetime('now','+9 hours') WHERE id=?`).run(taskId);
    db.prepare(`
      INSERT INTO submissions (task_id, file_name, file_path, course_name, issuer, completed_date, ocr_text, match_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      file ? fixName(file.originalname) : null,
      file ? path.relative(path.join(__dirname, '..'), file.path) : null,
      cert.course_name, cert.issuer, cert.completed_date, cert.ocr_text, matchMethod || 'manual'
    );
  })();
}

function attachCert(task) {
  const s = db.prepare(`
    SELECT file_name, course_name, issuer, completed_date, match_method, submitted_at
    FROM submissions WHERE task_id=? ORDER BY id DESC LIMIT 1
  `).get(task.id);
  task.cert = s && (s.course_name || s.issuer || s.completed_date) ? { ...s } : null;
  return task;
}

function withFreshStatus(task) {
  const status = recomputeStatus(task.due, task.status);
  if (status !== task.status) {
    db.prepare(`UPDATE tasks SET status=?, updated_at=datetime('now','+9 hours') WHERE id=?`).run(status, task.id);
    task.status = status;
  }
  return attachCert(task);
}

const getTask = (id) => db.prepare('SELECT * FROM tasks WHERE id=?').get(id);

// 라우트 핸들러 공통 예외 처리 (httpError 의 status 를 그대로 응답)
const wrap = (fn) => (req, res, next) => {
  try { fn(req, res, next); } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
};

// GET /api/tasks?empNo=&cat=&status=  — 해당 사원의 업무 체크리스트
router.get('/', wrap((req, res) => {
  const emp = resolveEmp(req.query.empNo);
  const { cat, status } = req.query;
  let sql = 'SELECT * FROM tasks WHERE emp_no=?';
  const params = [emp.empNo];
  if (cat) { sql += ' AND cat=?'; params.push(cat); }
  if (status) { sql += ' AND status=?'; params.push(status); }
  sql += " ORDER BY (status='done') ASC, due ASC, id ASC";
  res.json(db.prepare(sql).all(...params).map(withFreshStatus));
}));

router.get('/:id', wrap((req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  res.json(withFreshStatus(task));
}));

// POST /api/tasks/bulk — 부서(또는 전체) 사원 전원에게 새 제출요청을 배포한다. 사원별로 업무 1행씩 생성.
//   { tasks: [{ title, cat, due(YYYY-MM-DD), targetDept('전체'|부서명), dept?(요청부서), raw? }, ...] }
router.post('/bulk', wrap((req, res) => {
  const list = (req.body && req.body.tasks) || [];
  if (!Array.isArray(list) || list.length === 0) {
    return res.status(400).json({ error: 'tasks 배열이 필요합니다.' });
  }
  if (list.length > 20) return res.status(400).json({ error: '한 번에 최대 20건까지 발송할 수 있습니다.' });
  list.forEach((r, i) => {
    if (!r || !r.targetDept) throw httpError(400, `${i + 1}번째 항목: targetDept(대상 부서 또는 '전체')가 필요합니다.`);
  });

  const requests = list.map((r) =>
    createRequest({ title: r.title, cat: r.cat, dept: r.dept, due: r.due, targetDept: r.targetDept, raw: r.raw })
  );
  res.status(201).json({ created: requests.reduce((n, r) => n + r.count, 0), requests });
}));

// POST /api/tasks/cert-upload  (multipart)
//   empNo?, file?, courseName?, issuer?, completedDate?, ocrText?, taskId?
// 프론트(Tesseract.js)가 추출한 값으로 '해당 사원의' 미제출 교육 업무를 매칭해 제출완료 처리.
// 모호하면 422 + candidates, 프론트가 taskId 를 지정해 다시 호출한다.
router.post('/cert-upload', upload.single('file'), wrap((req, res) => {
  const body = req.body || {};
  const emp = resolveEmp(clean(body.empNo, 30));
  const cert = certFromBody(body);
  const fileName = req.file ? fixName(req.file.originalname) : clean(body.fileName) || '';

  if (!req.file && !cert.ocr_text && !cert.course_name) {
    return res.status(400).json({ error: '파일 또는 OCR 추출 결과(courseName/ocrText)가 필요합니다.' });
  }

  const pending = db.prepare(`SELECT * FROM tasks WHERE cat='edu' AND status!='done' AND emp_no=?`).all(emp.empNo);
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

  recordSubmission(task.id, req.file, cert, matchedBy);
  res.json({ matchedTask: withFreshStatus(getTask(task.id)), matchedBy, score, cert, fileName });
}));

// PATCH /api/tasks/:id  { title?, dept?, assignee?, due?, status? } - 기한 연기 등 수정
router.patch('/:id', wrap((req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });

  const fields = ['title', 'dept', 'assignee', 'due', 'status', 'cat'];
  const updates = {};
  fields.forEach((f) => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: '수정할 필드가 없습니다.' });
  }
  const setClause = Object.keys(updates).map((k) => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE tasks SET ${setClause}, updated_at=datetime('now','+9 hours') WHERE id=@id`)
    .run({ ...updates, id: req.params.id });

  res.json(getTask(req.params.id));
}));

// POST /api/tasks/:id/submit  (multipart 또는 JSON, 수료증 필드 선택적 포함) - 직원 "제출완료"
// 이미 제출된 업무는 다시 처리하지 않고 현재 상태를 그대로 돌려준다(중복 제출 이력 방지).
router.post('/:id/submit', upload.single('file'), wrap((req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });

  if (task.status !== 'done') recordSubmission(task.id, req.file, certFromBody(req.body), 'manual');
  res.json(withFreshStatus(getTask(task.id)));
}));

router.delete('/:id', wrap((req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'task not found' });
  res.status(204).end();
}));

module.exports = router;
