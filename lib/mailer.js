// 제출 요청 안내 이메일 (Resend REST API, HTTPS 443 — SMTP 포트 차단과 무관, 무료 플랜 사용).
//   필수 환경변수: RESEND_API_KEY, REMINDER_TEST_RECIPIENTS(시연용 수신 주소 1~3개, 쉼표 구분)
//   선택: SENDER_EMAIL(기본 onboarding@resend.dev), APP_URL(메일 버튼이 여는 배포 주소)
// 시연 안전장치: 사원 이메일로는 절대 보내지 않고, 오직 REMINDER_TEST_RECIPIENTS(최대 3개)로만 발송한다.
// ※ Resend 무료 플랜에서 도메인을 인증하지 않으면 발신은 onboarding@resend.dev, 수신은 가입한 본인 이메일만 가능하다.
const RESEND_URL = 'https://api.resend.com/emails'; // RESEND_API_URL 로 재정의 가능(로컬 모의 서버 시험용)
const SENDER_NAME = '경기도경제과학진흥원 지능형 통합 업무 리마인더';
const MAX_RECIPIENTS = 3;
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

let fetchImpl = null; // 테스트에서 가짜 전송을 주입
const __setFetchForTests = (f) => { fetchImpl = f; };

const clean = (v) => String(v || '').trim().replace(/^(['"])(.*)\1$/s, '$2').trim();

function recipients(env = process.env) {
  const all = clean(env.REMINDER_TEST_RECIPIENTS).split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)].filter((e) => EMAIL_RE.test(e)).slice(0, MAX_RECIPIENTS);
}
const senderEmail = (env = process.env) => (EMAIL_RE.test(clean(env.SENDER_EMAIL)) ? clean(env.SENDER_EMAIL) : 'onboarding@resend.dev');

// 설정 상태(값은 노출하지 않음)
function status(env = process.env) {
  const to = recipients(env);
  const missing = [];
  if (!clean(env.RESEND_API_KEY)) missing.push('RESEND_API_KEY');
  if (to.length === 0) missing.push('REMINDER_TEST_RECIPIENTS');
  return { configured: missing.length === 0, missing, recipientCount: to.length, sender: senderEmail(env) };
}

const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, '$1***$2');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 배포 주소: APP_URL > 요청의 Host(Vercel 은 x-forwarded-host/proto 를 준다)
function appUrl(req, env = process.env) {
  let fixed = clean(env.APP_URL).replace(/\/+$/, '');
  if (fixed && !/^https?:\/\//i.test(fixed)) fixed = `https://${fixed}`; // 스킴을 빼고 적어도 https 로 간주
  if (/^https?:\/\/[^\s/]+/i.test(fixed)) return fixed;
  const host = String((req && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim();
  const proto = String((req && req.headers['x-forwarded-proto']) || (req && req.secure ? 'https' : 'http')).split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

const dLabel = (n) => (n < 0 ? `기한 초과 (D+${-n})` : n === 0 ? '오늘 마감 (D-DAY)' : `D-${n}`);

const TH = 'padding:10px 14px;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;text-align:left;white-space:nowrap';
const TD = 'padding:12px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;line-height:1.5';
const ddayColor = (n) => (n < 0 ? '#991b1b' : n <= 3 ? '#92400e' : '#1d4ed8');

// 공통 뼈대: 헤더(기관명) / 인사말 / 표 / 제출 버튼 / 시연 안내 푸터
function shell({ subject, heading, introHtml, head, rows, note, url }) {
  const button = url
    ? `<a href="${esc(url)}" style="display:inline-block;background:#1e3a8a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:8px">서류 제출하러 가기</a>
       <div style="margin-top:10px;font-size:12px;color:#6b7280">버튼이 열리지 않으면 주소를 복사해 접속하세요: <a href="${esc(url)}" style="color:#2563eb">${esc(url)}</a></div>`
    : '';
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f0f2f6;font-family:'Malgun Gothic','Apple SD Gothic Neo',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f6;padding:28px 12px"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <tr><td style="background:#1e3a8a;padding:22px 28px">
      <div style="font-size:12px;color:#bfdbfe;letter-spacing:.3px">GYEONGGI BUSINESS &amp; SCIENCE ACCELERATOR</div>
      <div style="font-size:19px;font-weight:700;color:#ffffff;margin-top:4px">경기도경제과학진흥원</div>
      <div style="font-size:13px;color:#dbeafe;margin-top:2px">지능형 통합 업무 리마인더</div>
    </td></tr>
    <tr><td style="padding:28px 28px 8px">
      <div style="font-size:17px;font-weight:700;color:#111827">${esc(heading)}</div>
      <p style="margin:14px 0 0;font-size:14px;color:#374151;line-height:1.7">${introHtml}</p>
    </td></tr>
    <tr><td style="padding:14px 28px 4px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden">
        <tr style="background:#f9fafb">${head.map((h) => `<th align="left" style="${TH}">${esc(h)}</th>`).join('')}</tr>${rows}
      </table>
      <div style="margin-top:10px;font-size:12px;color:#6b7280">${note}</div>
    </td></tr>
    <tr><td align="center" style="padding:24px 28px 30px">${button}</td></tr>
    <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 28px;font-size:12px;color:#6b7280;line-height:1.7">
      본 메일은 경기도경제과학진흥원 지능형 통합 업무 리마인더 시스템에서 발송되었습니다.<br>
      <span style="color:#9ca3af">※ 시연 환경입니다. 지정된 테스트 주소로만 발송되며, 사원 본인에게는 발송되지 않습니다. 회신하지 마세요.</span>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// 사원별 미제출 업무 안내. tasks: [{ title, due, dday(number) }] (마감 임박 순 정렬 가정)
function buildReminderEmail({ name, dept, empNo, tasks, url }) {
  const first = tasks[0];
  const subject = `[GBSA 업무 리마인더] '${first.title}' 제출 기한 안내${tasks.length > 1 ? ` 외 ${tasks.length - 1}건` : ''}`;
  const rows = tasks.map((t) => `
        <tr><td style="${TD}">${esc(t.title)}</td><td style="${TD};white-space:nowrap">${esc(t.due)}</td><td style="${TD};font-size:13px;white-space:nowrap;font-weight:700;color:${ddayColor(t.dday)}">${esc(dLabel(t.dday))}</td></tr>`).join('');
  const html = shell({
    subject, heading: '제출 기한 안내',
    introHtml: `<b>${esc(name)}</b> 님(${esc(dept)}), 안녕하세요.<br>아래 업무가 아직 제출되지 않았습니다. 마감일 내에 제출해 주시기 바랍니다.`,
    head: ['미제출 업무', '제출 마감일', '상태'], rows, note: `수신자 사번: ${esc(empNo)}`, url,
  });
  const text = [
    '[경기도경제과학진흥원 지능형 통합 업무 리마인더] 제출 기한 안내', '',
    `${name} 님(${dept}), 아래 업무가 아직 제출되지 않았습니다.`,
    ...tasks.map((t) => `- ${t.title} / 마감 ${t.due} / ${dLabel(t.dday)}`), '',
    url ? `제출하러 가기: ${url}` : '', '', '※ 시연 환경: 지정된 테스트 주소로만 발송됩니다.',
  ].join('\n');
  return { subject, html, text };
}

const CAT_LABEL = { service: '복무 누락 소명', edu: '교육 수료증 제출', doc: '요구자료 제출' };

// 관리자가 새 제출 요청을 발송했을 때의 안내(요청 1건당 1통). 대상: 부서(또는 전체) 사원 count 명.
function buildRequestEmail({ title, cat, due, dday, requesterDept, targetDept, count, url }) {
  const subject = `[GBSA 업무 리마인더] '${title}' 제출 기한 안내`;
  const target = targetDept === '전체' ? '전체 부서' : targetDept;
  const rows = `
        <tr><td style="${TD}">${esc(title)}<div style="font-size:12px;color:#6b7280;margin-top:2px">${esc(CAT_LABEL[cat] || '')}</div></td><td style="${TD};white-space:nowrap">${esc(requesterDept)}</td><td style="${TD};white-space:nowrap">${esc(due)}</td><td style="${TD};font-size:13px;white-space:nowrap;font-weight:700;color:${ddayColor(dday)}">${esc(dLabel(dday))}</td></tr>`;
  const html = shell({
    subject, heading: '제출 요청 안내',
    introHtml: `<b>${esc(target)}</b> 소속 사원 <b>${esc(count)}명</b>에게 새 제출 요청이 등록되었습니다.<br>각 사원의 업무 체크리스트에 표시되며, 마감일 내에 제출해 주시기 바랍니다.`,
    head: ['제출 요청 업무', '요청 부서', '제출 마감일', '상태'], rows, note: `대상: ${esc(target)} · ${esc(count)}명`, url,
  });
  const text = [
    '[경기도경제과학진흥원 지능형 통합 업무 리마인더] 제출 요청 안내', '',
    `${target} 소속 사원 ${count}명에게 새 제출 요청이 등록되었습니다.`,
    `- 업무: ${title} (${CAT_LABEL[cat] || ''})`, `- 요청 부서: ${requesterDept}`, `- 제출 마감일: ${due} / ${dLabel(dday)}`, '',
    url ? `제출하러 가기: ${url}` : '', '', '※ 시연 환경: 지정된 테스트 주소로만 발송됩니다.',
  ].join('\n');
  return { subject, html, text };
}

// Resend 로 발송. 성공 시 { id, to(마스킹) }. 실패는 status 가 있는 Error.
async function sendMail({ subject, html, text }, env = process.env) {
  const st = status(env);
  if (!st.configured) throw Object.assign(new Error(`이메일 발송 설정이 없습니다. 환경변수 ${st.missing.join(', ')} 을(를) 설정하세요.`), { status: 503, code: 'EMAIL_NOT_CONFIGURED' });
  const to = recipients(env);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  let res;
  try {
    res = await (fetchImpl || fetch)(clean(env.RESEND_API_URL) || RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clean(env.RESEND_API_KEY)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${SENDER_NAME} <${senderEmail(env)}>`, to, subject, html, text }),
      signal: ctl.signal,
    });
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? '이메일 서버 응답 시간이 초과되었습니다.' : '이메일 서버에 연결하지 못했습니다.'), { status: 502, code: 'EMAIL_UNREACHABLE' });
  } finally { clearTimeout(timer); }

  let body = {}; try { body = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    // API 키/수신자 제한(무료 플랜) 등의 사유를 그대로 전달하되 키 값은 포함하지 않는다
    throw Object.assign(new Error(`이메일 발송 실패(${res.status}): ${String(body.message || body.name || '알 수 없는 오류').slice(0, 200)}`), { status: 502, code: 'EMAIL_REJECTED' });
  }
  return { id: body.id || null, to: to.map(maskEmail) };
}

module.exports = { status, recipients, senderEmail, buildReminderEmail, buildRequestEmail, sendMail, appUrl, maskEmail, __setFetchForTests, SENDER_NAME };
