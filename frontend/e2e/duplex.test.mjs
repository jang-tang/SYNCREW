// 네이티브 이중 오디오와 PCM 조각을 주고받는 base64 변환 단위 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrayBufferFromBase64, base64FromArrayBuffer } from "../src/audio/duplex/base64.ts";

const bytesOf = (buffer) => Buffer.from(new Uint8Array(buffer));

test("Node Buffer 의 base64 와 같은 결과 (길이 0~7, 나머지 0·1·2)", () => {
  for (let n = 0; n < 8; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
    const encoded = base64FromArrayBuffer(bytes.buffer);
    assert.equal(encoded, Buffer.from(bytes).toString("base64"));
    assert.deepEqual(bytesOf(arrayBufferFromBase64(encoded)), Buffer.from(bytes));
  }
});

test("100ms PCM16 조각(3,200바이트) 왕복 — 모든 표본값 보존", () => {
  const samples = new Int16Array(1600);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(i / 7) * 32767) - (i % 2);
  samples[0] = -32768;
  samples[1] = 32767;
  const back = new Int16Array(arrayBufferFromBase64(base64FromArrayBuffer(samples.buffer)));
  assert.deepEqual(Array.from(back), Array.from(samples));
});

test("네이티브가 줄바꿈을 넣은 base64 도 읽는다", () => {
  const bytes = Uint8Array.from({ length: 120 }, (_, i) => i);
  const wrapped = Buffer.from(bytes).toString("base64").replace(/(.{76})/g, "$1\n");
  assert.deepEqual(bytesOf(arrayBufferFromBase64(wrapped)), Buffer.from(bytes));
});

test("base64 가 아닌 글자는 오류", () => {
  assert.throws(() => arrayBufferFromBase64("ab$d"));
});
