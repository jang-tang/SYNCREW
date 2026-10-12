import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import type { PcmAudio } from "./audioPreprocessor";

/** 파이프라인 표준 입력 형식: PCM16 mono 16kHz (노이즈 필터·STT 공통) */
export const PIPELINE_SAMPLE_RATE = 16_000;

export class AudioDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioDecodeError";
  }
}

/**
 * 앱이 올린 음성 파일(m4a/aac/webm 등)을 PCM16 mono 로 변환한다.
 * 파일 경로로 받는다: 휴대폰 녹음 m4a 는 moov(색인)가 파일 끝에 있어 stdin 파이프로는 읽을 수 없다.
 */
export function decodeToPcm(filePath: string, sampleRate = PIPELINE_SAMPLE_RATE): Promise<PcmAudio> {
  if (!ffmpegPath) return Promise.reject(new AudioDecodeError("ffmpeg 실행 파일을 찾을 수 없습니다."));
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegPath as unknown as string,
      ["-hide_banner", "-loglevel", "error", "-i", filePath, "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(sampleRate), "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    ffmpeg.on("error", (error) => reject(new AudioDecodeError(error.message)));
    ffmpeg.on("close", (code) => {
      if (code !== 0) return reject(new AudioDecodeError(stderr.trim().split("\n").at(-1) || `ffmpeg 종료 코드 ${code}`));
      const pcm = Buffer.concat(chunks);
      // Buffer 의 내부 메모리 정렬과 무관하게 복사해서 Int16Array 를 만든다.
      const data = new Int16Array(pcm.length >> 1);
      for (let i = 0; i < data.length; i++) data[i] = pcm.readInt16LE(i * 2);
      resolve({ data, sampleRate });
    });
  });
}

export const durationSeconds = (audio: PcmAudio) => audio.data.length / audio.sampleRate;

/** PCM16 mono 를 WAV 파일 바이트로 감싼다. */
export function encodeWav(pcm: Int16Array | Buffer, sampleRate: number): Buffer {
  const body = Buffer.isBuffer(pcm) ? pcm : pcmToBuffer(pcm as Int16Array);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + body.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt 청크 크기
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

function pcmToBuffer(pcm: Int16Array): Buffer {
  const buffer = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) buffer.writeInt16LE(pcm[i]!, i * 2);
  return buffer;
}
