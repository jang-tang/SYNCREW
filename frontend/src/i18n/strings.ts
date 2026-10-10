import type { Lang } from "@shared/languages";

// 앱 UI 문구. 로그인 후에는 사용자 기본 언어로 표시한다 (Phase 2). 지금은 한국어 고정.
const STRINGS = {
  "tab.conversations": { ko: "대화", zh: "对话", vi: "Trò chuyện", uz: "Suhbatlar", ru: "Чаты" },
  "tab.instructions": { ko: "지시", zh: "指令", vi: "Chỉ thị", uz: "Topshiriqlar", ru: "Задания" },
  "tab.members": { ko: "멤버", zh: "成员", vi: "Thành viên", uz: "Aʼzolar", ru: "Участники" },
  "tab.settings": { ko: "설정", zh: "设置", vi: "Cài đặt", uz: "Sozlamalar", ru: "Настройки" },
  "server.checking": { ko: "연결 확인 중", zh: "正在检查连接", vi: "Đang kiểm tra kết nối", uz: "Ulanish tekshirilmoqda", ru: "Проверка соединения" },
  "server.online": { ko: "서버 연결됨", zh: "已连接服务器", vi: "Đã kết nối máy chủ", uz: "Serverga ulangan", ru: "Подключено к серверу" },
  "server.degraded": { ko: "서버 일부 기능 오류", zh: "服务器部分功能异常", vi: "Máy chủ gặp lỗi một phần", uz: "Serverda qisman xatolik", ru: "Сервер работает с ошибками" },
  "server.offline": { ko: "서버에 연결할 수 없음", zh: "无法连接服务器", vi: "Không thể kết nối máy chủ", uz: "Serverga ulanib boʻlmadi", ru: "Нет связи с сервером" },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: Lang = "ko"): string {
  return STRINGS[key][lang];
}
