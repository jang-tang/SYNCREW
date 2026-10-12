import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
