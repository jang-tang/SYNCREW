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
const onRequest = (req, res) => {
  if (proxied(req.url)) {
    const upstream = http.request({ ...SERVER, path: req.url, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400); res.end(); // 잘못된 %인코딩
    return;
  }
  let file = path.join(distDir, pathname);
  // dist 폴더 밖(../ 등)의 파일은 열지 않는다
  const rel = path.relative(distDir, file);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    res.writeHead(404); res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
};
// WebSocket 업그레이드는 원본 바이트를 그대로 중계한다
const onUpgrade = (req, socket, head) => {
  const upstream = net.connect(SERVER.port, SERVER.host, () => {
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
};
// 이 PC 안(루프백)에서만 연다. Chrome 은 localhost 를 ::1·127.0.0.1 어느 쪽으로도 접속하므로 두 주소 모두 이 스크립트가 연다
// (한쪽만 열면 다른 사용자가 나머지 주소의 8767 을 먼저 열어 로그인 화면·비밀번호를 가로챌 수 있다).
// IPv6 루프백이 없는 PC 에서는 아무도 ::1 을 열 수 없으므로 건너뛴다. 그 밖의 실패(이미 사용 중 등)는 그대로 중단한다.
const webServers = [];
for (const host of ["127.0.0.1", "::1"]) {
  const server = http.createServer(onRequest).on("upgrade", onUpgrade);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(PORT, host, () => { server.off("error", reject); resolve(); });
    });
  } catch (error) {
    if (host === "::1" && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) continue;
    throw error;
  }
  webServers.push(server);
}
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

