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
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("dialog", (d) => d.accept());
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
await typeInto(0, "비계 위에서는 안전고리를 꼭 거세요.");
await tap("2명에게 보내기");
await check("전송 알림", "지시를 보냈어요");
await check("목록에 새 지시", "0/2명 확인");
await check("작업자 확인 반영(실시간)", "1/2명 확인", 9000);
await tap("비계 위에서는 안전고리를 꼭 거세요.");
await check("지시 상세: 러시아어 번역", "На лесах обязательно пристёгивайте страховку.");
await check("지시 상세: 베트남어 번역", "Trên giàn giáo nhất định phải móc dây an toàn.");
await page.screenshot({ path: path.join(outDir, "flow-3-detail.png") });

console.log("4) 관리자: 가입 승인 → 멤버 반영");
await page.goto(base + "/site/members", { waitUntil: "networkidle0" });
await tap("승인");
await check("승인 후 멤버 7명", "멤버 · 7");

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

console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
console.log("콘솔 오류:", errors.length ? [...new Set(errors)].join("\n") : "없음");
await browser.close();
server.close();
process.exit(fail > 0 ? 1 : 0);
