// 변형 B: 일반 함수 + listen 속성 (Express 앱처럼 보이게 해 Vercel req/res 헬퍼 적용을 피하는 방식). GET /api/app-listen
const handler = (req, res) => require('../lib/handler')(req, res);
handler.listen = () => { throw new Error('서버리스 환경에서는 listen 하지 않습니다.'); };
module.exports = handler;
