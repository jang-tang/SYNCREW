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

function finish() {
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
  queue.length = 0;
  player?.remove();
  player = null;
  void Speech.stop();
  usePlaybackStore.setState({ playingId: null });
}
