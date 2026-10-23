// 안전보건공단 「산업현장 및 법률 용어 유의어 사전」 CSV → 현장 은어 보충 데이터 (docs/field-terms.md 6-1·7절).
// 출처: 공공데이터포털 15161288 (한국산업안전보건공단_산업현장 법률용어 정의 데이터, 이용허락범위 제한 없음).
// CSV 한 줄 = 유의어 묶음. 건설 일본어계 은어 묶음은 첫 칸이 은어, 나머지가 표준어(+철자 변형)다.
//
// 고르는 기준 (사람이 정한 목록을 이 파일에 둔다 — 자동 판별은 하지 않는다):
//   - ACCEPT: 넣을 은어. 일상어와 겹치는 말(사이·조기·지리·구이·도마·데코(데코레이션) 등)은 일상 문장에서 잘못 감지되므로 넣지 않는다.
//     한국어는 띄어쓰기 경계 없이 글자열로 찾으므로 다른 단어 안에 들어가는 말도 조심한다
//   - SPELLING_VARIANTS: 묶음 안의 은어 철자 변형 (variants 로 넣어 감지만 넓힌다). 표준어는 variants 에 넣지 않는다 —
//     variants 는 기준 표현(은어)으로 "보정"되므로 표준어를 넣으면 "비계" 가 "아시바" 로 바뀐다 (일상어 철자도 마찬가지: "세면" → "세멘" 이라 뺐다)
//   - OVERRIDE: 기존 seed 데이터와 뜻이 달라 공단 사전 기준으로 바꾸는 항목 (2026-10-23 사용자 결정: 데스라·아나방)
//
// 사용 (server 폴더에서): npx tsx scripts/build-kosha-slang.ts <유의어 사전.csv> [출력 경로]
//   출력 기본값: data/legacy-workplace/supplement/kosha_slang.json
import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = {
  title: "한국산업안전보건공단_산업현장 법률용어 정의 데이터 — 산업 현장 및 법률 용어 유의어 사전.csv",
  url: "https://www.data.go.kr/data/15161288/fileData.do",
  license: "공공데이터포털 이용허락범위 제한 없음",
  data_date: "2026-10-01 (포털 수정일)",
};

/** 넣을 은어 (CSV 묶음의 첫 칸). 위험도는 안전과 직접 관련된 것만 따로 적는다 (나머지 normal) */
const ACCEPT = [
  "다가네", "다께와리", "가꾸목", "가꾸부찌", "가나고데", "가나모노", "가다와꾸", "가리고야", "가시메", "가이당", "가타키리",
  "게꼬미", "겐사끼", "고구찌", "고다다끼", "고데무라", "고바다떼", "고바이", "고부다시", "구루마", "구리스", "기고데",
  "기리까에", "기리꼬미", "기리바리", "기리빠시", "기즈리", "나가떼", "나나메", "나라시", "나리마끼", "네지리", "노가다",
  "노기스", "노리비끼", "노바시", "노보리", "다데도이", "다라이", "다루끼", "다마이시", "다이까렝가", "다이꼬바리",
  "다찌아가리", "단도리", "단찌가이", "데나오시", "데네리", "데마찌", "데모도", "데스라", "데스리", "데코보코", "덴조-",
  "뎃킨", "도끼다시", "도도메", "도라무", "도란스", "도지나", "돗바", "라바콘", "레듀샤", "마구사", "반생이", "마루보",
  "마루다", "마에가리", "마와리부찌", "마지끼리", "마키선", "만땅", "메가네", "메꾸라", "메모도", "메지", "메지보", "멘끼",
  "멘도리", "모도시", "모찌꼬미", "무시로", "미스모리", "미쓰모리", "미즈끼리", "바라시", "바이브", "바께쓰", "부란자",
  "부록꾸", "부비끼", "브레까", "빠꾸", "빠데", "빠레트", "빠루", "빠우", "빼빠", "뺑끼", "사게부리", "사부로꾸", "사비도메",
  "사뽀도", "사시꼬미", "사시낑", "삼바시", "세끼이다", "세멘", "쇼꾸닝", "스데바", "스미키리", "스지까이", "스텐", "스페샤",
  "스페아", "승고다루끼", "시다지", "시따바", "시로토", "시루시", "시마이", "시메라", "시아게", "시하찌", "쓰루하시",
  "아까렝가", "아나방", "아다라시", "아라이다시", "아시바", "야기리", "야리가다", "야리끼리", "야마도메", "야스리", "엔토쓰",
  "오가네", "오도리바", "오-비끼", "오비낑", "오사마리", "오사이", "오삽", "오시이레", "오야", "오함마", "우라이시",
  "우메모도시", "우와낑", "우찌바나시", "유도리", "이모메지", "이바리", "자가네", "자바라", "짬뿌", "찐빠", "쿠사리", "쿠사비",
  "키리카에", "타이루", "투바이", "하바끼", "하스리", "하이바", "함바", "헤베", "루베", "호리가다", "후꾸로바리", "후렌지",
  "후쿠", "후쿠메타", "히꼬미", "히사시", "호네구미", "와쿠", "요꼬", "다데", "기리", "기소", "기스", "곰방", "공구리",
  "갑빠", "갓따", "갓쇼", "겐바", "겐칸", "넨도", "노끼", "누노", "답빠", "당까", "뎀바", "도비", "란마", "반생",
  "뷰다", "사칸", "스데", "쓰미", "우끼", "우마", "유까", "하까", "후앙", "히비", "몽키", "앙카",
];

