// ArrayBuffer ↔ base64 (네이티브 이중 오디오 모듈과 PCM 조각을 주고받는 형식).
// Hermes 의 atob/btoa 지원 여부에 기대지 않도록 직접 구현한다. 외부 의존성 없음 (단위 테스트: e2e/duplex.test.mjs).
// 통화 중 초당 10번(녹음 조각 3,200B 디코드) + 재생 조각마다(4,800B 인코드) 도는 경로라 글자 단위 문자열 이어 붙이기를 피한다
// (2026-10-20 Node/V8 측정: 디코드 28.7→10.1µs, 인코드 22.9→15.9µs. Hermes 는 미측정 — docs/perf-network-2026-10-20.md).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Uint8Array(256).fill(255);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;
/** 6비트 값 → 글자 코드 */
const CODES = new Uint8Array(64);
for (let i = 0; i < ALPHABET.length; i++) CODES[i] = ALPHABET.charCodeAt(i);
/** String.fromCharCode.apply 에 한 번에 넘기는 글자 수 (인수 개수 제한 안전 범위, 4의 배수) */
const CHUNK = 3072;
const PAD = 61; // "="

export function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const codes: number[] = [];
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    codes.push(CODES[(n >> 18) & 63]!, CODES[(n >> 12) & 63]!, CODES[(n >> 6) & 63]!, CODES[n & 63]!);
    if (codes.length === CHUNK) {
      out += String.fromCharCode.apply(null, codes);
      codes.length = 0;
    }
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    codes.push(CODES[(n >> 18) & 63]!, CODES[(n >> 12) & 63]!, PAD, PAD);
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    codes.push(CODES[(n >> 18) & 63]!, CODES[(n >> 12) & 63]!, CODES[(n >> 6) & 63]!, PAD);
  }
  if (codes.length > 0) out += String.fromCharCode.apply(null, codes);
  return out;
}

/** 공백·줄바꿈은 건너뛴다. base64 가 아닌 글자가 있으면 Error */
export function arrayBufferFromBase64(text: string): ArrayBuffer {
  // 끝의 '=' 를 뺀 길이로 출력 크기 상한을 잡는다 (공백이 없으면 정확히 맞아 복사가 없다)
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === PAD) end--;
  const bytes = new Uint8Array(Math.floor((end * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === PAD || c === 32 || c === 10 || c === 13 || c === 9) continue; // = 공백 \n \r \t
    const v = c < 256 ? LOOKUP[c]! : 255;
    if (v === 255) throw new Error("base64 가 아닙니다");
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (o < bytes.length) bytes[o++] = (acc >> bits) & 255;
      acc &= (1 << bits) - 1;
    }
  }
  return o === bytes.length ? bytes.buffer : bytes.buffer.slice(0, o);
}