/** 멤버 줄의 ⋯ 로 메뉴 열기 (C2: 사람을 누르면 바로 연결되므로) */
async function openMenu(u, name) {
  await u.page.evaluate((n) => {
    // ⋯ 이름은 화면 언어를 따른다 (ko 더보기, vi Thêm)
    const MORE = '[aria-label="더보기"],[aria-label="Thêm"]';
    const rows = [...document.querySelectorAll('[role="button"]')].filter(
      (el) => el.innerText?.includes(n) && el.querySelector(MORE) && el.checkVisibility(),
    );
    rows.sort((x, y) => x.innerText.length - y.innerText.length)[0]?.querySelector(MORE)?.click();
  }, name);
  await wait(600);
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
// E2E_MIXED=1: 서버를 STREAM_MAX_SESSIONS=1 로 띄웠을 때 — 한 사람만 스트리밍, 다른 사람은 문장 단위(BUSY 폴백)인 통화.
//   문장 단위 쪽이 상대의 스트림 통역을 "들은 것"으로 치지 않고 기록 알림(message:new)으로 재생하는지 확인 (통화만 확인)
const MIXED = process.env.E2E_MIXED === "1";
const ONLY_CALL = process.env.E2E_ONLY_CALL === "1" || MIXED;
// E2E_REAL=1: 서버가 실제 OpenAI(ENGINE=openai)일 때 — 가짜 엔진 문구 대신 "양쪽이 번역 1턴씩 받았는지"로 확인하고 바로 끊는다 (비용 최소)
const REAL = process.env.E2E_REAL === "1";
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
  await manager.go("/site");
  await manager.check("관리자: 가입 요청 실시간 표시", "가입 요청 · 1", 10000);
  await manager.tap("승인");
  await manager.check("승인 후 멤버 목록에 구성원", MEMBER_NAME);
  await member.check("구성원: 승인 알림(실시간)", "Đã được duyệt vào", 10000);
  await wait(1500);
  await member.tap(SITE);
  await member.check("구성원: 현장 입장", "Nhóm công trường", 10000);

  if (!ONLY_CALL) {
  console.log("4) 1:1 대화: 구성원 텍스트 → 관리자에게 한국어 통역(가짜 엔진)");
  await member.go("/site");
  await openMenu(member, MANAGER_NAME); // C2: 누르면 연결되므로 ⋯ 메뉴로
  await member.tap("Nhắn riêng");
  await wait(1500);
  await member.type(-1, "Xin chào quản lý");
  await member.page.evaluate(() => [...document.querySelectorAll('[aria-label="send"]')].find((n) => n.checkVisibility())?.click());
  await member.check("구성원: 내 메시지 표시", "Xin chào quản lý");
  await manager.go("/site");
  await manager.tap(MEMBER_NAME); // 마지막 일치 = 아래 메시지 구역의 1:1 대화
  await manager.check("관리자: 한국어 통역문 수신", "[ko] Xin chào quản lý", 10000);
  await manager.shot("live-2-chat");
  }

  console.log(STREAMING ? "5) 1:1 연결 (C2, 스트리밍): 관리자가 누르면 받기 없이 연결 → 양쪽 실제 마이크로 말하는 동안 전송" : "5) 1:1 연결 (서버 스트리밍 꺼짐 → 문장 단위 방식으로 폴백)");
  await member.go("/site");
  await manager.go("/site");
  await manager.tap(MEMBER_NAME, { last: false }); // 멤버 줄 (아래 1:1 메시지 줄이 아니라)
  await manager.check("관리자: 누르면 바로 연결", `${MEMBER_NAME} 님과 연결 중`, 10000);
  await member.check("구성원: 받기 없이 연결 화면이 열림(실시간)", `Đang kết nối với ${MANAGER_NAME}`, 10000);
  let utteranceSide = null; // MIXED: 문장 단위로 통화하는 쪽
  if (MIXED) {
    // 연결 중에는 문장 단위 문구가 잠깐 보이므로, 스트리밍 문구가 나오는지 먼저 기다린다
    const modeOf = (u, streamLabel, utteranceLabel) =>
      u.page
        .waitForFunction((a) => document.body.innerText.includes(a), { timeout: 15000 }, streamLabel)
        .then(() => "stream", () => u.page.evaluate((b) => (document.body.innerText.includes(b) ? "utterance" : "none"), utteranceLabel));
    const [m, v] = await Promise.all([
      modeOf(manager, "실시간 통역 · 말하는 동안 전송", "문장 단위 통역"),
      modeOf(member, "Dịch trực tiếp · gửi trong khi nói", "Dịch theo từng câu"),
    ]);
    if ([m, v].sort().join() === "stream,utterance") { pass++; console.log(`  ✓ 한쪽만 스트리밍 (관리자 ${m}, 구성원 ${v})`); }
    else { fail++; console.log("  ✗ 한쪽만 스트리밍", { manager: m, member: v }); }
    utteranceSide = m === "utterance" ? manager : member;
  } else if (STREAMING) {
    await manager.check("관리자: 스트리밍 방식으로 연결", "실시간 통역 · 말하는 동안 전송", 15000);
    await member.check("구성원: 스트리밍 방식으로 연결", "Dịch trực tiếp · gửi trong khi nói", 15000);
  } else {
    await manager.check("관리자: 문장 단위 방식으로 폴백", "문장 단위 통역", 15000);
    await member.check("구성원: 문장 단위 방식으로 폴백", "Dịch theo từng câu", 15000);
  }
  await manager.check("관리자: 마이크 듣는 중", "듣고 있어요", 10000);
  if (REAL) {
    const gotTurn = async (u, name) => {
      const ok = await u.page.waitForFunction(() => window.__syncrewPlayback?.streamed.length > 0, { timeout: 40000 }).then(() => true, () => false);
      if (ok) { pass++; console.log(`  ✓ [${u.label}] ${name}`); } else { fail++; console.log(`  ✗ [${u.label}] ${name}`); }
    };
    await gotTurn(member, "구성원: 관리자 말의 실제 통역(스트림) 1턴 받음");
    await gotTurn(manager, "관리자: 구성원 말의 실제 통역(스트림) 1턴 받음");
    await wait(1500);
    for (const u of [member, manager]) console.log(`    [${u.label}] 자막:`, await u.page.evaluate(() => [...document.querySelectorAll("div")].filter((n) => n.children.length === 0 && n.checkVisibility()).map((n) => n.innerText.trim()).filter(Boolean).slice(0, 14).join(" | ")));
    await manager.shot("live-real-call-manager");
    await member.shot("live-real-call-member");
    await manager.tap("나가기"); // 비용을 줄이기 위해 바로 끊는다
  } else {
  await member.check("구성원: 관리자 말이 베트남어로 도착", "[vi] [음성 ko]", 30000);
  await manager.check("관리자: 구성원 말이 한국어로 도착", "[ko] [음성 vi]", 30000);
  }
  await wait(4000); // 기록 알림(message:new)까지 받을 시간
  if (MIXED) {
    // 문장 단위 쪽: 상대 스트림 턴을 받지 않고(조각 0·건너뜀 0), 상대 말의 기록 알림을 재생 대기열에 넣었는지
    const stats = await utteranceSide.page.evaluate(() => window.__syncrewPlayback);
    if (stats.streamChunks === 0 && stats.skipped.length === 0 && stats.enqueued.length > 0) { pass++; console.log(`  ✓ [${utteranceSide.label}] 문장 단위 쪽: 스트림 조각 0, 건너뜀 0, 기록 알림 재생 ${stats.enqueued.length}건`); }
    else { fail++; console.log(`  ✗ [${utteranceSide.label}] 문장 단위 쪽이 상대 말을 재생하지 못함`, stats); }
  } else if (!STREAMING) {
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
    if (!REAL) await member.check("구성원: 실시간 자막(원문)", "[음성 ko]");
  }
  await manager.shot("live-3-call-manager");
  await member.shot("live-3-call-member");
  if (!REAL && !MIXED) {
    // C1: 현장에 다른 사람이 없으면 음량 버튼 두 번(웹: 화살표 위)으로도 통화가 그대로 (안내만)
    // 헤드리스 Chrome 은 비밀번호 입력 뒤 실제 키 이벤트를 잃는다 → keydown 을 직접 보낸다
    const up = () => manager.page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })));
    await up();
    await wait(120);
    await up();
    await manager.check("관리자: 바꿀 사람 없음 안내", "통화할 수 있는 멤버가 없어요", 5000);
    await manager.check("관리자: 연결은 그대로", `${MEMBER_NAME} 님과 연결 중`);
  }
  if (!REAL) await manager.tap("나가기");
  await manager.check("관리자: 나가기 → 연결 안내", "사람을 누르면 바로 연결돼요", 10000);
  await member.check("구성원: 연결이 끝남", "Chạm vào một người để kết nối ngay", 10000);

  if (STREAMING && !ONLY_CALL) {
    console.log("5-1) 같은 언어 통화: OpenAI 없이 음성 그대로 전달 (관리자가 구성원의 현장 언어를 한국어로 바꿔서)");
    const setMemberLang = async (label) => {
      await manager.go("/site");
      await openMenu(manager, MEMBER_NAME);
      await manager.tap(`언어 변경 · ${label === "한국어" ? "Tiếng Việt" : "한국어"}`);
      await manager.tap(label);
      await wait(1000);
    };
    await setMemberLang("한국어");
    await member.go("/site"); // 페이지를 새로 열면 재생 기록(window.__syncrewPlayback)도 새로 시작한다
    const before = await member.page.evaluate(() => ({ ...window.__syncrewPlayback, streamed: [...window.__syncrewPlayback.streamed] }));
    await manager.go("/site");
    await manager.tap(MEMBER_NAME, { last: false }); // 멤버 줄 (아래 1:1 메시지 줄이 아니라)
    await member.check("구성원: 연결 화면", `Đang kết nối với ${MANAGER_NAME}`, 10000);
    await manager.check("관리자: 같은 언어 → 직접 전달 방식", "같은 언어 · 음성 그대로 전달", 15000);
    await member.check("구성원: 같은 언어 → 직접 전달 방식", "Cùng ngôn ngữ · truyền giọng nói trực tiếp", 15000);
    // (예전에는 메아리 차단 때문에 여기서 구성원 마이크를 껐다 — C2 는 마이크 끄기 버튼이 없다(10-27). 끄지 않아도 통과 확인)
    await wait(1500);
    // 관리자 마이크 음성(가짜 마이크)이 구성원에게 조각으로 도착하는지, 기록(번역 메시지)은 생기지 않는지
    const got = await member.page
      .waitForFunction((n) => window.__syncrewPlayback.streamChunks > n + 10, { timeout: 30000 }, before.streamChunks)
      .then(() => true, () => false);
    const after = await member.page.evaluate(() => window.__syncrewPlayback);
    if (got && after.streamed.length === before.streamed.length) {
      pass++;
      console.log(`  ✓ [구성원] 직접 전달: 음성 조각 ${after.streamChunks - before.streamChunks}개 받음, 기록 메시지 없음 (streamed 그대로)`);
    } else {
      fail++;
      console.log("  ✗ [구성원] 직접 전달", { got, before: before.streamChunks, after: after.streamChunks, streamedBefore: before.streamed.length, streamedAfter: after.streamed.length });
    }
    await manager.shot("live-3b-relay-manager");
    await member.shot("live-3b-relay-member");
    await manager.tap("나가기");
    await manager.check("관리자: 직접 전달 연결 끝", "사람을 누르면 바로 연결돼요", 10000);
    await member.check("구성원: 직접 전달 연결 끝", "Chạm vào một người để kết nối ngay", 10000);
    await setMemberLang("Tiếng Việt"); // 원래대로 (뒤 단계는 베트남어 통역을 확인한다)
  }

  if (!ONLY_CALL) {
  console.log("5-2) 현장 밖(현장 목록, 고른 현장 없음)에 있어도 연결되면 연결 화면이 열린다 (C1·C2, 2026-10-26)");
  await member.page.evaluate(() => localStorage.removeItem("syncrew.siteId"));
  await member.go("/sites");
  await member.check("구성원: 현장 목록(고른 현장 없음)", "Công trường của tôi", 10000);
  await manager.go("/site");
  await manager.tap(MEMBER_NAME, { last: false }); // 멤버 줄 (아래 1:1 메시지 줄이 아니라)
  await member.check("구성원: 현장 목록에서 연결 화면 열림", `Đang kết nối với ${MANAGER_NAME}`, 10000);
  // 받는 사람도 나갈 수 있다
  await member.tap("Thoát");
  await member.check("구성원: 나가기", "Chạm vào một người để kết nối ngay", 10000);
  await manager.check("관리자: 상대가 나가면 연결 끝", "사람을 누르면 바로 연결돼요", 10000);
  }

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
  // 작업조(B2): 실제 서버 API 로 저장 → 칩으로 다시 고르기
  await manager.tap("작업조로 저장");
  await manager.type(1, "E2E 작업조");
  await manager.tap("1명 저장");
  await manager.check("관리자: 작업조 저장(실제 서버)", "'E2E 작업조' 작업조를 저장했어요", 10000);
  await manager.check("관리자: 작업조 칩", "E2E 작업조 · 1", 10000);
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
  for (const server of webServers) server.close();
  process.exit(fail > 0 ? 1 : 0);
}