/** CSV 첫 칸을 기준 표현으로 쓸 때 고쳐 쓰는 것 (기호 제거, 기존 데이터와 같은 기준 표현으로) */
const CANONICAL_FIX: Record<string, string> = { "덴조-": "덴조", "오-비끼": "오비끼", 오야: "오야지", 요꼬: "요코" };

/** 묶음 안의 은어 철자 변형 (나머지 한글 칸은 표준어로 본다) */
const SPELLING_VARIANTS = new Set([
  "타가네", "다떼", "노가대", "도가다", "노로비끼", "데나우시", "데꾸보꾸", "도기다시", "돕빠", "마루타", "맥기", "멕기",
  "메꾸라시", "매꾸라이", "미즈모리", "기레까이", "기레까시", "뿌레카", "사게후리", "스덴", "스뎅", "시메루", "시로시",
  "오사에", "오야가다", "오야", "쟈바라", "찜빠", "류베", "후렌찌", "단까", "키렙바시", "람마", "뒷모도", "까대기",
  "노리바케", "요꼬",
]);

/** 묶음 안에 있지만 표준어로 쓰지 않을 칸 (뜻이 다르거나 일상어) */
const DROP_TOKENS = new Set(["오늘", "왈가닥", "기리바", "기소", "자동차 정비", "소각재", "단가", "히로시", "빠루", "반생", "공", "뺑뺑이", "방탄모", "세면"]);

/** 묶음에 한글 표준어가 없거나(영어만) 고쳐 쓸 표준어 */
// 데스라·마에가리: 2026-10-24 실측에서 "출력"이 xuất 로 직역되고 가불이 고유명사로 옮겨져 뜻을 풀어 씀 (docs/field-accuracy.md 7절)
const STANDARD_FIX: Record<string, string> = {
  아나방: "유공강판(PSP)", 가시메: "리벳 작업", 갓쇼: "트러스",
  데스라: "오늘 출근한 작업 인원(출력 인원)", 마에가리: "가불(월급을 미리 받는 돈)",
};

/** 안전과 직접 관련된 은어의 위험도 (없으면 normal) */
const RISK: Record<string, "critical" | "high"> = {
  아시바: "critical", 데스리: "high", 하이바: "high", 도지나: "high", 우마: "high", 노보리: "high", 삼바시: "high",
  사뽀도: "high", 스지까이: "high", 도도메: "high", 야마도메: "high", 쿠사리: "high", 후쿠: "high", 브레까: "high",
  도란스: "high", 바라시: "high", 하스리: "high", 기리바리: "high", 오함마: "high", 곰방: "high", 갓따: "high",
};

