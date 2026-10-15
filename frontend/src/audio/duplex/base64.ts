// ArrayBuffer ↔ base64 (네이티브 이중 오디오 모듈과 PCM 조각을 주고받는 형식).
// Hermes 의 atob/btoa 지원 여부에 기대지 않도록 직접 구현한다. 외부 의존성 없음 (단위 테스트: e2e/duplex.test.mjs).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + "==";
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + "=";
  }
  return out;
}

/** 공백·줄바꿈은 건너뛴다. base64 가 아닌 글자가 있으면 Error */
export function arrayBufferFromBase64(text: string): ArrayBuffer {
  let clean = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "=" || c === " " || c === "\n" || c === "\r" || c === "\t") continue;
    if (LOOKUP[text.charCodeAt(i)] === 255) throw new Error("base64 가 아닙니다");
    clean += c;
  }
  const length = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)]!;
    const b = LOOKUP[clean.charCodeAt(i + 1)] ?? 0;
    const c = i + 2 < clean.length ? LOOKUP[clean.charCodeAt(i + 2)]! : 0;
    const d = i + 3 < clean.length ? LOOKUP[clean.charCodeAt(i + 3)]! : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < length) bytes[o++] = (n >> 16) & 255;
    if (o < length) bytes[o++] = (n >> 8) & 255;
    if (o < length) bytes[o++] = n & 255;
  }
  return bytes.buffer;
}
