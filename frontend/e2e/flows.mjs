// 웹 빌드(dist-check)를 헤드리스 Chrome으로 열어 데모(mock) 모드 사용 흐름을 자동 검증한다.
// 실행: npm run e2e  (먼저 npm run bundle:web)
// 주의: 헤드리스 Chrome은 비밀번호 입력 뒤 실제 키 이벤트를 잃는 경우가 있어,
//       글자 입력은 IME 경로(sendCharacter)로 보낸다. 앱 문제가 아니다 (2026-10-11 조사).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const distDir = path.resolve(process.argv[2] ?? "dist-check");
const outDir = path.resolve(process.argv[3] ?? "e2e/output");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(outDir, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".ttf": "font/ttf" };
const server = http.createServer((req, res) => {
  let file = path.join(distDir, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(8766);
const base = "http://localhost:8766";
// 검증용 Chrome 프로필: 자동완성·비밀번호 저장/추천 끄기 (팝업이 입력을 가로채지 않도록)
const profileDir = fs.mkdtempSync(path.join(outDir, "chrome-"));
fs.mkdirSync(path.join(profileDir, "Default"), { recursive: true });
fs.writeFileSync(path.join(profileDir, "Default", "Preferences"), JSON.stringify({
  autofill: { enabled: false, profile_enabled: false, credit_card_enabled: false },
  credentials_enable_service: false,
  credentials_enable_autosignin: false,
  profile: { password_manager_enabled: false },
}));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: profileDir,
  args: ["--disable-features=AutofillServerCommunication,PasswordGeneration,AutofillEnableAccountStorageForPasswords"],
});
// 헤드리스 Chrome 에는 마이크가 없으므로 권한을 거부해 둔다 (핸즈프리는 '마이크 권한 필요' 안내 → 데모 발화 버튼으로 검증)
await browser.defaultBrowserContext().overridePermissions(base, []);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("dialog", (d) => void d.accept().catch(() => undefined)); // 이미 닫힌 확인 창이면 무시
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = async (name, text, timeout = 6000) => {
  try {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
    pass++; console.log("  ✓", name);
  } catch {
    fail++; console.log("  ✗", name, `(\"${text}\" 없음)`);
    await page.screenshot({ path: path.join(outDir, `fail-${name.replace(/\W+/g, "_")}.png`) });
  }
};
// 화면에서 글자로 버튼 누르기 (가장 안쪽 일치 요소의 누를 수 있는 조상)
const tap = async (text) => {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 6000 }, text).catch(() => {});
  const ok = await page.evaluate((t) => {
    const nodes = [...document.querySelectorAll("div,span,a,button")].filter((n) => n.innerText?.trim() === t && n.checkVisibility());
    const el = nodes.at(-1);
    const target = el?.closest('[role="button"],[role="tab"],[role="link"],[role="radio"],[role="checkbox"],a,button') ?? el;
    if (!target) return false;
    target.click();
    return true;
  }, text);
  if (!ok) console.log("    (누를 수 없음:", text, ")");
  await wait(500);
};
// 화면에 실제로 보이는 입력창만 대상으로 한다 (웹 스택은 이전 화면을 숨긴 채 남겨 둠)
const visibleInputs = async () => {
  const all = await page.$$("input, textarea");
  const visible = [];
  for (const el of all) if (await el.evaluate((n) => n.checkVisibility() && n.getBoundingClientRect().width > 0)) visible.push(el);
  return visible;
};
const typeInto = async (index, text) => {
  const inputs = await visibleInputs();
  const el = inputs[index];
  // 기존 내용 지우기: 포커스 → 전체 선택 → 삭제 (IME 입력 경로 사용)
  await el.evaluate((n) => { n.focus(); n.select?.(); });
  await page.keyboard.sendCharacter(""); // no-op로 포커스 유지 확인
  const current = await el.evaluate((n) => n.value);
  if (current) {
    await el.evaluate((n) => n.setSelectionRange(0, n.value.length));
    await page.evaluate(() => document.execCommand("delete"));
  }
  for (const ch of text) await page.keyboard.sendCharacter(ch);
  await wait(150);
};

