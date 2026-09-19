// Express 4 는 async 핸들러의 예외를 자동으로 잡지 않으므로 감싸서 status 가 있는 오류는 그대로 응답한다.
const wrap = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res, next))
    .catch((e) => {
      if (e && e.status) return res.status(e.status).json({ error: e.message });
      return next(e);
    });

module.exports = { wrap };
