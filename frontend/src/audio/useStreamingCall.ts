import { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceStatus } from "@shared/api";
import type { StreamFallbackReason, StreamOpenError } from "@shared/realtime";
import { STREAMING_ENABLED } from "@/config";
import { services } from "@/services";
import { createBatchedUpdater } from "./batchedState";
import { createDuplexAudio } from "./duplex";
import { setMicLevel, setMicLevelDb } from "./micLevel";
import { discardMine, endMine, expireMine, mineEnd, mineText, startMine, type MyCaption } from "./myCaptions";
import { createPlayingReporter } from "./playingSignal";
import { debug, markStreamed } from "./streamed";
import type { HandsFreeError, HandsFreeState } from "./useHandsFree";
import { createVad } from "./vad";

// 스트리밍 통역 통화 (docs/streaming-plan.md 5절, 서버 계약 docs/realtime-protocol.md 10절)
// - 말하는 동안 100ms PCM 조각을 보낸다. 단말 VAD 로 말소리 구간만 보내고(앞 0.4초 사전 버퍼, 말 멎은 뒤 0.6초까지), 끝나면 stream:pause
// - 상대 통역은 조각이 오는 대로 재생하고(이중 오디오), 원문·번역 자막을 실시간으로 보여 준다
// - 재생이 실제로 시작/끝나면 stream:playing 으로 서버에 알린다 → 서버가 그동안 내 마이크 조각(스피커 메아리)을 무음으로 바꾼다 (2026-10-19)
// - 스트림을 열 수 없거나(stream:open 실패, 이 기기에 이중 오디오 없음) 서버가 폴백을 알리면 mode = "utterance"
//   → 통화 화면은 기존 핸즈프리(발화 단위) 방식을 쓴다
// - 스트림으로 들은 문장은 기록 알림(message:new)이 와도 다시 재생하지 않는다 (audio/streamed.ts)
// - 저사양 폰 (2026-10-20): 마이크 음량은 React 상태가 아니라 audio/micLevel 저장소에 쓰고(음량 막대만 구독),
//   자막 글자 조각은 CAPTION_BATCH_MS 안에 모아 한 번에 setState 한다 → 통화 화면이 조각마다 다시 그려지지 않는다

const SAMPLE_RATE = 16_000;
/** 말 시작 판단 전 소리도 보내기 위한 사전 버퍼 (100ms × 4) */
const PREROLL_FRAMES = 4;
/** 내 말이 받아쓰는 중인데 서버 응답이 없으면 이만큼 뒤 "다시 말해 주세요" */
const MINE_TIMEOUT_MS = 8_000;
/** 캡션으로 남겨 두는 최근 턴 수 */
const MAX_CAPTIONS = 3;
/** 재생 끝 신호 떨림 제거: 이 시간 안에 다시 시작하면 끝→시작을 보내지 않는다 (턴 사이 짧은 끊김) */
const PLAYING_DEBOUNCE_MS = 200;
/** 자막 글자 조각을 이만큼 모아서 한 번에 그린다 (사람 눈에는 차이 없고 다시 그리기는 수십 분의 1) */
const CAPTION_BATCH_MS = 100;

export type StreamMode = "off" | "connecting" | "stream" | "relay" | "utterance";

export type Caption = {
  turnId: string;
  original: string | null;
  translation: string;
  status: "live" | "done" | "failed";
};

export type StreamFallback = StreamOpenError | StreamFallbackReason | "NO_DUPLEX" | "DISABLED" | "MIC";