console.log("1) 회원가입 → 프로필 → 현장 선택");
await page.goto(base + "/welcome", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await page.goto(base + "/welcome", { waitUntil: "networkidle0" });
await tap("Tiếng Việt");
await check("시작 화면 언어 전환(베트남어)", "Đăng ký");
await tap("Đăng ký");
await check("회원가입 화면", "Tạo tài khoản");
await typeInto(0, "bad-email");
await typeInto(1, "123");
await tap("Đăng ký");
await check("입력 검증: 이메일 형식", "Vui lòng kiểm tra định dạng email.");
await typeInto(0, "worker@syncrew.app");
await typeInto(1, "password123");
await tap("Đăng ký");
await check("프로필 설정 화면", "Thiết lập hồ sơ");
await typeInto(0, "Trần Văn Tú");
await tap("Bắt đầu");
await check("현장 선택 화면 + 인사", "Xin chào, Trần Văn Tú");
await page.screenshot({ path: path.join(outDir, "flow-1-sites.png") });

console.log("2) 코드로 현장 참여 → 4초 뒤 자동 승인");
await tap("Tham gia bằng mã");
await typeInto(0, "WRONG123");
await tap("Gửi yêu cầu");
await check("잘못된 코드 안내", "Mã không đúng hoặc đã hết hạn.");
await typeInto(0, "sync2026");
await tap("Gửi yêu cầu");
await check("참여 요청 → 승인 대기", "Đang chờ duyệt");
await check("관리자 승인 알림(데모)", "Đã được duyệt vào", 8000);
await page.screenshot({ path: path.join(outDir, "flow-2-approved.png") });
await wait(1500);
await tap("인천 항만 창고 현장");
await check("승인된 현장 입장", "Nhóm công trường");

console.log("3) 관리자: 일괄 지시 → 진행 상태 갱신");
await page.evaluate(() => {
  localStorage.setItem("syncrew.mockProfile", JSON.stringify({ id: "me", email: "m@syncrew.app", displayName: "장태웅", preferredLang: "ko", autoPlay: false, speechRate: 1 }));
  localStorage.setItem("syncrew.siteId", "s_a");
  localStorage.setItem("syncrew.uiLang", "ko");
});
await page.goto(base + "/site/instruction/new", { waitUntil: "networkidle0" });
await check("지시 작성 화면", "새 지시 보내기");
await tap("직접 선택");
await tap("Nguyễn Văn An");
await tap("Иван Петров");
await check("선택 인원 반영", "2명에게 보내기");
await check("보내기 전 요약", "2명 · 2개 언어 · 연결 2명");
// 직접 선택 모드에서는 이름 검색칸이 첫 입력창이다
await typeInto(1, "비계 위에서는 안전고리를 꼭 거세요.");
await tap("2명에게 보내기");
await check("전송 알림", "지시를 보냈어요");
await check("목록에 새 지시", "0/2명 확인");
await check("작업자 확인 반영(실시간)", "1/2명 확인", 9000);
await tap("비계 위에서는 안전고리를 꼭 거세요.");
await check("지시 상세: 러시아어 번역", "На лесах обязательно пристёгивайте страховку.");
await check("지시 상세: 베트남어 번역", "Trên giàn giáo nhất định phải móc dây an toàn.");
await page.screenshot({ path: path.join(outDir, "flow-3-detail.png") });

console.log("3-1) 관리자: 일괄 지시 대상 빠른 선택 (칩·전체 선택·검색·지난번 대상)");
// 화면에 실제로 보이는 정확히 일치하는 글자 요소 수 (검색으로 가려졌는지 확인용)
const visibleCount = (text) =>
  page.evaluate((t) => [...document.querySelectorAll("div,span")].filter((n) => n.innerText?.trim() === t && n.checkVisibility() && n.children.length === 0).length, text);
const expectCount = async (name, actual, expected) => {
  if (actual === expected) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, { actual, expected }); }
};
await page.goto(base + "/site/instruction/new", { waitUntil: "networkidle0" });
await check("지난번 대상 칩(앞에서 보낸 2명)", "지난번 대상 · 2");
await check("접속 중 칩", "접속 중 · 4");
await check("이어폰 연결됨 칩", "이어폰 연결됨 · 3");
await check("현장 전체 요약", "5명 · 5개 언어 · 연결 4명");
await check("연결 끊긴 대상 안내(문자 지시)", "다시 접속하면");
await tap("지난번 대상 · 2");
await check("지난번 대상 복원 → 직접 선택", "2명에게 보내기");
await tap("선택 해제");
await check("선택 해제", "0명에게 보내기");
await tap("접속 중 · 4");
await check("접속 중 칩 → 4명", "4명에게 보내기");
await tap("이어폰 연결됨 · 3");
await check("켜진 칩 다시 누르면 그 묶음만 해제(휴대폰 스피커 1명 남음)", "1명에게 보내기");
await tap("Oʻzbekcha · 1");
await check("언어 칩 조합", "2명에게 보내기");
await check("조합 요약(연결 끊긴 사람 포함)", "2명 · 2개 언어 · 연결 1명");
await page.screenshot({ path: path.join(outDir, "flow-3-1-picker.png") });
await typeInto(0, "иван");
await wait(300);
await expectCount("검색: 일치하는 사람만 보임", await visibleCount("Иван Петров"), 1);
await expectCount("검색: 일치하지 않는 사람은 숨김(대조군)", await visibleCount("Nguyễn Văn An"), 0);
await tap("전체 선택");
await check("검색 결과만 전체 선택(선택 유지 + 1명)", "3명에게 보내기");
await tap("선택 반전");
await check("검색 결과만 반전", "2명에게 보내기");
await typeInto(0, "zzz");
await check("검색 결과 없음 안내", "일치하는 구성원이 없어요.");
await typeInto(0, "");
await wait(300);
await expectCount("검색 지우면 전체 목록", await visibleCount("Nguyễn Văn An"), 1);
await tap("선택 반전");
await check("전체 반전(2명 → 나머지 3명)", "3명에게 보내기");
await typeInto(1, "자재는 B문으로 들이세요.");
await tap("3명에게 보내기");
await check("선택한 3명에게 전송", "0/3명 확인");
await tap("자재는 B문으로 들이세요.");
await check("받는 사람: Nguyễn", "Nguyễn Văn An");
await check("받는 사람: Иван", "Иван Петров");
await check("받는 사람: 김민준", "김민준");
await expectCount("선택 안 한 사람은 받는 사람에 없음(李伟)", await visibleCount("李伟"), 0);
await expectCount("선택 안 한 사람은 받는 사람에 없음(Aziz)", await visibleCount("Aziz Karimov"), 0);
await page.screenshot({ path: path.join(outDir, "flow-3-1-targets.png") });

