// 앱 live 모드 ↔ 실제 서버 ↔ 실제 Supabase 계정 통합 확인 (헤드리스 Chrome 2개: 관리자·구성원).
// 준비 (docs/phase6-report.md "live 모드 e2e"):
//   1) cd server && npx tsx scripts/e2e-accounts.ts            # 테스트 계정 → server/.e2e-accounts.json
//   2) cd server && npm run db:start / ENGINE=fake npm run dev  # 비용 없는 가짜 통역 엔진으로 서버 실행
//   3) cd frontend && npm run bundle:web:live                   # live 모드 웹 빌드 → dist-live
//   4) cd frontend && npm run e2e:live
// 웹 빌드는 REST·Socket.IO를 같은 출처(8767)로 부르고, 이 스크립트가 서버(4000)로 중계한다.
// (서버에 CORS가 없다. 실제 대상인 Android·iOS 앱에는 CORS가 적용되지 않는다.)
// 마이크: Chrome 가짜 장치에 macOS say 로 만든 음성(관리자 한국어, 구성원 베트남어)을 넣어
//         1:1 통화는 스트리밍(마이크 조각 → 서버 → 가짜 스트리밍 엔진 → 상대 재생·자막, 중복 재생 없음),
//         일괄 지시는 발화 단위(녹음 → 발화 감지 → 업로드 → 서버 디코딩)로 확인한다. ENGINE=fake 의 원문은 "[음성 ko] 4.7s" 형식.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const distDir = path.resolve(process.argv[2] ?? "dist-live");
const outDir = path.resolve(process.argv[3] ?? "e2e/output/live");
const SERVER = { host: "localhost", port: Number(process.env.SERVER_PORT ?? 4000) };
const PORT = 8767;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const accounts = JSON.parse(fs.readFileSync(path.resolve("../server/.e2e-accounts.json"), "utf8"));
fs.mkdirSync(outDir, { recursive: true });

