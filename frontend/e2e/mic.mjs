// 실제 말소리로 핸즈프리 자동 전송 확인 (웹 빌드, 데모 모드, 헤드리스 Chrome 가짜 마이크).
// Chrome 가짜 마이크에 macOS say 로 만든 한국어 음성(말 약 3초 + 무음 4초 반복)을 넣고,
// 통화 화면에서 버튼을 누르지 않아도 말소리 감지 → 녹음 구간 전송 → 상대 응답이 오는지 본다.
// 대조군: 무음만 넣은 경우에는 전송되지 않아야 한다.
// 오디오 서비스 샌드박스를 꺼야 Chrome 이 음성 파일을 읽는다 (켜 두면 무음이 들어옴).
// 실행: npm run bundle:web && npm run e2e:mic
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import puppeteer from "puppeteer-core";

const distDir = path.resolve(process.argv[2] ?? "dist-check");
const outDir = path.resolve(process.argv[3] ?? "e2e/output/mic");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(outDir, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".ttf": "font/ttf" };
const onRequest = (req, res) => {
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
// 이 PC 안(루프백)에서만 연다. Chrome 은 localhost 를 ::1·127.0.0.1 어느 쪽으로도 접속하므로 두 주소 모두 이 스크립트가 연다
// (한쪽만 열면 다른 사용자가 나머지 주소의 8768 을 먼저 열어 브라우저 요청을 가로챌 수 있다).
// IPv6 루프백이 없는 PC 에서는 아무도 ::1 을 열 수 없으므로 건너뛴다. 그 밖의 실패(이미 사용 중 등)는 그대로 중단한다.
const servers = [];
for (const host of ["127.0.0.1", "::1"]) {
  const server = http.createServer(onRequest);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(8768, host, () => { server.off("error", reject); resolve(); });
    });
  } catch (error) {
    if (host === "::1" && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) continue;
    throw error;
  }
  servers.push(server);
}
const base = "http://localhost:8768";

const ffmpeg = createRequire(path.resolve("../server/package.json"))("ffmpeg-static");
const speechWav = path.join(outDir, "speech-ko.wav");
const silenceWav = path.join(outDir, "silence.wav");
execFileSync("say", ["-v", "Yuna", "-o", path.join(outDir, "speech-ko.aiff"), "안전모를 착용하고 작업을 시작하세요."]);
execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", path.join(outDir, "speech-ko.aiff"), "-af", "apad=pad_dur=4", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", speechWav]);
execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "8", "-c:a", "pcm_s16le", silenceWav]);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const REPLY = "알겠습니다. 바로 시작하겠습니다.";

async function run(label, wav, expectSend) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: fs.mkdtempSync(path.join(outDir, "chrome-")),
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--disable-features=AudioServiceSandbox", `--use-file-for-fake-audio-capture=${wav}`],
  });
  await browser.defaultBrowserContext().overridePermissions(base, ["microphone"]);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  await page.goto(base + "/welcome", { waitUntil: "networkidle0" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("syncrew.mockSession", "m@syncrew.app");
    localStorage.setItem("syncrew.mockProfile", JSON.stringify({ id: "me", email: "m@syncrew.app", displayName: "장태웅", preferredLang: "ko", autoPlay: false, speechRate: 1 }));
    localStorage.setItem("syncrew.siteId", "s_a");
    localStorage.setItem("syncrew.uiLang", "ko");
  });
  await page.goto(base + "/site/members", { waitUntil: "networkidle0" });
  const tap = async (t) => {
    await page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: 6000 }, t).catch(() => {});
    await page.evaluate((x) => {
      const el = [...document.querySelectorAll("div,span")].filter((n) => n.innerText?.trim() === x && n.checkVisibility()).at(-1);
      (el?.closest('[role="button"]') ?? el)?.click();
    }, t);
    await wait(500);
  };
  await tap("Nguyễn Văn An");
  await tap("통역 통화");
  await page.waitForFunction(() => document.body.innerText.includes("통화 중"), { timeout: 10000 }).catch(async () => {
    await page.screenshot({ path: path.join(outDir, `${label}-no-call.png`) });
    console.log("    통화 연결 안 됨. 화면:", (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 400));
  });

  // 상태 문구 변화를 기록한다 (듣는 중 → 말하는 중 → …)
  const states = new Set();
  const started = Date.now();
  let sent = false;
  while (Date.now() - started < 25000) {
    const text = await page.evaluate(() => document.body.innerText);
    for (const s of ["듣고 있어요", "말하는 중…", "마이크 권한이 필요해요", "마이크를 사용할 수 없어요"]) if (text.includes(s)) states.add(s);
    if (text.includes(REPLY)) { sent = true; break; }
    await wait(250);
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  await page.screenshot({ path: path.join(outDir, `${label}.png`) });
  await browser.close();
  const ok = sent === expectSend;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: 자동 전송 ${sent ? `됨 (${elapsed}초)` : "안 됨"} · 상태 ${[...states].join(" → ") || "(없음)"}`);
  if (errors.length) console.log("    콘솔 오류:", [...new Set(errors)].join(" | "));
  return ok;
}

const results = [
  await run("말소리 → 자동 전송", speechWav, true),
  await run("대조군: 무음 → 전송 없음", silenceWav, false),
];
for (const server of servers) server.close();
console.log(`\n결과: 통과 ${results.filter(Boolean).length} / 실패 ${results.filter((r) => !r).length}`);
process.exit(results.every(Boolean) ? 0 : 1);