console.log("3-2) 관리자: 작업조 저장(B2) — 칩 선택·저장·덮어쓰기·작업조로 지시·이름 바꾸기·삭제");
await page.goto(base + "/site/instruction/new", { waitUntil: "networkidle0" });
await check("저장된 작업조 칩(데모)", "1층 작업조 · 2");
await tap("1층 작업조 · 2");
await check("작업조 칩 → 그 사람들 선택", "2명에게 보내기");
await tap("Иван Петров");
await check("한 명 더 고름", "3명에게 보내기");
await tap("작업조로 저장");
await typeInto(1, "철근조");
await tap("3명 저장");
await check("작업조 저장 알림", "'철근조' 작업조를 저장했어요");
await check("새 작업조 칩", "철근조 · 3");
await tap("선택 해제");
await check("선택 해제", "0명에게 보내기");
await tap("철근조 · 3");
await check("새 작업조 칩으로 선택", "3명에게 보내기");
// 같은 이름으로 저장 = 구성원 바꾸기 (확인 문구 후 덮어쓰기)
await tap("Иван Петров");
await tap("작업조로 저장");
await typeInto(1, "철근조");
await check("같은 이름 경고", "같은 이름의 작업조가 있어요");
await tap("2명으로 바꾸기");
await check("덮어쓰기 알림", "'철근조' 작업조를 바꿨어요");
await check("작업조 인원 갱신", "철근조 · 2");
await tap("선택 해제");
await tap("철근조 · 2");
await typeInto(1, "철근 반입을 시작하세요.");
await tap("2명에게 보내기");
await check("작업조로 지시 전송", "0/2명 확인");
await tap("철근 반입을 시작하세요.");
await check("받는 사람: 작업조 구성원(Nguyễn)", "Nguyễn Văn An");
await check("받는 사람: 작업조 구성원(李伟)", "李伟");
await expectCount("작업조에서 뺀 사람은 받지 않음(Иван)", await visibleCount("Иван Петров"), 0);
await page.goBack();
await wait(800);
// 관리 화면 (새로 고치면 데모 데이터가 초기화되므로 앱 안에서 이동)
await tap("문자로 지시하기");
await tap("직접 선택");
await tap("작업조 관리");
await check("작업조 관리 화면", "현장 관리자끼리 함께 써요");
await check("목록: 데모 작업조", "1층 작업조");
await check("목록: 저장한 작업조", "철근조");
await tap("이름 바꾸기"); // 이름순 마지막 = 철근조
await typeInto(0, "철근 1조");
await tap("저장");
await check("이름 바꾸기", "철근 1조");
await tap("삭제");
await check("삭제 확인", "'철근 1조' 작업조를 삭제할까요?");
await tap("삭제");
await wait(800);
await expectCount("삭제됨", await visibleCount("철근 1조"), 0);
await expectCount("다른 작업조는 남음(대조군)", await visibleCount("1층 작업조"), 1);
await page.screenshot({ path: path.join(outDir, "flow-3-2-groups.png") });

