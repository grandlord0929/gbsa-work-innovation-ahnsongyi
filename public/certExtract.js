// 수료증 OCR 텍스트 파서 + 성명 검증. 브라우저(<script src="certExtract.js">)와 서버(require)가 같은 코드를 사용한다.
//  - 여러 줄로 줄바꿈된 교육명, 발급기관, 이수일자, 성명(성명/수료자/이름/위 사람) 추출
//  - 제출자 성명과 수료증 성명의 strict 비교 (공백 무시)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CertExtract = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 라벨 ----------
  const L_COURSE = '교\\s*육\\s*과\\s*정\\s*명|교\\s*육\\s*과\\s*정|교\\s*육\\s*명|과\\s*정\\s*명|과\\s*목\\s*명|교\\s*육\\s*과\\s*목';
  const L_ISSUER = '발\\s*급\\s*기\\s*관|발\\s*급\\s*처|교\\s*육\\s*기\\s*관|수\\s*료\\s*기\\s*관|주\\s*관\\s*기\\s*관|주\\s*관|기\\s*관\\s*명';
  const L_DATE = '이\\s*수\\s*일\\s*자?|수\\s*료\\s*일\\s*자?|교\\s*육\\s*기\\s*간|교\\s*육\\s*일\\s*자|발\\s*급\\s*일\\s*자?';
  const L_NAME = '성\\s*명|수\\s*료\\s*자|이\\s*름';
  const L_OTHER = '발\\s*급\\s*번\\s*호|증\\s*서\\s*번\\s*호|수\\s*료\\s*번\\s*호|생\\s*년\\s*월\\s*일|소\\s*속|직\\s*위|직\\s*급|부\\s*서|교\\s*육\\s*시\\s*간|번\\s*호';
  const L_STOP = `${L_COURSE}|${L_ISSUER}|${L_DATE}|${L_NAME}|${L_OTHER}`;

  const STOP_LABEL_RE = new RegExp(`^(?:${L_STOP})\\s*(?:[:;]|\\s|$)`);
  const SENTENCE_START_RE = /^(?:위\s*사람|이에|본\s*증서|위와\s*같이|위\s*교육|위\s*과정)/;
  const SENTENCE_END_RE = /(?:합니다|하였기에|하였음을|수여함|증명함)[.。]?$/;
  const TITLE_RE = /^(?:수\s*료\s*증|이\s*수\s*증|증\s*서|수\s*료\s*증\s*서)$/;
  const DATE_LINE_RE = /^20\d{2}\s*[년.\-\/]\s*\d{1,2}\s*[월.\-\/]\s*\d{1,2}\s*일?\.?$/; // 날짜"만" 있는 줄 (연도로 시작하는 교육명과 구분)
  const COURSE_END_RE = /(?:교육|과정|연수|훈련|강좌|세미나|워크숍|워크샵|프로그램|특강|코스|\)|」|』)$/;
  const ORG_END_RE = /(?:진흥원|공단|연수원|개발원|협회|센터|대학교?|공사|교육원|아카데미|재단|연구원|팀|부|실|원)$/;
  const STRONG_ORG_END_RE = /(?:진흥원|공단|연수원|개발원|협회|재단|연구원|교육원|아카데미|공사)(?:\s*(?:원장|장|대표))?$/;
  const TOPIC_RE = /(정보\s*보안|개인\s*정보|청렴|성희롱|성폭력|산업\s*안전|장애인|괴롭힘|부패\s*방지|윤리|인권|저작권|재난|소방|응급|안전|보안)/;

  // ---------- 텍스트 정리 ----------
  const toLines = (text) =>
    String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[​-‍﻿]/g, '')
      .replace(/：/g, ':')
      .split('\n')
      .map((l) => l.replace(/[ \t ]+/g, ' ').trim());

  // 값 정리: 줄바꿈/연속 공백 → 단일 공백, OCR 잡음 문자 제거, 앞뒤 구두점 제거
  function normalizeValue(s) {
    return String(s || '')
      .replace(/[|_\[\]{}<>「」『』"“”]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s:;,.·-]+|[\s:;,.·-]+$/g, '')
      .trim();
  }

  // 다음 줄이 "값의 이어지는 줄"이 아니라 새 항목/문장의 시작인지
  function isBoundary(line) {
    return (
      STOP_LABEL_RE.test(line) ||
      SENTENCE_START_RE.test(line) ||
      TITLE_RE.test(line) ||
      DATE_LINE_RE.test(line) ||
      SENTENCE_END_RE.test(line) ||
      /^[가-힣A-Za-z ]{1,8}:/.test(line)
    );
  }

  // 라벨 줄에서 값을 읽고, 줄바꿈으로 이어진 값(최대 maxCont 줄)을 합친다.
  //  - 빈 줄, 다음 항목 라벨, "위 사람은…" 문장, 날짜 줄, 이미 종결어(…교육/과정 등)로 끝난 값 뒤의 줄에서 멈춘다.
  function extractLabeled(lines, labelAlt, { maxCont = 3, terminatorRe = null, maxLineLen = 60, orgBoundary = false } = {}) {
    const labelRe = new RegExp(`^(?:${labelAlt})\\s*(?:[:;]\\s*|\\s+|$|(?=[0-9A-Za-z「『\\[(]))(.*)$`);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(labelRe);
      if (!m) continue;
      const parts = [];
      if (m[1].trim()) parts.push(m[1].trim());
      let taken = 0;
      for (let j = i + 1; j < lines.length && taken < maxCont; j++) {
        if (parts.length && terminatorRe && terminatorRe.test(normalizeValue(parts[parts.length - 1]))) break;
        const ln = lines[j];
        if (!ln) { if (parts.length) break; continue; } // 값이 시작된 뒤의 빈 줄 = 값의 끝
        if (isBoundary(ln) || ln.length > maxLineLen || (orgBoundary && STRONG_ORG_END_RE.test(ln))) break;
        parts.push(ln);
        taken += 1;
      }
      const val = normalizeValue(parts.join(' '));
      if (val) return val;
    }
    return '';
  }

  function extractCourseName(text) {
    const lines = toLines(text);
    const labeled = extractLabeled(lines, L_COURSE, { maxCont: 3, terminatorRe: COURSE_END_RE, orgBoundary: true });
    if (labeled) return labeled;
    // 라벨이 없는 수료증: 주제어가 들어간 교육/과정 줄 + 이어지는 줄
    const idx = lines.findIndex((l) => /(교육|연수|과정)/.test(l) && TOPIC_RE.test(l) && !/(위\s*사람|수여|이수하|성실)/.test(l));
    if (idx < 0) return '';
    const parts = [lines[idx].replace(/^.*?:\s*/, '')];
    for (let j = idx + 1; j < lines.length && parts.length < 3; j++) {
      if (COURSE_END_RE.test(normalizeValue(parts[parts.length - 1]))) break;
      if (!lines[j] || isBoundary(lines[j]) || lines[j].length > 60 || STRONG_ORG_END_RE.test(lines[j])) break;
      parts.push(lines[j]);
    }
    return normalizeValue(parts.join(' '));
  }

  function lastDate(str) {
    const re = /(20\d{2})\s*[년.\-\/]\s*(\d{1,2})\s*[월.\-\/]\s*(\d{1,2})/g;
    let m; let last = null;
    while ((m = re.exec(str))) last = m;
    return last ? `${last[1]}-${String(last[2]).padStart(2, '0')}-${String(last[3]).padStart(2, '0')}` : '';
  }

  function extractDate(text) {
    const lines = toLines(text);
    const v = extractLabeled(lines, L_DATE, { maxCont: 1, maxLineLen: 40 });
    return lastDate(v) || lastDate(String(text || ''));
  }

  function extractIssuer(text, courseName = '') {
    const lines = toLines(text);
    const labeled = extractLabeled(lines, L_ISSUER, { maxCont: 1, terminatorRe: ORG_END_RE });
    if (labeled) return labeled;
    const strip = (l) => l.replace(/\s*(원장|장|대표|귀하)\s*\S*$/, '');
    const l = [...lines].reverse().find((x) => x && ORG_END_RE.test(strip(x)) && x !== courseName && !/(교육|과정)/.test(x));
    return l ? normalizeValue(strip(l)) : '';
  }

  // ---------- 성명 ----------
  const NAME_BAD_WORDS = ['소속', '생년월일', '생년', '직위', '직급', '부서', '교육명', '교육과정', '교육', '발급', '기관', '수료', '과정', '번호', '주민', '이수', '성명', '이름', '없음'];

  // 한글 연속열 → 이름 후보(2~5자). 뒤에 붙은 다른 항목 라벨(소속 등)은 잘라낸다.
  function cleanNameToken(t) {
    if (!t) return '';
    for (const w of NAME_BAD_WORDS) {
      if (t.length - w.length >= 2 && t.endsWith(w)) { t = t.slice(0, -w.length); break; }
    }
    if (NAME_BAD_WORDS.includes(t)) return '';
    return t.length >= 2 && t.length <= 5 ? t : '';
  }

  function pickNameToken(rest) {
    let s = String(rest || '').replace(/[(（\[][^)）\]]*[)）\]]/g, ' ').replace(/^[\s:|·.\-_]+/, '');
    // "강 하 율" 처럼 한 글자씩 띄어진 경우
    const spaced = s.match(/^([가-힣])\s([가-힣])\s([가-힣])(?:\s([가-힣]))?(?![가-힣])/);
    if (spaced) return cleanNameToken(spaced.slice(1).filter(Boolean).join(''));
    const run = s.match(/^([가-힣]+)/);
    return run ? cleanNameToken(run[1]) : '';
  }

  function extractName(text) {
    const lines = toLines(text);
    const labelRe = new RegExp(`(?:^|[\\s|,(])(?:${L_NAME})\\s*(?:[:]\\s*|\\s+|(?=[가-힣]))([^\\n]*)`);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(labelRe);
      if (!m) continue;
      let name = pickNameToken(m[1]);
      if (!name && !m[1].trim() && lines[i + 1] && !isBoundary(lines[i + 1])) name = pickNameToken(lines[i + 1]); // 값이 다음 줄
      if (name) return { name, source: 'label' };
    }
    // "위 사람 강하율은 …" 형태 (조사 분리 → 조사 없음 순)
    for (const l of lines) {
      let m = l.match(/위\s*사람\s*:?\s*([가-힣]{2,4}?)(?:은|는|이|가)(?![가-힣])/);
      if (!m) m = l.match(/위\s*사람\s*:?\s*([가-힣]{2,4})(?![가-힣])/);
      const name = m ? cleanNameToken(m[1]) : '';
      if (name) return { name, source: 'sentence' };
    }
    return { name: '', source: '' };
  }

  const normalizeName = (s) => String(s || '').normalize('NFC').replace(/\([^)]*\)|（[^）]*）/g, '').replace(/[\s·.\-_]+/g, '').toLowerCase();

  function editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }

  // 제출자 성명(expected)과 수료증 성명 비교. strict: 공백을 무시한 완전 일치만 'match'.
  //  status: 'match' | 'mismatch' | 'unverified'(수료증에서 성명을 찾지 못함)
  //  isNameMatched / matchedName(= 수료증 상 성명) 은 화면·API 공통 필드
  function verifyName(expected, { certName = '', text = '' } = {}) {
    const exp = String(expected || '').trim();
    const ex = certName ? { name: certName, source: 'given' } : extractName(text);
    const found = String(ex.name || '').trim();
    const en = normalizeName(exp);
    const fn = normalizeName(found);

    if (fn) {
      if (fn === en) return { status: 'match', isNameMatched: true, matchedName: found, expectedName: exp, source: ex.source, similar: false };
      const similar = en.length >= 2 && fn.length >= 2 && editDistance(en, fn) <= 1;
      // 한 글자 차이는 OCR 오인식일 수 있어 본인 확인 후 제출 가능(confirmable). 두 글자 이상 다르면 타인으로 보고 확정 반려.
      return { status: 'mismatch', isNameMatched: false, matchedName: found, expectedName: exp, source: ex.source, similar, confirmable: similar };
    }
    // 성명 항목을 못 읽었지만 원문에 제출자 성명이 그대로 있으면 확인된 것으로 본다(라벨 OCR 실패 대비)
    if (en.length >= 2 && String(text || '').normalize('NFC').replace(/\s+/g, '').includes(en)) {
      return { status: 'match', isNameMatched: true, matchedName: exp, expectedName: exp, source: 'text', similar: false };
    }
    // 성명 항목은 못 읽었지만 원문 어딘가에 제출자 성명과 한 글자 차이인 이름이 있으면 OCR 오인식으로 보고 본인 확인 대상으로 둔다
    const t = String(text || '').normalize('NFC');
    const toks = t.match(/[가-힣]{2,5}/g) || [];
    const near = en.length >= 2 ? toks.find((k) => k.length === en.length && editDistance(en, k) <= 1) : '';
    // 이름이 아예 안 읽힌 경우도 해상도 문제일 수 있으므로 본인 확인 후 제출 가능(confirmable). 서버가 기록을 남긴다.
    return { status: 'unverified', isNameMatched: false, matchedName: '', expectedName: exp, source: '', similar: !!near, nearName: near || '', confirmable: true };
  }

  function nameMessage(v) {
    if (v.status === 'mismatch') {
      return `⚠️ 제출자 성명('${v.expectedName}')과 수료증 상 성명('${v.matchedName}')이 일치하지 않습니다.` +
        (v.similar ? ' (한 글자 차이입니다. OCR 오인식일 수 있으니 선명한 이미지로 다시 올려 주세요.)' : '');
    }
    if (v.status === 'unverified') {
      return `⚠️ 수료증에서 성명을 자동으로 확인하지 못했습니다. 제출자('${v.expectedName}') 본인의 수료증이 맞다면 아래 '본인 수료증임을 확인하고 제출'을 눌러 주세요. (확인 이력이 기록됩니다)`;
    }
    return `✅ 제출자 성명('${v.expectedName}')과 수료증 상 성명이 일치합니다.`;
  }

  // OCR 파싱 결과 객체. expectedName(현재 로그인 사용자 성명)을 주면 성명 검증 결과가 함께 담긴다:
  //   isNameMatched: boolean, matchedName: 수료증 상 성명, nameStatus: 'match'|'mismatch'|'unverified'
  function extractCert(text, { expectedName } = {}) {
    const courseName = extractCourseName(text);
    const n = extractName(text);
    const out = {
      courseName,
      issuer: extractIssuer(text, courseName),
      completedDate: extractDate(text),
      certName: n.name,
      nameSource: n.source,
    };
    if (expectedName !== undefined) {
      const v = verifyName(expectedName, { certName: n.name, text });
      out.isNameMatched = v.isNameMatched;
      out.matchedName = v.matchedName;
      out.nameStatus = v.status;
      out.nameSimilar = v.similar;
    }
    return out;
  }

  return { extractCert, extractCourseName, extractIssuer, extractDate, extractName, verifyName, nameMessage, normalizeName, normalizeValue };
});