/** 기존 seed 데이터를 대신하는 항목 (다른 파일의 같은 기준 표현은 읽지 않는다) */
const OVERRIDE: Record<string, { reason: string; asr?: string[] }> = {
  데스라: {
    reason: "기존 seed 는 '난간'(신뢰도 medium_low) — 공단 사전은 데스라 = 출력 인원, 데스리 = 난간 (2026-10-23 사용자 결정으로 공단 기준)",
    asr: ["데쓰라", "대수라"],
  },
  아나방: { reason: "기존 seed 는 '천공·코어 작업'(신뢰도 low) — 공단 사전은 PSP(Punched Steel Plate, 유공강판)" },
};

/** 따옴표를 지원하는 최소 CSV 파서 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const [csvPath, outPath = "data/legacy-workplace/supplement/kosha_slang.json"] = process.argv.slice(2);
if (!csvPath) {
  console.error("사용: npx tsx scripts/build-kosha-slang.ts <산업 현장 및 법률 용어 유의어 사전.csv> [출력 경로]");
  process.exit(1);
}

const groups = parseCsv(readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""))
  .slice(1)
  .map((row) => row.map((cell) => cell.trim()).filter(Boolean))
  .filter((row) => row.length > 0);
const byFirst = new Map<string, string[]>();
for (const group of groups) if (!byFirst.has(group[0]!)) byFirst.set(group[0]!, group);

const isHangulPhrase = (token: string) => /^[가-힣 ]+$/.test(token);
const terms = [];
const missing: string[] = [];
for (const [index, first] of ACCEPT.entries()) {
  const group = byFirst.get(first);
  if (!group) { missing.push(first); continue; }
  const canonical = CANONICAL_FIX[first] ?? first;
  const rest = group.slice(1).filter((token) => isHangulPhrase(token) && !DROP_TOKENS.has(token) && token !== canonical);
  const variants = rest.filter((token) => SPELLING_VARIANTS.has(token));
  if (canonical !== first) variants.unshift(first.replace(/-/g, ""));
  const standard = STANDARD_FIX[canonical] ? [STANDARD_FIX[canonical]] : [...new Set(rest.filter((token) => !SPELLING_VARIANTS.has(token)))].slice(0, 3);
  if (standard.length === 0) { missing.push(`${first}(표준어 없음)`); continue; }
  const override = OVERRIDE[canonical];
  terms.push({
    id: `KS${String(index + 1).padStart(3, "0")}`,
    canonical_ko: canonical,
    variants_ko: [...new Set(variants.filter((v) => v !== canonical))],
    translate_as_ko: standard.join(", "),
    risk_level: RISK[canonical] ?? "normal",
    domain: "construction_slang",
    ...(override ? { override: true, override_reason: override.reason, asr_corrections: override.asr ?? [] } : {}),
    source_group: group,
  });
}
if (missing.length > 0) {
  console.error(`CSV 에서 찾지 못했거나 표준어가 없는 항목: ${missing.join(", ")}`);
  process.exit(1);
}

const output = {
  name: "kosha_slang_supplement",
  version: "2026.10.23",
  generated_at: new Date().toISOString().slice(0, 10),
  source: SOURCE,
  note: "건설 일본어계 은어 → 표준 한국어 (translate_as_ko). 언어별 번역은 넣지 않는다 (docs/field-terms.md 0절). 검수: 공단 사전 그대로 + 위 기준으로 고름, 현장 확인 전",
  counts: { terms: terms.length, overrides: terms.filter((t) => "override" in t).length },
  terms,
};
writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`${terms.length}개 → ${outPath} (대체 ${output.counts.overrides}개)`);