export function useStreamingCall(options: {
  sessionId: string;
  /** 통화 중이고 실시간 연결이 살아 있는 동안 true */
  active: boolean;
  muted: boolean;
  onDevice?: (device: DeviceStatus) => void;
  /** 스트리밍 중에 폴백했을 때 (안내용) */
  onFallback?: (reason: StreamFallback) => void;
}) {
  const duplex = useMemo(() => createDuplexAudio(), []);
  const [mode, setMode] = useState<StreamMode>("off");
  const [fallback, setFallback] = useState<StreamFallback | null>(null);
  const [state, setState] = useState<HandsFreeState>("off");
  const [error, setError] = useState<HandsFreeError | null>(null);
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [myCaptions, setMyCaptions] = useState<MyCaption[]>([]);
  const mineSeq = useRef(0);
  // 글자 조각 갱신 모으기. 순서가 중요한 갱신(턴 시작·끝·내 말 시작)은 flush 뒤 바로 setState
  const captionBatch = useRef(createBatchedUpdater<Caption[]>(setCaptions, CAPTION_BATCH_MS));
  const mineBatch = useRef(createBatchedUpdater<MyCaption[]>(setMyCaptions, CAPTION_BATCH_MS));
  const updateMine = (reducer: (list: MyCaption[]) => MyCaption[]) => {
    mineBatch.current.flush();
    setMyCaptions(reducer);
  };

  const callbacks = useRef(options);
  callbacks.current = options;
  const live = useRef({ streamId: null as string | null, seq: 0, sending: false, preroll: [] as ArrayBuffer[], interpret: false });
  const playingReporter = useRef(
    createPlayingReporter(
      (now) => {
        if (live.current.streamId) services.realtime.reportStreamPlaying(live.current.streamId, now);
      },
      { debounceMs: PLAYING_DEBOUNCE_MS },
    ),
  );
  const turns = useRef(new Map<string, number>()); // turnId → sampleRate
  const fellBack = useRef(false);
  const vad = useRef(createVad({ endSilenceMs: 600 }));

  const goUtterance = (reason: StreamFallback, notify: boolean) => {
    fellBack.current = true;
    setFallback(reason);
    setMode("utterance");
    setState("off");
    if (notify) callbacks.current.onFallback?.(reason);
  };

  // ─── 스트림 열기·닫기 ──────────────────────────────

  useEffect(() => {
    if (!options.active || fellBack.current) {
      if (!fellBack.current) setMode((m) => (m === "off" ? m : "connecting"));
      return;
    }
    if (!STREAMING_ENABLED) return goUtterance("DISABLED", false);
    if (!duplex) return goUtterance("NO_DUPLEX", false);

    let cancelled = false;
    let offRoute: (() => void) | null = null;
    const l = live.current;
    setMode("connecting");
    setState("starting");
    (async () => {
      const result = await services.realtime.openStream(options.sessionId, { encoding: "pcm16", sampleRate: SAMPLE_RATE, channels: 1 });
      if (cancelled) {
        if (result.ok) services.realtime.closeStream(result.streamId);
        return;
      }
      if (!result.ok) return goUtterance(result.code, false);
      try {
        await duplex.start({ sampleRate: SAMPLE_RATE, frameMs: 100, echoCancellation: true });
      } catch {
        // 마이크를 못 쓰면 스트림을 닫고 기존 방식으로 (권한 안내는 핸즈프리 화면이 한다)
        services.realtime.closeStream(result.streamId);
        if (!cancelled) goUtterance("MIC", false);
        return;
      }
      if (cancelled) {
        services.realtime.closeStream(result.streamId);
        return;
      }
      l.streamId = result.streamId;
      l.interpret = result.mode !== "relay"; // 같은 언어 직접 전달은 받아쓰기가 없어 내 말 자막을 띄우지 않는다
      l.seq = 0;
      l.sending = false;
      l.preroll = [];
      vad.current.reset(Date.now());
      setError(null);
      setMode(result.mode === "relay" ? "relay" : "stream");
      setState(callbacks.current.muted ? "muted" : "listening");
      // 오디오 경로(블루투스 헤드셋·유선·스피커)를 상대 화면에 알린다. 바뀔 때마다 다시 알린다 (웹은 unknown)
      offRoute = duplex.onRoute((route, name) =>
        callbacks.current.onDevice?.({
          audioRoute: route === "speaker" ? "builtin" : route,
          inputName: name ?? null,
          micPermission: "granted",
        }),
      );
    })();

    return () => {
      cancelled = true;
      offRoute?.();
      if (l.streamId) services.realtime.closeStream(l.streamId);
      l.streamId = null;
      l.sending = false;
      playingReporter.current.reset();
      void duplex.stop();
      setMicLevel(0);
      setPlaying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.active, options.sessionId]);

  /** 내 말 끝: 받아쓰는 중으로 바꾸고, 서버 턴이 끝내 안 붙으면 조용히 지운다(에코·잡음, expireMine — 이미 붙었으면 no-op). 너무 짧아 버린 소리는 지운다 */
  const finishMine = (discarded: boolean) => {
    if (!live.current.interpret) return;
    if (discarded) return updateMine(discardMine);
    const key = `m${mineSeq.current}`;
    updateMine(endMine);
    setTimeout(() => updateMine((list) => expireMine(list, key)), MINE_TIMEOUT_MS);
  };

  // ─── 마이크 조각 → 단말 VAD 게이트 → 서버 ─────────────

  useEffect(() => {
    if (!duplex) return;
    const l = live.current;
    // 조각마다 새 함수를 만들지 않는다 (100ms 마다 호출)
    const send = (pcm: ArrayBuffer) => services.realtime.sendStreamAudio(l.streamId!, l.seq++, pcm);
    return duplex.onFrame((frame) => {
      if (!l.streamId) return;
      if (callbacks.current.muted) {
        if (l.sending) {
          services.realtime.pauseStream(l.streamId);
          finishMine(false);
        }
        l.sending = false;
        l.preroll = [];
        setMicLevel(0);
        return;
      }
      setMicLevelDb(frame.levelDb);
      const event = vad.current.push(frame.levelDb, frame.timestamp);
      if (event?.type === "speechStart") {
        l.sending = true;
        l.preroll.forEach(send);
        l.preroll = [];
        send(frame.pcm);
        setState("speaking");
        if (l.interpret) {
          const key = `m${++mineSeq.current}`;
          updateMine((list) => startMine(list, key));
        }
        return;
      }
      if (l.sending) send(frame.pcm);
      else {
        l.preroll.push(frame.pcm);
        if (l.preroll.length > PREROLL_FRAMES) l.preroll.shift();
      }
      if (event) {
        // 말 끝(뒤 0.6초까지 보냄)·너무 짧음·최대 길이: 서버에 말 끝을 알린다
        if (l.sending) {
          services.realtime.pauseStream(l.streamId);
          finishMine(event.type === "discard");
        }
        l.sending = false;
        setState("listening");
      }
    });
  }, [duplex]);

  useEffect(() => {
    if (mode === "stream" || mode === "relay") setState(options.muted ? "muted" : "listening");
  }, [options.muted, mode]);

  // ─── 상대 통역 받기 ────────────────────────────────

  useEffect(() => {
    if (!duplex) return;
    const { realtime } = services;
    const mineTurn = (turnId: string) => turns.current.has(turnId);
    const batch = captionBatch.current;
    const mine = mineBatch.current;
    const change = (turnId: string, apply: (c: Caption) => Caption) => (list: Caption[]) =>
      list.map((c) => (c.turnId === turnId ? apply(c) : c));

    const offs = [
      realtime.on("stream:out:start", (p) => {
        if (p.sessionId !== callbacks.current.sessionId) return;
        // 내 스트림(이중 오디오)이 열려 있을 때만 스트림으로 듣는다. 문장 단위로 통화 중이면(폴백·이중 오디오 없음) 이 턴을 받지 않아야
        // 들은 것으로 표시되지 않고, 이어 오는 기록 알림(message:new)이 평소처럼 재생된다 (상대만 스트리밍하는 통화에서 소리가 안 나던 문제, 2026-10-17)
        if (!live.current.streamId) return;
        turns.current.set(p.turnId, p.sampleRate);
        debug.streamTurns += 1;
        batch.flush();
        setCaptions((list) => [...list, { turnId: p.turnId, original: null, translation: "", status: "live" as const }].slice(-MAX_CAPTIONS));
      }),
      realtime.on("stream:out:audio", (p) => {
        const rate = turns.current.get(p.turnId);
        if (!rate) return;
        debug.streamChunks += 1;
        duplex.enqueue(p.turnId, p.pcm, rate);
      }),
      realtime.on("stream:out:text", (p) => {
        if (!mineTurn(p.turnId)) return;
        batch.queue(change(p.turnId, (c) => (p.kind === "original" ? { ...c, original: p.text } : { ...c, translation: c.translation + p.text })));
      }),
      realtime.on("stream:out:end", (p) => {
        if (!mineTurn(p.turnId)) return;
        turns.current.delete(p.turnId);
        duplex.endStream(p.turnId);
        // 다음에 올 같은 문장의 기록 알림(message:new)은 재생하지 않는다
        if (p.messageId) markStreamed(p.messageId);
        batch.flush();
        setCaptions(change(p.turnId, (c) => ({ ...c, status: p.status === "done" ? "done" : "failed" })));
      }),
      // 내 말의 받아쓰기·번역 (말한 사람에게, 2026-10-19)
      realtime.on("stream:mine:text", (p) => {
        if (p.sessionId !== callbacks.current.sessionId) return;
        mine.queue((list) => mineText(list, p.turnId, p.kind, p.text));
      }),
      realtime.on("stream:mine:end", (p) => {
        if (p.sessionId !== callbacks.current.sessionId) return;
        mine.flush();
        setMyCaptions((list) => mineEnd(list, p.turnId, p.status));
      }),
      realtime.on("stream:fallback", (p) => {
        if (p.streamId !== live.current.streamId) return;
        live.current.streamId = null;
        playingReporter.current.reset();
        void duplex.stop();
        goUtterance(p.reason, true);
      }),
    ];
    const offPlayback = duplex.onPlayback(({ playing: now }) => {
      setPlaying(now);
      playingReporter.current.update(now);
    });
    return () => {
      offs.forEach((off) => off());
      offPlayback();
      batch.clear();
      mine.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplex]);

  return { mode, fallback, state, error, playing, captions, myCaptions };
}
