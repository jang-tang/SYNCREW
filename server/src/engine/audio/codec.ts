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
 * 열 수 있는 입력 형식 (ffmpeg demuxer 이름). 업로드 허용 형식(http/upload.ts AUDIO_EXTENSIONS)에 맞춘다:
 * mov = mp4·m4a·3gp, matroska = webm, aac(ADTS), ogg, wav, mp3. aiff 는 확인 스크립트(macOS say 출력)용.
 * ffmpeg 는 확장자가 아니라 내용으로 형식을 고르므로, 목록이 없으면 concat·hls 같은 재생 목록 형식이
 * 저장 폴더의 다른 파일을 열거나 같은 파일을 반복해 올린 크기보다 훨씬 긴 음성을 만들 수 있다.
 */
const INPUT_FORMATS = "mov,aac,matroska,ogg,wav,mp3,aiff";
/** 디코딩 길이 기본 상한 (초). 넘는 부분은 버린다 */
export const DEFAULT_DECODE_MAX_SECONDS = 60;
/** 디코딩 전체 시간 제한 */
export const DECODE_TIMEOUT_MS = 15_000;
/** 오류 메시지용으로 남기는 ffmpeg stderr 끝부분 길이 */
const MAX_STDERR_CHARS = 4096;

export type DecodeOptions = {
  /** 이 길이(초)까지만 디코딩한다. 길이 초과 판단은 부르는 쪽에서 (상한보다 조금 길게 주면 초과를 알 수 있다) */
  maxSeconds?: number;
  timeoutMs?: number;
};

/**
 * 앱이 올린 음성 파일(m4a/aac/webm 등)을 PCM16 mono 로 변환한다.
 * 파일 경로로 받는다: 휴대폰 녹음 m4a 는 moov(색인)가 파일 끝에 있어 stdin 파이프로는 읽을 수 없다.
 * 로컬 파일·허용한 형식만 열고, 출력 길이·메모리·시간에 상한을 둔다 (올린 파일이 서버 메모리를 다 쓰지 못하게).
 */
export function decodeToPcm(filePath: string, sampleRate = PIPELINE_SAMPLE_RATE, options: DecodeOptions = {}): Promise<PcmAudio> {
  if (!ffmpegPath) return Promise.reject(new AudioDecodeError("ffmpeg 실행 파일을 찾을 수 없습니다."));
  const maxSeconds = options.maxSeconds ?? DEFAULT_DECODE_MAX_SECONDS;
  const timeoutMs = options.timeoutMs ?? DECODE_TIMEOUT_MS;
  // -t 로 잘리므로 이보다 많이 나올 일은 없다. 리샘플링 오차 여유 1초를 두고, 넘으면 ffmpeg 를 멈춘다.
  const maxBytes = Math.ceil((maxSeconds + 1) * sampleRate) * 2;
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegPath as unknown as string,
      [
        "-hide_banner", "-loglevel", "error",
        "-protocol_whitelist", "file", "-format_whitelist", INPUT_FORMATS,
        "-i", filePath,
        "-t", String(maxSeconds),
        "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(sampleRate), "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let settled = false;
    const fail = (error: AudioDecodeError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ffmpeg.kill("SIGKILL");
      reject(error);
    };
    const timer = setTimeout(() => fail(new AudioDecodeError(`디코딩 시간 초과 (${timeoutMs}ms)`)), timeoutMs);
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) return fail(new AudioDecodeError("디코딩한 음성이 너무 깁니다."));
      chunks.push(chunk);
    });
    ffmpeg.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-MAX_STDERR_CHARS)));
    ffmpeg.on("error", (error) => fail(new AudioDecodeError(error.message)));
    ffmpeg.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