// ─── 정적 파일 + 서버 중계 ───
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".ttf": "font/ttf" };
const proxied = (url) => /^\/(api\/|health|socket\.io\/)/.test(url);
const web = http.createServer((req, res) => {
  if (proxied(req.url)) {
    const upstream = http.request({ ...SERVER, path: req.url, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
    return;
  }
  let file = path.join(distDir, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
// WebSocket 업그레이드는 원본 바이트를 그대로 중계한다
web.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(SERVER.port, SERVER.host, () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
await new Promise((resolve) => web.listen(PORT, resolve));
const base = `http://localhost:${PORT}`;

// ─── 가짜 마이크 음성 (말 3–4초 + 무음 4초, 반복 재생) ───
const ffmpeg = createRequire(path.resolve("../server/package.json"))("ffmpeg-static");
function voice(name, sayVoice, text) {
  const aiff = path.join(outDir, `${name}.aiff`);
  const wav = path.join(outDir, `${name}.wav`);
  execFileSync("say", ["-v", sayVoice, "-o", aiff, text]);
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", aiff, "-af", "apad=pad_dur=4", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  return wav;
}
const koWav = voice("manager-ko", "Yuna", "안전모를 착용하고 작업을 시작하세요.");
const viWav = voice("member-vi", "Linh", "Tôi hiểu rồi. Tôi sẽ bắt đầu ngay.");

// ─── 검사 도구 ───
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const errors = [];

async function openUser(label, wav) {
  const profileDir = fs.mkdtempSync(path.join(outDir, `chrome-${label}-`));
  fs.mkdirSync(path.join(profileDir, "Default"), { recursive: true });
  fs.writeFileSync(path.join(profileDir, "Default", "Preferences"), JSON.stringify({
    autofill: { enabled: false, profile_enabled: false }, credentials_enable_service: false, profile: { password_manager_enabled: false },
  }));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profileDir,
    args: [
      "--disable-features=AutofillServerCommunication,PasswordGeneration",
      "--use-fake-ui-for-media-stream",
      // 오디오 서비스 샌드박스가 가짜 음성 파일 읽기를 막는다 (끄지 않으면 무음, 2026-10-12 확인)
      "--disable-features=AudioServiceSandbox",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  await browser.defaultBrowserContext().overridePermissions(base, ["microphone"]);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text().slice(0, 200)}`));
  page.on("dialog", (d) => d.accept());

  const u = { label, browser, page };
  u.has = (text) => page.evaluate((t) => document.body.innerText.includes(t), text);
  u.check = async (name, text, timeout = 8000) => {
    try {
      await page.waitForFunction((t) => (t instanceof RegExp ? false : document.body.innerText.includes(t)), { timeout }, text);
      pass++; console.log(`  ✓ [${label}] ${name}`);
      return true;
    } catch {
      fail++; console.log(`  ✗ [${label}] ${name} ("${text}" 없음)`);
      await page.screenshot({ path: path.join(outDir, `fail-${label}-${name.replace(/[^\p{L}\p{N}]+/gu, "_")}.png`) });
      return false;
    }
  };
  u.tap = async (text, { last = true } = {}) => {
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 8000 }, text).catch(() => {});
    const ok = await page.evaluate((t, last) => {
      const nodes = [...document.querySelectorAll("div,span,a,button")].filter((n) => n.innerText?.trim() === t && n.checkVisibility());
      const el = last ? nodes.at(-1) : nodes[0];
      const target = el?.closest('[role="button"],[role="tab"],[role="link"],[role="radio"],[role="checkbox"],a,button') ?? el;
      if (!target) return false;
      target.click();
      return true;
    }, text, last);
    if (!ok) console.log(`    [${label}] 누를 수 없음: ${text}`);
    await wait(600);
    return ok;
  };
  u.type = async (index, text) => {
    const inputs = [];
    for (const el of await page.$$("input, textarea")) {
      if (await el.evaluate((n) => n.checkVisibility() && n.getBoundingClientRect().width > 0)) inputs.push(el);
    }
    const el = index < 0 ? inputs.at(index) : inputs[index];
    await el.evaluate((n) => { n.focus(); n.select?.(); });
    if (await el.evaluate((n) => n.value)) {
      await el.evaluate((n) => n.setSelectionRange(0, n.value.length));
      await page.evaluate(() => document.execCommand("delete"));
    }
    for (const ch of text) await page.keyboard.sendCharacter(ch);
    await wait(200);
  };
  u.go = async (route) => { await page.goto(base + route, { waitUntil: "networkidle2" }); await wait(1500); };
  u.shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
  return u;
}

async function signIn(u, account, { name, langLabel, signInLabel, startLabel }) {
  await u.go("/welcome");
  await u.page.evaluate(() => localStorage.clear());
  await u.go("/sign-in");
  await u.type(0, account.email);
  await u.type(1, account.password);
  await u.tap(signInLabel);
  // 첫 로그인이면 프로필 설정, 아니면 바로 현장 목록
  await u.page.waitForFunction(() => /프로필 설정|Thiết lập hồ sơ|내 현장|Công trường của tôi/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  if (await u.page.evaluate(() => /프로필 설정|Thiết lập hồ sơ/.test(document.body.innerText))) {
    await u.type(0, name);
    await u.tap(langLabel);
    await u.tap(startLabel);
  }
}

// E2E_STREAMING=off: 서버를 STREAMING=off 로 띄웠을 때 — 앱이 문장 단위 방식으로 바꿔 통화하는지(폴백) 확인
const STREAMING = process.env.E2E_STREAMING !== "off";
// E2E_ONLY_CALL=1: 1:1 통화만 확인 (실제 OpenAI 로 돌릴 때 다른 구간의 통역 비용을 쓰지 않기 위해 — 대화·일괄 지시·문자 지시 건너뜀)
const ONLY_CALL = process.env.E2E_ONLY_CALL === "1";
const runId = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "");
const SITE = `E2E 현장 ${runId}`;
const MANAGER_NAME = "E2E 관리자";
const MEMBER_NAME = "Nguyen E2E";

const manager = await openUser("관리자", koWav);
const member = await openUser("구성원", viWav);

try {
  console.log("1) 로그인 (실제 Supabase) → 프로필");
  await signIn(manager, accounts.manager, { name: MANAGER_NAME, langLabel: "한국어", signInLabel: "로그인", startLabel: "시작하기" });
  await manager.check("관리자 로그인 → 현장 목록", "내 현장", 15000);
  await signIn(member, accounts.member, { name: MEMBER_NAME, langLabel: "Tiếng Việt", signInLabel: "로그인", startLabel: "Bắt đầu" });
  await member.check("구성원 로그인 → 현장 목록(베트남어)", "Công trường của tôi", 15000);

  console.log("2) 관리자: 현장 만들기 → 가입 코드");
  await manager.tap("현장 만들기", { last: false });
  await manager.type(0, SITE);
  await manager.tap("현장 만들기");
  await manager.check("가입 코드 화면", "가입 코드", 10000);
  if (await manager.has("새 코드 발급") && !(await manager.page.evaluate(() => /\b[A-Z0-9]{4} [A-Z0-9]{4}\b/.test(document.body.innerText)))) {
    await manager.tap("새 코드 발급");
  }
  await manager.page.waitForFunction(() => /\b[A-Z0-9]{4} [A-Z0-9]{4}\b/.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
  const code = await manager.page.evaluate(() => document.body.innerText.match(/\b([A-Z0-9]{4}) ([A-Z0-9]{4})\b/)?.slice(1).join(""));
  console.log("    가입 코드:", code ? "발급됨" : "없음");
  await manager.shot("live-1-code");

  console.log("3) 구성원: 코드로 참여 요청 → 관리자 승인 → 실시간 승인 알림");
  await member.tap("Tham gia bằng mã");
  await member.type(0, code ?? "");
  await member.tap("Gửi yêu cầu");
  await member.check("참여 요청 → 승인 대기", "Đang chờ duyệt", 10000);
  await manager.go("/site/members");
  await manager.check("관리자: 가입 요청 실시간 표시", "가입 요청 · 1", 10000);
  await manager.tap("승인");
  await manager.check("승인 후 멤버 목록에 구성원", MEMBER_NAME);
  await member.check("구성원: 승인 알림(실시간)", "Đã được duyệt vào", 10000);
  await wait(1500);
  await member.tap(SITE);
  await member.check("구성원: 현장 입장", "Nhóm công trường", 10000);

  if (!ONLY_CALL) {
  console.log("4) 1:1 대화: 구성원 텍스트 → 관리자에게 한국어 통역(가짜 엔진)");
  await member.go("/site/members");
  await member.tap(MANAGER_NAME);
  await member.tap("Nhắn riêng");
  await wait(1500);
  await member.type(-1, "Xin chào quản lý");
  await member.page.evaluate(() => [...document.querySelectorAll('[aria-label="send"]')].find((n) => n.checkVisibility())?.click());
  await member.check("구성원: 내 메시지 표시", "Xin chào quản lý");
  await manager.go("/site");
  await manager.tap(MEMBER_NAME);
  await manager.check("관리자: 한국어 통역문 수신", "[ko] Xin chào quản lý", 10000);
  await manager.shot("live-2-chat");
  }

  console.log(STREAMING ? "5) 1:1 통역 통화 (스트리밍): 관리자 ↔ 구성원, 양쪽 실제 마이크 → 말하는 동안 전송" : "5) 1:1 통역 통화 (서버 스트리밍 꺼짐 → 문장 단위 방식으로 폴백)");
  await member.go("/site");
  await manager.go("/site/members");
  await manager.tap(MEMBER_NAME);
  await manager.tap("통역 통화");
  await manager.check("관리자: 거는 중", `${MEMBER_NAME} 님을 부르는 중…`);
  await member.check("구성원: 수신 화면(실시간)", `Cuộc gọi phiên dịch từ ${MANAGER_NAME}`, 10000);
  await member.tap("Nghe");
  await manager.check("관리자: 통화 중", "통화 중", 10000);
  if (STREAMING) {
    await manager.check("관리자: 스트리밍 방식으로 연결", "실시간 통역 · 말하는 동안 전송", 15000);
    await member.check("구성원: 스트리밍 방식으로 연결", "Dịch trực tiếp · gửi trong khi nói", 15000);
  } else {
    await manager.check("관리자: 문장 단위 방식으로 폴백", "문장 단위 통역", 15000);
    await member.check("구성원: 문장 단위 방식으로 폴백", "Dịch theo từng câu", 15000);
  }
  await manager.check("관리자: 마이크 듣는 중", "듣고 있어요", 10000);
  await member.check("구성원: 관리자 말이 베트남어로 도착", "[vi] [음성 ko]", 30000);
  await manager.check("관리자: 구성원 말이 한국어로 도착", "[ko] [음성 vi]", 30000);
  await wait(4000); // 기록 알림(message:new)까지 받을 시간
  if (!STREAMING) {
    // 폴백: 스트림 재생 없이 기록 알림으로 재생 대기열에 들어간다
    const stats = await member.page.evaluate(() => window.__syncrewPlayback);
    if (stats.streamChunks === 0 && stats.enqueued.length > 0) { pass++; console.log(`  ✓ [구성원] 폴백: 스트림 조각 0, 기록 알림 재생 ${stats.enqueued.length}건`); }
    else { fail++; console.log("  ✗ [구성원] 폴백 재생", stats); }
  } else {
    // 스트림으로 받은 음성 조각을 재생했고, 같은 문장의 기록 알림은 다시 재생하지 않았는지 (사용자 필수 요구)
    const stats = await member.page.evaluate(() => window.__syncrewPlayback);
    const replayed = stats.streamed.filter((id) => stats.enqueued.includes(id));
    const ok = stats.streamTurns > 0 && stats.streamChunks > 0 && stats.streamed.length > 0 && stats.skipped.length > 0 && replayed.length === 0;
    if (ok) { pass++; console.log(`  ✓ [구성원] 스트림 재생 ${stats.streamTurns}턴·조각 ${stats.streamChunks}개, 기록 알림 재생 건너뜀 ${stats.skipped.length}건, 중복 재생 0`); }
    else { fail++; console.log("  ✗ [구성원] 스트림 재생·중복 재생 방지", stats); }
    const mStats = await manager.page.evaluate(() => window.__syncrewPlayback);
    if (mStats.streamChunks > 0 && mStats.streamed.every((id) => !mStats.enqueued.includes(id))) { pass++; console.log("  ✓ [관리자] 스트림 재생, 중복 재생 0"); }
    else { fail++; console.log("  ✗ [관리자] 스트림 재생·중복 재생 방지", mStats); }
    await member.check("구성원: 실시간 자막(원문)", "[음성 ko]");
  }
  await manager.shot("live-3-call-manager");
  await member.shot("live-3-call-member");
  await manager.tap("끊기");
  await manager.check("관리자: 통화 종료", "통화가 끝났어요");
  await member.check("구성원: 통화 종료 알림", "Cuộc gọi đã kết thúc", 10000);

  if (!ONLY_CALL) {
  console.log("6) 관리자 실시간 일괄 지시 → 구성원 자동 수신");
  await member.go("/site");
  await manager.go("/site/instructions");
  await manager.tap("실시간 지시 시작");
  await manager.check("대상 선택 화면", "실시간 일괄 지시");
  await manager.tap("1명에게 실시간 지시 시작");
  await manager.check("지시 중 화면", "구성원 연결 상태", 10000);
  await member.check("구성원: 수신 화면 자동 열림", `Chỉ thị trực tiếp từ ${MANAGER_NAME}`, 10000);
  await member.check("구성원: 관리자 말이 베트남어로 도착", "[vi] [음성 ko]", 30000);
  {
    // 대조군: 일괄 지시(발화 단위 방식)의 발화는 기록 알림으로 재생 대기열에 들어간다
    await wait(1500);
    const stats = await member.page.evaluate(() => window.__syncrewPlayback);
    const fresh = stats.enqueued.filter((id) => !stats.streamed.includes(id));
    if (fresh.length > 0) { pass++; console.log(`  ✓ [구성원] 대조군: 일괄 지시 발화는 재생 대기열에 들어감 (${fresh.length}건)`); }
    else { fail++; console.log("  ✗ [구성원] 대조군: 일괄 지시 발화 재생", stats); }
  }
  await manager.shot("live-4-broadcast-manager");
  await member.shot("live-4-broadcast-member");
  await manager.tap("지시 끝내기");
  await manager.check("관리자: 지시 종료", "실시간 지시가 끝났어요");
  await member.check("구성원: 지시 종료 표시", "Chỉ thị trực tiếp đã kết thúc", 10000);

  console.log("7) 문자 지시 → 구성원 확인 → 관리자 진행 상태 갱신");
  await manager.go("/site/instruction/new");
  await manager.type(0, "오후 2시까지 3층 정리하세요");
  // 대상 빠른 선택: 실제 서버의 접속 상태로 만든 칩 → 직접 선택 + 보내기 전 요약
  await manager.check("관리자: 접속 중 칩(실제 접속 상태)", "접속 중 · 1");
  await manager.tap("접속 중 · 1");
  await manager.check("관리자: 보내기 전 요약", "1명 · 1개 언어 · 연결 1명");
  await manager.tap("1명에게 보내기");
  await manager.check("관리자: 전송", "지시를 보냈어요", 10000);
  await member.go("/site/instructions");
  await member.check("구성원: 받은 지시(베트남어 통역)", "[vi] 오후 2시까지 3층 정리하세요", 15000);
  await member.tap("Đã hiểu");
  await manager.go("/site/instructions");
  await manager.check("관리자: 확인 반영", "1/1명 확인", 10000);
  await manager.shot("live-5-instructions");
  }
} catch (error) {
  fail++;
  console.log("  ✗ 진행 중 오류:", error.message);
} finally {
  console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
  console.log("콘솔 오류:", errors.length ? [...new Set(errors)].join("\n") : "없음");
  await manager.browser.close();
  await member.browser.close();
  web.close();
  process.exit(fail > 0 ? 1 : 0);
}
