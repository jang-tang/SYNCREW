import type { NativeRouteEvent, SyncrewDuplexNative } from "../../../modules/syncrew-duplex";
import { arrayBufferFromBase64, base64FromArrayBuffer } from "./base64";
import { levelDbOf, type AudioFrame, type AudioRoute, type DuplexAudio } from "./types";

// iOS·Android 이중 오디오: 네이티브 모듈(modules/syncrew-duplex)을 DuplexAudio 인터페이스로 감싼다 (docs/streaming-plan.md S3).
// 네이티브 이벤트 구독은 앱 전체에서 한 번만 한다 (duplex/index.ts 가 이 어댑터를 하나만 만든다).


export function createNativeDuplex(native: SyncrewDuplexNative, requestPermission: () => Promise<boolean>): DuplexAudio {
  const frameListeners = new Set<(frame: AudioFrame) => void>();
  const routeListeners = new Set<(route: AudioRoute, deviceName?: string) => void>();
  const playbackListeners = new Set<(state: { streamId: string | null; playing: boolean }) => void>();
  let lastRoute: { route: AudioRoute; name?: string } = { route: "unknown" };

  native.addListener("onFrame", (event) => {
    if (frameListeners.size === 0) return;
    let pcm: ArrayBuffer;
    try {
      pcm = arrayBufferFromBase64(event.pcm);
    } catch {
      return;
    }
    const frame = { pcm, levelDb: levelDbOf(new Int16Array(pcm, 0, pcm.byteLength >> 1)), timestamp: event.timestamp };
    frameListeners.forEach((listener) => listener(frame));
  });
  native.addListener("onRoute", (event: NativeRouteEvent) => {
    lastRoute = { route: event.route, name: event.name ?? undefined };
    routeListeners.forEach((listener) => listener(lastRoute.route, lastRoute.name));
  });
  native.addListener("onPlayback", (event) => {
    playbackListeners.forEach((listener) => listener({ streamId: event.streamId, playing: event.playing }));
  });
  native.addListener("onError", (event) => {
    console.warn(`[duplex] ${event.code}: ${event.message}`);
  });

  return {
    async start(options) {
      if (!(await requestPermission().catch(() => false))) throw new Error("permission");
      try {
        await native.start(options.sampleRate, options.frameMs, options.echoCancellation);
      } catch (error) {
        if ((error as { code?: string } | null)?.code === "permission") throw new Error("permission");
        throw error;
      }
    },

    async stop() {
      await native.stop();
    },

    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },

    enqueue(streamId, pcm, sampleRate) {
      if (pcm.byteLength < 2) return;
      native.enqueue(streamId, base64FromArrayBuffer(pcm), sampleRate);
    },

    endStream(streamId) {
      native.endStream(streamId);
    },

    stopPlayback() {
      native.stopPlayback();
    },

    onRoute(listener) {
      routeListeners.add(listener);
      listener(lastRoute.route, lastRoute.name);
      return () => routeListeners.delete(listener);
    },

    onPlayback(listener) {
      playbackListeners.add(listener);
      return () => playbackListeners.delete(listener);
    },
  };
}
