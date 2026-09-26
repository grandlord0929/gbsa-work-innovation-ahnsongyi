// 관리자가 제출 요청을 발송(/api/tasks/bulk)할 때 보내는 안내 메일: 요청 1건당 1통, 시연용 수신 주소로만.
// 메일은 부가 알림이므로 실패해도 업무 발송(DB 반영)은 성공으로 처리하고, 결과만 응답에 담아 화면에 알린다.
const mailer = require('./mailer');
const { todayStr, diffDays, fmtKst } = require('./time');

const MAX_MAILS = 10;                                            // 1회 발송당 최대 메일 수(무료 플랜 한도/응답 시간 보호)
const GAP_MS = process.env.NODE_ENV === 'test' ? 0 : 600;        // Resend 초당 요청 제한 회피
const sleep = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

// items: createRequest 결과 + requesterDept [{ title, cat, due, requesterDept, targetDept, count }]
async function notifyRequests(req, items) {
  const st = mailer.status();
  if (!st.configured) {
    return { status: 'not_configured', sent: 0, failed: 0, skipped: items.length, results: [], message: `이메일 설정이 없어 안내 메일은 보내지 않았습니다. (${st.missing.join(', ')})` };
  }
  const url = mailer.appUrl(req);
  const today = todayStr();
  const results = [];
  let to = [];
  for (const [i, it] of items.entries()) {
    if (i >= MAX_MAILS) { results.push({ title: it.title, ok: false, skipped: true, error: `한 번에 최대 ${MAX_MAILS}통까지만 발송합니다.` }); continue; }
    try {
      if (i > 0) await sleep(GAP_MS);
      const mail = mailer.buildRequestEmail({ ...it, dday: diffDays(today, it.due), url: url ? `${url}/` : '' });
      const r = await mailer.sendMail(mail);
      to = r.to;
      results.push({ title: it.title, ok: true, messageId: r.id, subject: mail.subject });
    } catch (e) {
      results.push({ title: it.title, ok: false, error: e.message });
    }
  }
  const sent = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.length - sent - skipped;
  return { status: failed ? (sent ? 'partial' : 'failed') : sent ? 'sent' : 'skipped', sent, failed, skipped, sentAt: sent ? fmtKst(new Date()) : null, to, results };
}

module.exports = { notifyRequests, MAX_MAILS };
