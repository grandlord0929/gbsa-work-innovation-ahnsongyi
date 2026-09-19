// Vercel 서버리스 함수 진입점. vercel.json 의 rewrites 가 /api/* 요청을 이 함수로 보낸다.
// Express 앱은 함수형 핸들러(req, res)이므로 그대로 export 하면 된다.
module.exports = require('../server');
