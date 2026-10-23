// 스트리밍 통화 중 expo-audio 가 iOS 오디오 세션을 덮어쓰지 않게 하는 표시(sessionOwner) 단위 테스트. 실행: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { audioModeAction, holdSession, isSessionHeld, releaseSession, waitForRelease } from "../src/audio/sessionOwner.ts";

test("iOS 에서 세션을 쥐고 있으면: 녹음 켜기는 기다리고, 녹음 끄기·재생용은 건너뛴다", () => {
  assert.equal(audioModeAction("ios", true, true), "wait");
  assert.equal(audioModeAction("ios", false, true), "skip");
  assert.equal(audioModeAction("ios", undefined, true), "skip"); // { playsInSilentMode: true } (playback.ts)
});

test("대조군: 세션을 안 쥐었거나 Android·웹이면 그대로 적용", () => {
  assert.equal(audioModeAction("ios", false, false), "apply");
  assert.equal(audioModeAction("ios", true, false), "apply");
  assert.equal(audioModeAction("android", false, true), "apply");
  assert.equal(audioModeAction("android", true, true), "apply");
  assert.equal(audioModeAction("web", false, true), "apply");
});

test("hold → release 상태", () => {
  releaseSession();
  assert.equal(isSessionHeld(), false);
  holdSession();
  assert.equal(isSessionHeld(), true);
  releaseSession();
  assert.equal(isSessionHeld(), false);
});

test("waitForRelease: 안 쥐었으면 바로 true", async () => {
  releaseSession();
  assert.equal(await waitForRelease(1_000), true);
});

test("waitForRelease: 놓으면 기다리던 쪽이 true 로 깬다", async () => {
  holdSession();
  const started = Date.now();
  const waiting = waitForRelease(5_000);
  setTimeout(releaseSession, 30);
  assert.equal(await waiting, true);
  assert.ok(Date.now() - started < 1_000);
});

test("waitForRelease: 시간이 지나도 쥐고 있으면 false, 그 뒤 release 가 와도 문제없다", async () => {
  holdSession();
  assert.equal(await waitForRelease(30), false);
  assert.equal(isSessionHeld(), true);
  releaseSession();
  assert.equal(isSessionHeld(), false);
});
