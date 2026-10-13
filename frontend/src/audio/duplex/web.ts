import { levelDbOf, type AudioFrame, type AudioRoute, type DuplexAudio, type DuplexStartOptions } from "./types";

// 웹 이중 오디오 (헤드리스 Chrome 자동 검증용, 제품 대상은 네이티브 — docs/streaming-plan.md 5절).
//   녹음: getUserMedia(에코 제거·잡음 억제) → 16kHz AudioContext → AudioWorklet 이 100ms(1600표본) 조각으로 모아 보낸다
//   재생: 별도 AudioContext 에 턴별로 이어 붙여 예약 재생. 첫 조각 앞에 지터 버퍼 120ms, 늦게 온 조각은 버퍼를 다시 잡는다

const JITTER_S = 0.12;

/** 16kHz 컨텍스트 안에서 1600표본씩 모아 PCM16 으로 보내는 워크렛 */
const WORKLET = `
class SyncrewCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.frameSamples;
    this.buffer = new Int16Array(this.size);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const v = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled++] = v < 0 ? v * 32768 : v * 32767;
      if (this.filled === this.size) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("syncrew-capture", SyncrewCapture);
`;

type PlayStream = { nextTime: number; sources: Set<AudioBufferSourceNode>; ended: boolean };

export function createWebDuplex(): DuplexAudio {
  const frameListeners = new Set<(frame: AudioFrame) => void>();
  const playbackListeners = new Set<(state: { streamId: string | null; playing: boolean }) => void>();
  let capture: { ctx: AudioContext; stream: MediaStream; node: AudioWorkletNode } | null = null;
  let playCtx: AudioContext | null = null;
  const streams = new Map<string, PlayStream>();
  let current: string | null = null;

  const notify = (streamId: string | null, playing: boolean) => playbackListeners.forEach((l) => l({ streamId, playing }));

  /** 재생 중인 소리가 하나도 없으면 멈춤 알림, 끝난 턴은 정리 */
  const settle = () => {
    for (const [id, s] of streams) if (s.ended && s.sources.size === 0) streams.delete(id);
    const playing = [...streams.values()].some((s) => s.sources.size > 0);
    if (!playing && current !== null) {
      const id = current;
      current = null;
      notify(id, false);
    }
  };

  const player = () => {
    playCtx ??= new AudioContext();
    if (playCtx.state === "suspended") void playCtx.resume();
    return playCtx;
  };

  return {
    async start(options: DuplexStartOptions) {
      if (capture) return;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: options.echoCancellation,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        throw new Error("permission");
      }
      const ctx = new AudioContext({ sampleRate: options.sampleRate });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, "syncrew-capture", {
        processorOptions: { frameSamples: (options.sampleRate * options.frameMs) / 1000 },
      });
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const pcm = event.data;
        const frame = { pcm, levelDb: levelDbOf(new Int16Array(pcm)), timestamp: Date.now() };
        frameListeners.forEach((l) => l(frame));
      };
      ctx.createMediaStreamSource(stream).connect(node);
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      capture = { ctx, stream, node };
      player(); // 재생 컨텍스트도 미리 깨워 둔다 (첫 통역 소리 지연 방지)
    },

    async stop() {
      const c = capture;
      capture = null;
      if (c) {
        c.node.port.onmessage = null;
        c.node.disconnect();
        c.stream.getTracks().forEach((track) => track.stop());
        await c.ctx.close().catch(() => undefined);
      }
      this.stopPlayback();
    },

    onFrame(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },

    enqueue(streamId, pcm, sampleRate) {
      const ctx = player();
      const samples = new Int16Array(pcm.byteLength % 2 === 0 ? pcm : pcm.slice(0, pcm.byteLength - 1));
      if (samples.length === 0) return;
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) data[i] = samples[i]! / 32768;

      let s = streams.get(streamId);
      if (!s) {
        s = { nextTime: 0, sources: new Set(), ended: false };
        streams.set(streamId, s);
      }
      // 첫 조각이거나 조각이 늦게 와서 이미 지나간 시각이면 지터 버퍼만큼 뒤에 이어 붙인다
      const at = Math.max(s.nextTime, ctx.currentTime + (s.nextTime === 0 || s.nextTime < ctx.currentTime ? JITTER_S : 0));
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(at);
      s.nextTime = at + buffer.duration;
      s.sources.add(source);
      const owner = s;
      source.onended = () => {
        owner.sources.delete(source);
        settle();
      };
      if (current !== streamId) {
        current = streamId;
        notify(streamId, true);
      }
    },

    endStream(streamId) {
      const s = streams.get(streamId);
      if (!s) return;
      s.ended = true;
      settle();
    },

    stopPlayback() {
      for (const s of streams.values()) for (const source of s.sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // 이미 끝남
        }
      }
      streams.clear();
      settle();
      if (current !== null) {
        const id = current;
        current = null;
        notify(id, false);
      }
    },

    onRoute(listener) {
      // 웹은 오디오 경로를 알 수 없다
      listener("unknown" as AudioRoute);
      return () => undefined;
    },

    onPlayback(listener) {
      playbackListeners.add(listener);
      return () => playbackListeners.delete(listener);
    },
  };
}
