import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { create } from "zustand";
import type { Lang } from "@shared/languages";
import { API_BASE_URL } from "@/config";
import { localeOf } from "@/lib/format";

export type PlayItem = {
  /** 메시지 id (재생 중 표시용) */
  id: string;
  text: string | null;
  lang: Lang;
  /** 서버가 만든 번역 음성(서버 기준 상대 경로의 서명 URL). 없으면 기기 음성 합성(TTS)으로 읽는다. */
  audioUrl: string | null;
  rate: number;
};

/** 지금 재생 중인 메시지 id (말풍선의 재생 표시용) */
export const usePlaybackStore = create<{ playingId: string | null }>(() => ({ playingId: null }));

const queue: PlayItem[] = [];
let player: AudioPlayer | null = null;
let audioModeReady = false;
/** 재생 끝 감시 타이머 (아래 watchEnd) */
let endWatch: ReturnType<typeof setInterval> | null = null;

function clearEndWatch() {
  if (endWatch) clearInterval(endWatch);
  endWatch = null;
}

/**
 * "재생 끝" 이벤트(didJustFinish)를 놓쳐도 재생 중 상태에 갇히지 않게 재생기 상태를 직접 확인한다.
 * 갇히면 통화의 마이크가 계속 멈춘다 ("통역 음성 재생 중 — 끝나면 말하세요").
 * 2026-10-14 iPhone 17 Pro 실기기: 음성 파일을 열지 못하면(당시 서버가 Range 요청 미지원) 끝 이벤트가 오지 않아 마이크가 멈춰 있었다.
 */
function watchEnd(target: AudioPlayer) {
  clearEndWatch();
  const startedAt = Date.now();
  let sawPlaying = false;
  endWatch = setInterval(() => {
    if (player !== target) return clearEndWatch();
    if (target.playing) sawPlaying = true;
    const elapsed = Date.now() - startedAt;
    const reachedEnd = target.isLoaded && target.duration > 0 && target.currentTime >= target.duration - 0.05;
    // 끝까지 갔거나, 재생하다 멈췄거나, 불러온 뒤 길이+2초가 지났거나, 20초 안에 불러오지도 못했으면 끝으로 본다
    const overdue = target.isLoaded ? elapsed > (target.duration + 2) * 1000 : elapsed > 20_000;
    if ((!target.playing && !target.isBuffering && (reachedEnd || sawPlaying)) || overdue) finish();
  }, 250);
}

function finish() {
  clearEndWatch();
  player?.remove();
  player = null;
  usePlaybackStore.setState({ playingId: null });
  const next = queue.shift();
  if (next) void start(next);
}

function speak(item: PlayItem) {
  if (!item.text) return finish();
  Speech.speak(item.text, {
    language: localeOf(item.lang),
    rate: item.rate,
    onDone: finish,
    onStopped: () => usePlaybackStore.setState({ playingId: null }),
    onError: finish,
  });
}

async function start(item: PlayItem) {
  usePlaybackStore.setState({ playingId: item.id });
  if (!audioModeReady) {
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
    audioModeReady = true;
  }
  if (!item.audioUrl) return speak(item);

  try {
    player = createAudioPlayer({ uri: resolveAudioUrl(item.audioUrl) });
    player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish) finish();
    });
    player.play();
    watchEnd(player);
  } catch {
    // 음성 파일 재생 실패 시 기기 TTS로 대체
    player?.remove();
    player = null;
    speak(item);
  }
}

/** 서버는 "/api/v1/messages/…/audio?…" 형태로 주므로 서버 주소를 붙인다. */
export function resolveAudioUrl(url: string): string {
  return url.startsWith("/") ? `${API_BASE_URL}${url}` : url;
}

/** 지금 바로 재생 (다시 듣기). 재생 중인 것은 멈춘다. */
export function playNow(item: PlayItem) {
  stopPlayback();
  void start(item);
}

/** 순서대로 재생 (받은 통역 자동 재생) */
export function enqueue(item: PlayItem) {
  if (usePlaybackStore.getState().playingId) queue.push(item);
  else void start(item);
}

/** 녹음을 시작하기 전 등에 모든 재생을 멈춘다. */
export function stopPlayback() {
  clearEndWatch();
  queue.length = 0;
  player?.remove();
  player = null;
  void Speech.stop();
  usePlaybackStore.setState({ playingId: null });
}
