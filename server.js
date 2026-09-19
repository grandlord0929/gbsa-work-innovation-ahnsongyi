const path = require('path');
const express = require('express');
const cors = require('cors');
const { basicAuth, securityHeaders, assertProductionSafe } = require('./lib/security');

assertProductionSafe(); // 운영 환경에서 접근 암호 없이 공개되는 것을 차단

require('./db'); // 스키마 생성/마이그레이션
const { seedIfEmpty } = require('./lib/assign');

// 최초 실행 시 사원 DB(엑셀) 기준으로 초기 업무를 배포한다. 엑셀이 없어도 서버는 뜨고, 오류 원인만 로그로 남긴다.
try {
  if (seedIfEmpty()) console.log('초기 시드 데이터를 생성했습니다.');
} catch (error) {
  console.error('❌ 초기 시드 실패 (employees.xlsx 확인):', error.message);
}

const tasksRouter = require('./routes/tasks');
const analyzeRouter = require('./routes/analyze');
const statsRouter = require('./routes/stats');
const chatRouter = require('./routes/chat');

const app = express();
const PORT = process.env.PORT || 4000; // Render/Railway 등은 PORT 를 주입한다

app.disable('x-powered-by');
app.use(securityHeaders);
// 프론트와 API가 같은 출처이므로 CORS 는 기본 비활성. 다른 도메인에서 호출해야 할 때만 CORS_ORIGIN(쉼표 구분) 지정.
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) }));
if (process.env.BASIC_AUTH_PASS) {
  app.use(basicAuth({ user: process.env.BASIC_AUTH_USER || 'gbsa', pass: process.env.BASIC_AUTH_PASS }));
}
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'gbsa-reminder-backend' }));
// ==========================================
// [추가] 엑셀 사원 DB 조회를 위한 API 엔드포인트
// ==========================================
const { getEmployees, findEmployee } = require('./lib/excelDb');

// 1. 전체 사원 목록 조회 API
app.get('/api/employees', (req, res) => {
  try {
    const data = getEmployees();
    res.json({ success: true, count: data.length, employees: data });
  } catch (error) {
    console.error('❌ /api/employees 에러:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. 사원 이름/사번/부서 검색 API (예: /api/employees/search?q=홍길동)
app.get('/api/employees/search', (req, res) => {
  try {
    const data = findEmployee(String(req.query.q || '').trim());
    res.json({ success: true, count: data.length, employees: data });
  } catch (error) {
    console.error('❌ /api/employees/search 에러:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. 직원 모드 로그인 사원 (홍길동이 사원 DB에 있으면 홍길동, 없으면 바이오센터 첫 사원)
app.get('/api/me', (req, res) => {
  try {
    const me = require('./lib/excelDb').getDefaultUser();
    if (!me) return res.status(404).json({ error: '사원 DB에 사원이 없습니다.' });
    res.json(me);
  } catch (error) {
    console.error('❌ /api/me 에러:', error);
    res.status(500).json({ error: error.message });
  }
});

app.use('/api/admin', require('./routes/admin'));
app.use('/api/tasks', tasksRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/stats', statsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/demo', require('./routes/demo'));

// 프론트엔드(public/index.html)를 같은 서버에서 정적으로 서빙
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GBSA 리마인더 백엔드 서버 실행 중: 포트 ${PORT} (http://localhost:${PORT})`);
  console.log(`접근 암호(Basic Auth): ${process.env.BASIC_AUTH_PASS ? '사용' : '미사용 (로컬 개발용)'}`);
  console.log(`헬스체크: /api/health`);
});
