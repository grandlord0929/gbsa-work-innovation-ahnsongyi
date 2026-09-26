// 백업 데이터(seed-data/*.csv)로 Supabase 기본 데이터를 교체하는 시더.
//   processed_education_submissions.csv → tasks(cat=edu) + 제출 이력(submissions)
//        제출완료 → done / 확인중 → 관리자 확인 대기(review=pending) / 반려 → 재제출 요청(review=rejected, 사유=admin_memo) / 미제출 → 이력 없음
//   raw_education_results.csv           → 제출 이력의 교육기관(issuer)·수료일(completed_date) (emp_id + 교육명으로 조인)
//   processed_attendance_anomalies.csv  → tasks(cat=service, 복무 누락 소명)   조치완료 → done, 미조치/검토중 → 미제출
//   processed_audit_tasks.csv           → tasks(cat=doc, 타 부서 요구자료/감사)  제출완료 → done
//   사원(employees)은 교육·복무 파일의 emp_id/emp_name/dept_name 에서 모은다(요구자료 담당자는 이름으로 매칭).
//   CSV 의 나머지 컬럼(문서번호, 감사유형, OCR 신뢰도, 소명사유 등)은 tasks.source_raw(JSON)에 원본 그대로 보관한다.
// 스키마(DDL)는 바꾸지 않는다. scripts/seedSupabase.js 와 POST /api/demo/reset 이 사용한다.
const fs = require('fs');
const path = require('path');
const { getSupabase, must, insertChunks } = require('./supabaseClient');
const { recomputeStatus } = require('./dday');
const { addDays } = require('./time');
const { formatMethod } = require('./review');

const DIR = path.join(__dirname, '..', 'seed-data');
const FILES = {
  edu: 'processed_education_submissions.csv',
  eduLms: 'raw_education_results.csv',
  attend: 'processed_attendance_anomalies.csv',
  tasks: 'processed_audit_tasks.csv',
};
const EDU_REQUESTER = '인사총무팀';   // CSV 에 요청부서가 없는 교육/복무 업무의 요청부서
const ATTEND_DUE_DAYS = 7;          // 복무 소명 마감 = 알림 발송일 + 7일
const kst = (s) => (s ? `${s.replace(' ', 'T')}+09:00` : undefined);   // 'YYYY-MM-DD HH:MM:SS'(KST) → timestamptz

// RFC4180 수준의 간단한 CSV 파서 (BOM, 따옴표 필드, CRLF 지원)
function parseCsv(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some((v) => v !== '')) rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const readCsv = (name) => parseCsv(fs.readFileSync(path.join(DIR, name), 'utf8'));
const csvAvailable = () => Object.values(FILES).every((f) => fs.existsSync(path.join(DIR, f)));

// 사용할 시드 원본: SEED_SOURCE=synthetic 이면 가상 200명, 아니면 CSV 가 있을 때 CSV
const useCsv = () => process.env.SEED_SOURCE !== 'synthetic' && csvAvailable();

