// 릴리스 빌드 서버 주소 검사 단위 테스트 (토큰·음성 평문 전송 방지). 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedReleaseApiUrl } from "../src/releaseApiUrl.ts";

test("https 주소는 허용 (운영 서버)", () => {
  assert.equal(isAllowedReleaseApiUrl("https://syncrew.hyunshu.com"), true);
  assert.equal(isAllowedReleaseApiUrl("https://192.168.0.10:4443"), true);
});

test("http 는 기기 밖으로 나가지 않는 루프백만 허용 (웹 e2e·adb reverse)", () => {
  assert.equal(isAllowedReleaseApiUrl("http://localhost:8767"), true);
  assert.equal(isAllowedReleaseApiUrl("http://localhost:4000"), true);
  assert.equal(isAllowedReleaseApiUrl("http://127.0.0.1:4000"), true);
  assert.equal(isAllowedReleaseApiUrl("http://[::1]:4000"), true);
});

test("네트워크를 지나는 http 주소는 거부 (같은 Wi-Fi 의 PC, 에뮬레이터 주소 10.0.2.2 포함)", () => {
  assert.equal(isAllowedReleaseApiUrl("http://192.168.0.10:4000"), false);
  assert.equal(isAllowedReleaseApiUrl("http://10.0.2.2:4000"), false);
  assert.equal(isAllowedReleaseApiUrl("http://syncrew.hyunshu.com"), false);
  assert.equal(isAllowedReleaseApiUrl("ws://localhost:4000"), false);
  assert.equal(isAllowedReleaseApiUrl(""), false);
});

test("루프백처럼 보이지만 다른 호스트로 가는 주소는 거부", () => {
  assert.equal(isAllowedReleaseApiUrl("http://localhost.example.com:4000"), false);
  assert.equal(isAllowedReleaseApiUrl("http://127.0.0.1.example.com"), false);
  assert.equal(isAllowedReleaseApiUrl("http://localhost@example.com"), false);
  assert.equal(isAllowedReleaseApiUrl("http://localhost:4000@example.com"), false);
  assert.equal(isAllowedReleaseApiUrl("http://example.com\\@localhost"), false);
  assert.equal(isAllowedReleaseApiUrl("http://localhost\\@example.com"), false);
  // 대문자 스킴은 socket.io-client 가 다른 주소로 해석하므로 거부 (소문자로 쓸 것)
  assert.equal(isAllowedReleaseApiUrl("HTTP://localhost:4000"), false);
  assert.equal(isAllowedReleaseApiUrl("HTTPS://syncrew.hyunshu.com"), false);
});