console.log("4) 관리자: 가입 승인 → 멤버 반영");
await page.goto(base + "/site/members", { waitUntil: "networkidle0" });
await tap("승인");
await check("승인 후 멤버 7명", "멤버 · 7");
// 관리자 지정·해제. 헤드리스 Chrome 은 클릭 처리 중에 뜬 확인 창을 수락 전에 닫아 버리는 경우가 있어(2026-10-14 확인)
// 브라우저 확인 창은 "확인"으로 바꿔 둔다 (앱 동작 검증과 무관)
await page.evaluate(() => { window.confirm = () => true; });
const managerBadges = () => visibleCount("관리자");
const beforeBadges = await managerBadges();
await tap("Иван Петров");
await tap("관리자로 지정");
await wait(800);
await expectCount("관리자 지정 → 관리자 표시 하나 늘어남", await managerBadges(), beforeBadges + 1);
await tap("Иван Петров");
await check("지정된 사람에게는 해제 버튼", "관리자 해제");
await tap("관리자 해제");
await wait(800);
await expectCount("관리자 해제 → 원래대로", await managerBadges(), beforeBadges);

console.log("5) 구성원: 지시 확인 → 작업 완료");
await page.evaluate(() => {
  localStorage.setItem("syncrew.mockProfile", JSON.stringify({ id: "me", email: "w@syncrew.app", displayName: "Aziz", preferredLang: "uz", autoPlay: false, speechRate: 1 }));
  localStorage.setItem("syncrew.siteId", "s_b");
  localStorage.setItem("syncrew.uiLang", "uz");
});
await page.goto(base + "/site/instructions", { waitUntil: "networkidle0" });
await check("받은 지시: 우즈베크어 번역", "Materiallarni B darvoza orqali olib kiring.");
await tap("Tushundim");
await check("확인 후 상태", "Tasdiqlandi");
await tap("Materiallarni B darvoza orqali olib kiring.");
await typeInto(0, "B darvoza tayyor");
await tap("Ish bajarildi");
await check("작업 완료 표시", "Bajarildi");
await page.screenshot({ path: path.join(outDir, "flow-5-member.png") });

console.log("6) 대화: 텍스트 전송 → 상대 응답(번역)");
await page.goto(base + "/site/chat/s_b_group", { waitUntil: "networkidle0" });
await wait(1500);
{
  const inputs = await visibleInputs();
  await inputs.at(-1).evaluate((n) => n.focus());
  for (const ch of "Bu qismni qayta tekshiring.") await page.keyboard.sendCharacter(ch);
}
await wait(300);
await page.evaluate(() => [...document.querySelectorAll('[aria-label="send"]')].find((n) => n.checkVisibility())?.click());
await check("내 메시지 표시", "Bu qismni qayta tekshiring.");
await check("상대 응답이 내 언어로", "Tushundim. Hozir boshlayman.", 8000);

