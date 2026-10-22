import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { AudioDecodeError, decodeToPcm, encodeWav } from "../src/engine/audio/codec";
import { AudioUrlSigner } from "../src/messaging/audioUrls";

describe("오디오 변환", () => {
  it("WAV 로 감싼 PCM 을 다시 디코딩하면 같은 샘플이 나온다 (16kHz mono)", async () => {
    const samples = Int16Array.from({ length: 1600 }, (_, i) => Math.round(Math.sin(i / 10) * 10000));
    const file = path.join(mkdtempSync(path.join(tmpdir(), "syncrew-wav-")), "a.wav");
    writeFileSync(file, encodeWav(samples, 16_000));
    const decoded = await decodeToPcm(file);
    expect(decoded.sampleRate).toBe(16_000);
    expect(Array.from(decoded.data)).toEqual(Array.from(samples));
  });

  it("24kHz 번역 음성도 16kHz 로 변환한다 (길이 보존)", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "syncrew-wav-")), "b.wav");
    writeFileSync(file, encodeWav(new Int16Array(24_000), 24_000));
    const decoded = await decodeToPcm(file);
    expect(decoded.data.length).toBeGreaterThan(15_900);
    expect(decoded.data.length).toBeLessThan(16_100);
  });

  it("음성이 아닌 파일은 AudioDecodeError", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "syncrew-wav-")), "c.m4a");
    writeFileSync(file, "not audio");
    await expect(decodeToPcm(file)).rejects.toBeInstanceOf(AudioDecodeError);
  });

  it("업로드 허용 형식(m4a·3gp·aac·webm·ogg·mp3·wav)과 확인 스크립트의 aiff 는 모두 디코딩한다", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "syncrew-fmt-"));
    const cases: [string, string[]][] = [
      ["a.m4a", ["-c:a", "aac"]],
      ["a.3gp", ["-c:a", "aac"]],
      ["a.aac", ["-c:a", "aac", "-f", "adts"]],
      ["a.webm", ["-ar", "48000", "-c:a", "opus", "-strict", "-2"]],
      ["a.ogg", ["-ar", "48000", "-c:a", "opus", "-strict", "-2"]],
      ["a.mp3", ["-c:a", "mp2", "-f", "mp2"]],
      ["a.wav", []],
      ["a.aiff", []],
    ];
    for (const [name, codec] of cases) {
      const file = path.join(dir, name);
      execFileSync(ffmpegPath as unknown as string, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", ...codec, file]);
      const decoded = await decodeToPcm(file);
      expect(decoded.data.length, name).toBeGreaterThan(15_000);
    }
  });

  it("내용으로 감지되는 재생 목록 형식(concat)은 열지 않는다 (대조군: 목록이 가리키는 파일은 디코딩된다)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "syncrew-wav-"));
    const other = path.join(dir, "other.wav");
    writeFileSync(other, encodeWav(new Int16Array(16_000), 16_000));
    const playlist = path.join(dir, "d.m4a");
    writeFileSync(playlist, `ffconcat version 1.0\n${"file other.wav\n".repeat(20)}`);
    await expect(decodeToPcm(playlist)).rejects.toBeInstanceOf(AudioDecodeError);
    expect((await decodeToPcm(other)).data.length).toBe(16_000);
  });

  it("maxSeconds 까지만 디코딩하고, 시간 제한을 넘으면 AudioDecodeError", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "syncrew-wav-")), "e.wav");
    writeFileSync(file, encodeWav(new Int16Array(16_000 * 5), 16_000));
    expect((await decodeToPcm(file, 16_000, { maxSeconds: 2 })).data.length).toBe(32_000);
    expect((await decodeToPcm(file)).data.length).toBe(80_000); // 대조군: 기본 상한 안이면 전체
    await expect(decodeToPcm(file, 16_000, { timeoutMs: 1 })).rejects.toThrow("시간 초과");
  });
});

describe("음성 URL 서명", () => {
  const signer = new AudioUrlSigner("secret", 60);
  const parse = (url: string) => Object.fromEntries(new URL(url, "http://x").searchParams) as { lang: string; u: string; exp: string; sig: string };

  it("서명한 메시지·언어·사용자에만 유효하고, 만료되면 무효", () => {
    const now = Date.now();
    const query = parse(signer.url("m1", "vi", "u1", now));
    expect(signer.verify("m1", query, now)).toBe(true);
    expect(signer.verify("m2", query, now)).toBe(false);
    expect(signer.verify("m1", { ...query, lang: "zh" }, now)).toBe(false);
    expect(signer.verify("m1", { ...query, u: "u2" }, now)).toBe(false);
    expect(signer.verify("m1", query, now + 61_000)).toBe(false);
    // 다른 키(서버 재시작 후 새 키)로 만든 서명은 무효
    expect(new AudioUrlSigner("other").verify("m1", query, now)).toBe(false);
  });
});
