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
      // 한 글자짜리 이어진 줄(예: "…정보보안 교" + "육")은 단어 중간에서 줄이 바뀐 것이므로 공백 없이 붙인다
      let joined = parts[0] || '';
      for (let k = 1; k < parts.length; k++) joined += (/^[가-힣]$/.test(parts[k].trim()) ? '' : ' ') + parts[k];
      const val = normalizeValue(joined);
      if (val) return val;
    }
    return '';
  }

  // "…실시한 「2026년 하반기 정보보안 교육」과정을" 처럼 문장 속 인용부호로 묶인 교육명
  function quotedCourse(lines) {
    for (const l of lines) {
      const m = l.match(/(?:실시한|이수한|참석한|수료한|받은|참여한)\s*[「『“"'‘\[]+\s*([^」』”"'’\]]{4,80}?)\s*[」』”"'’\]]/);
      if (m) return normalizeValue(m[1]);
    }
    return '';
  }
  const hangulWords = (v) => (String(v).match(/[가-힣]{2,}/g) || []);
  const nospace = (v) => String(v).replace(/\s+/g, '');

  function extractCourseName(text) {
    const lines = toLines(text);
    const labeled = extractLabeled(lines, L_COURSE, { maxCont: 3, terminatorRe: COURSE_END_RE, orgBoundary: true });
    // 교육명이 라벨 줄에서 잘렸거나(예: "…정보보안 교" / "육") 못 읽은 경우, 본문 인용 문장의 교육명이 라벨 값을 포함하면 그것을 쓴다
    const quoted = quotedCourse(lines);
    if (quoted) {
      const words = hangulWords(labeled);
      if (!labeled || (words.length && words.every((w) => nospace(quoted).includes(w))) || nospace(quoted).includes(nospace(labeled).slice(0, 10))) return quoted;
    }
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
    // "경기도경제과학진흥원장" 처럼 직함(장/원장/대표)이 붙은 기관명: 직함을 떼어 본 후보 중 기관명 어미로 끝나는 것을 고른다
    const strips = (l) => [l, l.replace(/\s*(?:원장|대표|귀하)\s*\S*$/, ''), l.replace(/\s*장\s*\S*$/, '')];
    // 여러 OCR 패스를 합친 원문에는 같은 기관명이 조금씩 다르게(글자 누락) 여러 번 나오므로 가장 온전한(긴) 후보를 고른다
    let found = '';
    for (const x of lines) {
      if (!x || x === courseName || /(교육|과정)/.test(x)) continue;
      const c = strips(x).find((v) => v && ORG_END_RE.test(v));
      if (c && c.length <= 30 && normalizeValue(c).length > normalizeValue(found).length) found = c;
    }
    return found ? normalizeValue(found) : '';
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

  // ---------- 이름 자체 찾기 ----------
  // 수료증의 항목 이름은 "성 명", "이름", "수료자" 등 제각각이고 OCR 이 라벨/값을 서로 다른 줄로 나누는 일도 많다.
  // 그래서 라벨을 찾기보다 제출자 이름이 문서 어딘가에 "이름으로서" 적혀 있는지를 먼저 본다.
  //  - "홍길동", "홍 길 동" 처럼 글자 사이가 띄어져도 인정
  //  - 앞뒤에 다른 한글이 붙은 경우는 제외 ("이수하였으므로" 속의 "이수" 등). 단, 조사/호칭(은·는·이·가·님·씨·귀하…)은 허용
  const escRe = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function findNameInText(text, name) {
    const n = String(name || '').normalize('NFC').replace(/\s+/g, '');
    if (n.length < 2) return false;
    const pat = n.split('').map(escRe).join('[ \\t]*');
    const re = new RegExp(`(?<![가-힣])${pat}(?![가-힣])|(?<![가-힣])${pat}(?=(?:은|는|이|가|을|를|의|님|씨|께|귀하|앞)(?![가-힣]))`);
    return toLines(String(text || '').normalize('NFC')).some((l) => re.test(l));
  }

  // 다른 사람의 수료증인지 알아보기 위한 후보: 이름만 홀로 적힌 줄(3글자, 흔한 성씨로 시작)
  const SURNAMES = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부가복태목형피두감호계';
  const NOT_NAMES = new Set(['수료증', '이수증', '수료자', '교육과정', '수료일자', '이수일자', '발급기관', '경기도', '관리를', '위하여', '이수하', '실시한', '진흥원', '합니다', '증서']);
  function standaloneName(lines) {
    for (const l of lines) {
      const m = l.match(/^([가-힣])\s?([가-힣])\s?([가-힣])$/);
      if (!m) continue;
      const v = m[1] + m[2] + m[3];
      if (SURNAMES.includes(m[1]) && !NOT_NAMES.has(v) && !NAME_BAD_WORDS.includes(v)) return v;
    }
    return '';
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
    const alone = standaloneName(lines);
    if (alone) return { name: alone, source: 'standalone' };
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
    // 1순위: 제출자 이름이 수료증 안 어디에든 이름으로 적혀 있으면 본인 확인 (라벨 표기와 무관)
    if (findNameInText(text, exp)) {
      return { status: 'match', isNameMatched: true, matchedName: exp, expectedName: exp, source: 'found', similar: false };
    }
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
      if (v.status === 'match' && !out.certName) { out.certName = v.matchedName; out.nameSource = 'found'; }
      out.isNameMatched = v.isNameMatched;
      out.matchedName = v.matchedName;
      out.nameStatus = v.status;
      out.nameSimilar = v.similar;
    }
    return out;
  }

  return { extractCert, findNameInText, extractCourseName, extractIssuer, extractDate, extractName, verifyName, nameMessage, normalizeName, normalizeValue };
});
