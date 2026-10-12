import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

/** ffmpeg 로 만든 실제 m4a(AAC) 파일. 휴대폰 녹음처럼 moov 가 파일 끝에 있다. */
export function makeM4a(seconds = 1): Buffer {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "syncrew-m4a-")), "speech.m4a");
  execFileSync(ffmpegPath as unknown as string, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:a", "aac", file,
  ]);
  return readFileSync(file);
}
