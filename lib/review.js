// 수료증 "관리자 확인" 상태 표기.
// 스키마 변경(DDL) 없이 쓰기 위해 submissions.match_method(text) 컬럼에 세미콜론으로 구분한 태그로 저장한다.
//   예) keyword;name-confirmed;review=pending;file=12/1700000000-ab12.png
//       keyword;name-confirmed;review=rejected;file=...;reason=%EC%9D%B4%EB%A6%84...
// review: pending(관리자 확인 대기) → approved(확인·제출 완료) | rejected(재제출 요청) | superseded(재업로드로 대체됨)
const REVIEW_STATES = ['pending', 'approved', 'rejected', 'superseded'];

function parseMethod(str) {
  const parts = String(str || '').split(';').filter(Boolean);
  const out = { base: parts[0] && !parts[0].includes('=') && parts[0] !== 'name-confirmed' ? parts[0] : '', nameConfirmed: false, review: null, file: null, reason: '' };
  for (const p of parts) {
    if (p === 'name-confirmed') out.nameConfirmed = true;
    else if (p.startsWith('review=') && REVIEW_STATES.includes(p.slice(7))) out.review = p.slice(7);
    else if (p.startsWith('file=')) out.file = p.slice(5);
    else if (p.startsWith('reason=')) { try { out.reason = decodeURIComponent(p.slice(7)); } catch { out.reason = ''; } }
  }
  return out;
}

function formatMethod({ base = 'manual', nameConfirmed = false, review = null, file = null, reason = '' } = {}) {
  const parts = [base || 'manual'];
  if (nameConfirmed) parts.push('name-confirmed');
  if (review) parts.push(`review=${review}`);
  if (file) parts.push(`file=${file}`);
  if (reason) parts.push(`reason=${encodeURIComponent(String(reason).slice(0, 200))}`);
  return parts.join(';');
}

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'application/pdf': 'pdf',
};
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', pdf: 'application/pdf' };

module.exports = { parseMethod, formatMethod, EXT_BY_MIME, MIME_BY_EXT, REVIEW_STATES };
