// 제출 요청 메일 발송 이력(reminder_logs). 테이블이 아직 없으면(schema.sql 미적용) 조용히 건너뛰고 응답에만 발송 일시를 담는다.
const { getSupabase } = require('./supabaseClient');

async function logReminder({ empNo, subject, taskCount, providerId, sentBy }) {
  try {
    const r = await getSupabase().from('reminder_logs')
      .insert({ emp_no: empNo, subject: String(subject).slice(0, 300), task_count: taskCount, provider_id: providerId || null, sent_by: sentBy || null })
      .select('id,sent_at');
    if (r.error) throw new Error(r.error.message);
    return { persisted: true, id: Number(r.data[0].id) };
  } catch (e) {
    console.warn('[reminder] 발송 이력 저장 건너뜀(reminder_logs 테이블 확인):', e.message);
    return { persisted: false };
  }
}

module.exports = { logReminder };