// CSV → { employees, tasks } 순수 변환 (DB 접근 없음)
function buildSeed() {
  const edu = readCsv(FILES.edu), lms = readCsv(FILES.eduLms), attend = readCsv(FILES.attend), reqs = readCsv(FILES.tasks);
  const lmsBy = new Map(lms.map((r) => [`${r.emp_id}|${r.course_name}`, r]));

  const emps = new Map();   // emp_no → { emp_no, name, dept }
  for (const r of [...edu, ...attend]) if (r.emp_id && !emps.has(r.emp_id)) emps.set(r.emp_id, { emp_no: r.emp_id, name: r.emp_name, dept: r.dept_name });
  const byName = new Map([...emps.values()].map((e) => [e.name, e]));
  for (const r of reqs) if (!byName.has(r.assignee_name)) throw new Error(`${FILES.tasks}: 사원 명부에 없는 담당자 '${r.assignee_name}' (${r.task_id})`);

  const status = (due, done) => (done ? 'done' : recomputeStatus(due, 'normal'));
  const tasks = []; // { request: {title,cat,requester_dept,target_dept,due}, row, sub? }
  const eduReq = new Map();

  for (const r of edu) {
    const e = emps.get(r.emp_id), done = r.submission_status === '제출완료';
    const key = `${r.edu_course}|${r.due_date}`;
    if (!eduReq.has(key)) eduReq.set(key, { title: r.edu_course, cat: 'edu', requester_dept: EDU_REQUESTER, target_dept: '전체', due: r.due_date });
    const lm = lmsBy.get(`${r.emp_id}|${r.edu_course}`);
    const review = { 확인중: { review: 'pending' }, 반려: { review: 'rejected', reason: r.admin_memo } }[r.submission_status];
    tasks.push({
      request: eduReq.get(key),
      row: { cat: 'edu', title: r.edu_course, dept: EDU_REQUESTER, assignee: e.name, due: r.due_date, status: status(r.due_date, done), emp_no: e.emp_no, emp_name: e.name, emp_dept: e.dept, source_raw: JSON.stringify({ ...r, lms: lm || null }) },
      sub: (done || review) && r.file_path
        ? {
          file_name: path.basename(r.file_path), course_name: r.edu_course, issuer: lm?.institution || null, completed_date: lm?.study_end_date || null,
          match_method: formatMethod(done ? { base: 'ocr' } : { base: 'ocr', nameConfirmed: true, ...review }),
          submitted_at: kst(r.submitted_at),
        }
        : null,
    });
  }

  for (const r of attend) {
    const e = emps.get(r.emp_id), done = r.status === '조치완료';
    const due = addDays(r.notified_at.slice(0, 10), ATTEND_DUE_DAYS);
    const title = `출퇴근 ${r.anomaly_type} 소명서 제출 (${r.work_date})`;
    tasks.push({
      request: { title, cat: 'service', requester_dept: EDU_REQUESTER, target_dept: `${e.dept} (개별)`, due },
      row: { cat: 'service', title, dept: EDU_REQUESTER, assignee: e.name, due, status: status(due, done), emp_no: e.emp_no, emp_name: e.name, emp_dept: e.dept, source_raw: JSON.stringify(r) },
      sub: null,
    });
  }

  for (const r of reqs) {
    const e = byName.get(r.assignee_name), done = r.submission_status === '제출완료';
    tasks.push({
      request: { title: r.task_title, cat: 'doc', requester_dept: r.requesting_dept, target_dept: r.target_dept, due: r.due_date },
      row: { cat: 'doc', title: r.task_title, dept: r.requesting_dept, assignee: e.name, due: r.due_date, status: status(r.due_date, done), emp_no: e.emp_no, emp_name: e.name, emp_dept: e.dept, source_raw: JSON.stringify(r) },
      sub: null,
    });
  }
  return { employees: [...emps.values()], tasks };
}

// 기존 사원/업무/제출/요청/대화 이력을 모두 지우고 CSV 데이터로 교체한다.
async function seedFromCsv() {
  const sb = getSupabase();
  const { clearTasks } = require('./seedData');
  const { employees, tasks } = buildSeed();

  await clearTasks();
  must(await sb.from('employees').delete().neq('emp_no', ''), 'employees 삭제');
  await insertChunks('employees', employees, 'employees 시드');

  // 요청 1건씩 생성(같은 요청은 공유) → id 매핑
  const reqIds = new Map();
  for (const t of tasks) {
    if (reqIds.has(t.request)) continue;
    const { title, cat, requester_dept, target_dept, due } = t.request;
    const ins = must(await sb.from('requests').insert({ title, cat, requester_dept, target_dept, due }).select('id'), 'requests 생성');
    reqIds.set(t.request, Number(ins[0].id));
  }

  const inserted = must(await sb.from('tasks').insert(tasks.map((t) => ({ ...t.row, request_id: reqIds.get(t.request) }))).select('id'), 'tasks 시드');
  const subs = tasks.map((t, i) => (t.sub ? { ...t.sub, task_id: Number(inserted[i].id) } : null)).filter(Boolean);
  if (subs.length) await insertChunks('submissions', subs, 'submissions 시드');
  return { employees: employees.length, tasks: tasks.length, submissions: subs.length };
}

module.exports = { parseCsv, buildSeed, seedFromCsv, csvAvailable, useCsv };
