// 진단용 카나리 #1: 의존성이 전혀 없는 최소 함수. GET /api/ping
// 이것도 실패하면 코드가 아니라 배포 설정/플랫폼 문제이고, 성공하면 함수 실행 환경 자체는 정상이다. (문제 해결 후 삭제해도 됨)
module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    canary: 'ping',
    node: process.version,
    region: process.env.VERCEL_REGION || null,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null,
    commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE ? process.env.VERCEL_GIT_COMMIT_MESSAGE.slice(0, 60) : null,
  }));
};
