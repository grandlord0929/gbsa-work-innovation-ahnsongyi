// SQLite 연결 및 스키마 초기화. Node.js 내장 node:sqlite(DatabaseSync) 사용 -
// 네이티브 모듈 빌드(node-gyp)가 필요 없어 별도 설치 없이 바로 동작한다. (Node 22.5+ 필요)
//
// 데이터 모델: requests(제출요청 1건) 1 ── N tasks(사원별 업무 1행)
//   tasks 한 행 = "특정 사원(emp_no)에게 할당된 업무". 직원 화면은 자기 행만, 관리자 화면은 전체 행을 집계한다.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR: 기본 ./data, Vercel 은 /tmp/gbsa-data, 영구 디스크가 있으면 DATA_DIR 환경변수로 지정 (lib/paths.js)
const { DATA_DIR } = require('./lib/paths');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'gbsa.db');
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  cat TEXT NOT NULL,
  requester_dept TEXT NOT NULL,
  target_dept TEXT NOT NULL,
  due TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat TEXT NOT NULL CHECK(cat IN ('service','edu','doc')),
  title TEXT NOT NULL,
  dept TEXT NOT NULL,
  assignee TEXT NOT NULL DEFAULT '전체 직원',
  due TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'normal' CHECK(status IN ('normal','warn','urgent','overdue','done')),
  source_raw TEXT,
  emp_no TEXT,
  emp_name TEXT,
  emp_dept TEXT,
  request_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name TEXT,
  file_path TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
`);

// ---- 기존 DB 파일 자동 마이그레이션 ----
function addColumns(table, cols) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  cols.forEach(([name, type]) => {
    if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  });
}
addColumns('submissions', [
  ['course_name', 'TEXT'], ['issuer', 'TEXT'], ['completed_date', 'TEXT'], ['ocr_text', 'TEXT'], ['match_method', 'TEXT'],
]);
addColumns('tasks', [['emp_no', 'TEXT'], ['emp_name', 'TEXT'], ['emp_dept', 'TEXT'], ['request_id', 'INTEGER']]);

db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_emp ON tasks(emp_no)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_req ON tasks(request_id)');

// 2단계 이전(사원 구분 없는 공용 업무) 데이터가 남아 있으면 백업 후 비운다 → 서버 시작 시 새 구조로 다시 시드된다.
const legacy = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE emp_no IS NULL').get().n;
if (legacy > 0) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const backup = path.join(DATA_DIR, `gbsa.legacy-${Date.now()}.db`);
  fs.copyFileSync(DB_FILE, backup);
  db.exec('DELETE FROM tasks');
  console.warn(`[db] 사원별 구조 이전 데이터 ${legacy}건을 백업(${path.basename(backup)}) 후 초기화했습니다.`);
}

// 간단한 트랜잭션 헬퍼 (better-sqlite3의 db.transaction()과 동일한 용도)
function transaction(fn) {
  return (arg) => {
    db.exec('BEGIN');
    try {
      const result = fn(arg);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
}

module.exports = { db, DATA_DIR, UPLOAD_DIR, transaction };
