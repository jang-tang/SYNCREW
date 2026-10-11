import type { Lang } from "@shared/languages";

// 데모 번역용 예문. 실제 번역은 서버의 gpt-realtime-2 가 담당한다.
export const PHRASES: Record<Lang, string>[] = [
  {
    ko: "안전모를 착용하고 작업을 시작하세요.",
    zh: "请戴好安全帽后开始作业。",
    vi: "Hãy đội mũ bảo hộ rồi bắt đầu làm việc.",
    uz: "Kaskani kiyib, ishni boshlang.",
    ru: "Наденьте каску и приступайте к работе.",
  },
  {
    ko: "오후 2시까지 3층 거푸집 해체를 끝내 주세요.",
    zh: "请在下午2点前完成3楼模板拆除。",
    vi: "Hãy tháo xong cốp pha tầng 3 trước 2 giờ chiều.",
    uz: "Soat 14:00 gacha 3-qavat qolipini buzib boʻling.",
    ru: "Закончите демонтаж опалубки на 3 этаже до 14:00.",
  },
  {
    ko: "자재는 B게이트로 반입해 주세요.",
    zh: "材料请从B门运入。",
    vi: "Hãy đưa vật tư vào qua cổng B.",
    uz: "Materiallarni B darvoza orqali olib kiring.",
    ru: "Завозите материалы через ворота B.",
  },
  {
    ko: "알겠습니다. 바로 시작하겠습니다.",
    zh: "明白了，马上开始。",
    vi: "Tôi hiểu rồi. Tôi sẽ bắt đầu ngay.",
    uz: "Tushundim. Hozir boshlayman.",
    ru: "Понял. Сейчас начну.",
  },
  {
    ko: "비계 위에서는 안전고리를 꼭 거세요.",
    zh: "在脚手架上一定要挂好安全带。",
    vi: "Trên giàn giáo nhất định phải móc dây an toàn.",
    uz: "Havozada albatta xavfsizlik kamarini ilib qoʻying.",
    ru: "На лесах обязательно пристёгивайте страховку.",
  },
  {
    ko: "점심시간은 12시부터 1시까지입니다.",
    zh: "午餐时间是12点到1点。",
    vi: "Giờ ăn trưa từ 12 giờ đến 1 giờ.",
    uz: "Tushlik soat 12 dan 1 gacha.",
    ru: "Обед с 12 до 13 часов.",
  },
  {
    ko: "이 부분 다시 확인해 주세요.",
    zh: "请再确认一下这部分。",
    vi: "Hãy kiểm tra lại phần này.",
    uz: "Bu qismni qayta tekshiring.",
    ru: "Проверьте эту часть ещё раз.",
  },
  {
    ko: "작업 다 끝났습니다.",
    zh: "作业全部完成了。",
    vi: "Công việc đã xong hết rồi.",
    uz: "Ish toʻliq tugadi.",
    ru: "Работа полностью закончена.",
  },
  {
    ko: "어디로 가면 되나요?",
    zh: "我应该去哪里？",
    vi: "Tôi nên đi đâu?",
    uz: "Qayerga borishim kerak?",
    ru: "Куда мне идти?",
  },
  {
    ko: "자재가 부족합니다.",
    zh: "材料不够了。",
    vi: "Vật tư không đủ.",
    uz: "Materiallar yetarli emas.",
    ru: "Не хватает материалов.",
  },
];

export const P = {
  helmet: 0,
  formwork: 1,
  gateB: 2,
  understood: 3,
  harness: 4,
  lunch: 5,
  checkAgain: 6,
  done: 7,
  whereToGo: 8,
  shortage: 9,
} as const;

const normalize = (text: string) => text.toLowerCase().replace(/[\s\p{P}]/gu, "");

/** 예문이면 대상 언어 예문, 아니면 언어 표시를 붙인 원문 (데모) */
export function demoTranslate(text: string, from: Lang, to: Lang): string {
  if (from === to) return text;
  const key = normalize(text);
  const phrase = PHRASES.find((item) => normalize(item[from]) === key);
  return phrase ? phrase[to] : `(${to.toUpperCase()}) ${text}`;
}

/** 데모 음성 인식: 녹음할 때마다 다음 예문을 인식한 것으로 처리 */
const VOICE_ORDER = [P.helmet, P.gateB, P.harness, P.checkAgain, P.lunch, P.formwork];
let voiceIndex = 0;
export function nextVoicePhrase(lang: Lang): string {
  const phrase = PHRASES[VOICE_ORDER[voiceIndex++ % VOICE_ORDER.length]!]!;
  return phrase[lang];
}