console.log("7) 1:1 실시간 통역 통화 (관리자 ↔ 베트남어 작업자)");
await page.evaluate(() => {
  localStorage.setItem("syncrew.mockProfile", JSON.stringify({ id: "me", email: "m@syncrew.app", displayName: "장태웅", preferredLang: "ko", autoPlay: false, speechRate: 1 }));
  localStorage.setItem("syncrew.siteId", "s_a");
  localStorage.setItem("syncrew.uiLang", "ko");
});
await page.goto(base + "/site/members", { waitUntil: "networkidle0" });
await check("멤버 이어폰 상태: 블루투스", "SafeHelmet BT-2");
await check("멤버 이어폰 상태: 휴대폰 스피커", "휴대폰 마이크·스피커");
await tap("Nguyễn Văn An");
await tap("통역 통화");
await check("통화 거는 중", "Nguyễn Văn An 님을 부르는 중…");
await check("상대가 받으면 통화 중", "통화 중", 6000);
await check("마이크 권한 없음 안내", "마이크 권한이 필요해요");
await check("버튼 없이 말하면 된다는 안내", "버튼을 누를 필요가 없어요");
await page.screenshot({ path: path.join(outDir, "flow-7-call.png") });
await tap("데모: 말한 것으로 보내기");
await check("상대 통역 응답(한국어)", "알겠습니다. 바로 시작하겠습니다.", 8000);
await tap("끊기");
await check("통화 종료", "통화가 끝났어요");
await tap("대화 기록 보기");
await wait(1000);
{
  // 대화 기록 화면에서 통화 중 발화에 '통화' 표시가 붙는지 (화면에 보이는 표시 개수)
  const tags = await page.evaluate(() => [...document.querySelectorAll("div")].filter((n) => n.innerText?.trim() === "통화" && n.checkVisibility() && n.children.length === 0).length);
  const onChat = page.url().includes("/site/chat/");
  if (onChat && tags >= 2) { pass++; console.log("  ✓ 대화 기록에 통화 발화 표시"); }
  else { fail++; console.log("  ✗ 대화 기록에 통화 발화 표시", { url: page.url(), tags }); }
}
await page.screenshot({ path: path.join(outDir, "flow-7-history.png") });

console.log("8) 관리자 실시간 일괄 지시 (여러 언어)");
await page.goto(base + "/site/instructions", { waitUntil: "networkidle0" });
await tap("실시간 지시 시작");
await check("대상 선택 화면", "실시간 일괄 지시");
await check("대상자 연결 상태 요약", "명 연결됨");
await check("연결 끊긴 대상 안내", "다시 접속하면");
await tap("직접 선택");
await tap("Nguyễn Văn An");
await tap("Иван Петров");
await check("선택 인원 반영", "2명에게 실시간 지시 시작");
await tap("2명에게 실시간 지시 시작");
await check("지시 중 화면", "구성원 연결 상태");
await check("구성원별 이어폰 상태", "Jabra Talk");
await tap("데모: 말한 것으로 보내기");
await check("언어별 통역 상태(베트남어)", "VI", 6000);
await check("언어별 통역 상태(러시아어)", "RU");
await wait(1500);
await page.screenshot({ path: path.join(outDir, "flow-8-broadcast.png") });
await tap("안전모를 착용하고 작업을 시작하세요.");
await check("발화별 상세: 베트남어 통역문", "Hãy đội mũ bảo hộ");
await check("발화별 상세: 러시아어 통역문", "Наденьте каску");
await page.goBack();
await wait(800);
await tap("지시 끝내기");
await check("지시 종료", "실시간 지시가 끝났어요");
await tap("작업 지시");
await check("지시 기록에 실시간 표시", "실시간");
await check("실시간 지시 전달 수", "명 전달", 8000);

console.log("9) 구성원: 관리자 실시간 지시 자동 수신 (우즈베크어)");
await page.evaluate(() => {
  localStorage.setItem("syncrew.mockProfile", JSON.stringify({ id: "me", email: "w@syncrew.app", displayName: "Aziz", preferredLang: "uz", autoPlay: false, speechRate: 1 }));
  localStorage.setItem("syncrew.siteId", "s_b");
  localStorage.setItem("syncrew.uiLang", "uz");
});
await page.goto(base + "/site/instructions", { waitUntil: "networkidle0" });
await tap("Demo: jonli topshiriqni qabul qilish");
await check("지시 시작 시 수신 화면 자동 열림", "박현우ning jonli topshirigʻi", 6000);
await check("내 언어로 통역된 지시", "Kaskani kiyib, ishni boshlang.", 6000);
await check("관리자 원문 함께 표시", "안전모를 착용하고 작업을 시작하세요.");
await check("두 번째 지시", "Materiallarni B darvoza orqali olib kiring.", 6000);
await page.screenshot({ path: path.join(outDir, "flow-9-listener.png") });
await check("관리자가 끝내면 종료 표시", "Jonli topshiriq tugadi", 8000);
// 새로 고치면 데모 데이터가 초기화되므로 앱 안에서 뒤로 간다
await page.goBack();
await wait(1000);
await check("받은 지시 기록에 실시간 표시", "Jonli");

console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
console.log("콘솔 오류:", errors.length ? [...new Set(errors)].join("\n") : "없음");
await browser.close();
server.close();
process.exit(fail > 0 ? 1 : 0);
