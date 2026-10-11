// 주요 화면을 캡처한다 (디자인 확인용). 실행: npm run e2e:screens
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const distDir = path.resolve(process.argv[2] ?? "dist-check");
const outDir = path.resolve(process.argv[3] ?? "e2e/output/screens");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(outDir, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".ttf": "font/ttf", ".ico": "image/x-icon", ".json": "application/json", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(distDir, url);
  if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(8765);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--lang=ko-KR"] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
const base = "http://localhost:8765";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, url, ms = 1500) => {
  if (url) await page.goto(base + url, { waitUntil: "networkidle0" });
  await wait(ms);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log("shot", name, page.url().replace(base, ""));
};
const login = async (profile, siteId) => {
  await page.goto(base + "/welcome", { waitUntil: "networkidle0" });
  await page.evaluate((profile, siteId) => {
    localStorage.clear();
    localStorage.setItem("syncrew.mockSession", profile.email);
    localStorage.setItem("syncrew.mockProfile", JSON.stringify(profile));
    localStorage.setItem("syncrew.siteId", siteId);
    localStorage.setItem("syncrew.uiLang", profile.preferredLang);
  }, profile, siteId);
};
const clickText = async (text) => {
  const ok = await page.evaluate((text) => {
    const el = [...document.querySelectorAll("div,span")].reverse().find((n) => n.textContent?.trim() === text || n.textContent?.includes(text) && n.children.length === 0);
    if (!el) return false;
    el.click();
    return true;
  }, text);
  if (!ok) console.log("click failed:", text);
};

// 1) 로그인 전
await page.goto(base + "/", { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.clear());
await shot("01-welcome", "/welcome");
await shot("02-sign-in", "/sign-in", 800);

// 2) 관리자 (한국어, A동 현장)
const manager = { id: "me", email: "manager@syncrew.app", displayName: "장태웅", preferredLang: "ko", autoPlay: false, speechRate: 1 };
await login(manager, "s_a");
await shot("03-conversations", "/", 2500);
await shot("04-chat-direct", "/site/chat/c_nguyen", 2000);
await page.type("textarea", "자재는 B게이트로 반입해 주세요.");
await wait(300);
await shot("05-chat-typing", null, 300);
await page.click('[aria-label="send"]');
await shot("06-chat-sent", null, 4500);
await shot("07-group", "/site/chat/s_a_group", 2000);
await shot("08-instructions-manager", "/site/instructions", 2000);
await shot("09-instruction-new", "/site/instruction/new", 1500);
await shot("10-members", "/site/members", 2000);
await shot("11-join-code", "/site/join-code", 2000);
await shot("12-settings", "/site/settings", 2000);
await shot("13-sites", "/sites", 2000);
await page.goto(base + "/site/instructions", { waitUntil: "networkidle0" });
await wait(1500);
await clickText("오후 2시까지");
await shot("14-instruction-detail-manager", null, 2000);

// 3) 구성원 (베트남어, 평택 현장)
const member = { id: "me", email: "an@syncrew.app", displayName: "Nguyễn Văn Bình", preferredLang: "vi", autoPlay: false, speechRate: 1 };
await login(member, "s_b");
await shot("15-member-conversations", "/", 2500);
await shot("16-member-inbox", "/site/instructions", 2000);
await clickText("Hãy đưa vật tư");
await shot("17-member-instruction-detail", null, 2000);
await shot("18-member-group-chat", "/site/chat/s_b_group", 2000);

console.log("ERRORS:", errors.length ? "\n" + [...new Set(errors)].join("\n") : "none");
await browser.close();
server.close();
