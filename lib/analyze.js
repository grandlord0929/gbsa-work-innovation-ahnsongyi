// 공문/OCR 원문 텍스트에서 제출요청 항목(업무명·마감일·유형)을 추출한다. POST /api/analyze 가 사용한다.
//  - 업무명: 본문의 '요구자료명 / 과정명 / 교육명 / 요구사항 / 요청사항' 키워드 뒤(콜론 또는 공백 다음) 내용. 문서 제목·첫 줄은 쓰지 않는다.
//  - 마감일: '제출기한 / 제출 기한 / 마감일자 / 마감일 / 기한' 키워드 뒤에 명시된 날짜만. 작성일자·시행일자 등은 무시한다.
//  - 유형: '교육 / 수료증 / 이수' 가 있으면 교육 수료증 제출(edu), 아니면 요구자료 제출(doc). (복무 누락 소명은 사용자가 직접 선택)
//  - 요청부서: 공문 본문이 아니라 로그인한 관리자의 소속 부서를 호출 측(routes/analyze.js)에서 넣는다.
const { isValidDate } = require('./time');

const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// OCR 이 글자 사이에 공백을 넣어도 인식되도록 각 글자 사이에 \s* 허용 ('요 구 자 료 명')
const spaced = (w) => [...w].map(esc).join('\\s*');
const NOT_INSIDE_WORD = '(?<![가-힣A-Za-z0-9])'; // '수료교육명' 처럼 다른 낱말 속의 키워드는 제외

// 구체적인 이름부터: 요구자료명 > 과정명 > 교육명 > 요구사항 > 요청사항
const TITLE_KEYS = ['요구자료명', '과정명', '교육명', '요구사항', '요청사항'];
// 제출기한 > 마감일자 > 마감일 > 기한 ('제출기한' 안의 '기한'은 NOT_INSIDE_WORD 로 걸러진다)
const DUE_KEYS = ['제출\\s*기한', spaced('마감일자'), spaced('마감일'), '기한'];
const DATE = '(20\\d{2})\\s*[년.\\/\\-]\\s*(\\d{1,2})\\s*[월.\\/\\-]\\s*(\\d{1,2})';

const cleanTitle = (s) => s
  .replace(/\s+/g, ' ')
  .replace(/^[\s"'“”‘’「」『』]+|[\s"'“”‘’「」『』]+$/g, '')
  .replace(/[.,]$/, '')
  .trim()
  .slice(0, 200);

function extractTitle(text) {
  for (const key of TITLE_KEYS) {
    // 키워드 뒤 콜론(:, ：, OCR 오인식 ;) 또는 공백 다음의 한 줄
    const re = new RegExp(`${NOT_INSIDE_WORD}${spaced(key)}(?:[ \\t]*[:：;][ \\t]*|[ \\t]+)([^\\n\\r]+)`, 'u');
    const m = text.match(re);
    if (m) { const t = cleanTitle(m[1]); if (t) return t; }
  }
  return '';
}

function extractDue(text) {
  for (const key of DUE_KEYS) {
    // 키워드 ~ 날짜 사이에는 ':' '~' 등 숫자가 아닌 짧은 구분 문자만 허용
    const re = new RegExp(`${NOT_INSIDE_WORD}${key}[^\\d\\n]{0,12}${DATE}`, 'gu');
    for (const m of text.matchAll(re)) {
      const iso = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
      if (isValidDate(iso)) return iso;
    }
  }
  return '';
}

// 교육/수료증/이수 관련이면 edu, 아니면 doc
const classify = (text) => (/교육|수료증|이수/.test(text) ? 'edu' : 'doc');

function analyze(text, { dept } = {}) {
  const assigneeMatch = text.match(/(?:대상자|수신자)\s*[:：]\s*(.+)/);
  return {
    title: extractTitle(text),
    due: extractDue(text),
    dept: String(dept || '').trim(),
    assignee: ((assigneeMatch && assigneeMatch[1]) || '전체 직원').trim(),
    cat: classify(text),
    raw: text,
  };
}

module.exports = { analyze, extractTitle, extractDue, classify };
