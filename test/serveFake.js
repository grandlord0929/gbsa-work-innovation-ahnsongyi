// UI 확인용 개발 서버: 실제 Supabase 대신 인메모리 가짜 DB(test/fakeSupabase.js)를 주입해 앱을 띄운다.  npm run dev:fake
// 실제 데이터를 건드리지 않고 화면/OCR 흐름을 시험할 수 있다. 서버를 끄면 데이터는 사라진다.
delete process.env.BASIC_AUTH_PASS;
process.env.NODE_ENV = 'development';

const { createFakeSupabase } = require('./fakeSupabase');
const client = require('../lib/supabaseClient');
const data = require('../lib/data');
const seed = require('../lib/seedData');

(async () => {
  client.__setClientForTests(createFakeSupabase());
  await seed.seedEmployees();
  data.invalidateEmployees();
  await seed.seedTasks((await data.listEmployees()).map((e) => ({ emp_no: e.empNo, name: e.name, dept: e.dept })));
  const port = Number(process.argv[2]) || 4420;
  require('../server').listen(port, () => console.log(`가짜 DB 로 실행 중: http://localhost:${port}  (사원 200명, 업무 801건, 종료 시 데이터 사라짐)`));
})();
