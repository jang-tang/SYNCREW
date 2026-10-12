// 핸즈프리 통역용 발화 감지 (VAD: voice activity detection)
// 녹음기의 음량(dBFS, 0 = 최대, -160 = 무음)을 일정 간격으로 받아 "말 시작 / 말 끝"을 판단한다.
// 주변 소음 수준을 따라가며 기준선을 정하므로 조용한 사무실과 시끄러운 현장에서 모두 동작하도록 한다.
// 외부 의존성이 없는 순수 로직 (단위 테스트: e2e/vad.test.mjs).

export type VadConfig = {
  /** 소음 기준선보다 이만큼(dB) 크면 말소리로 본다 */
  speechOverNoiseDb: number;
  /** 말소리 판단 기준의 하한·상한 (dBFS) */
  minThresholdDb: number;
  maxThresholdDb: number;
  /** 이 시간(ms) 이상 이어져야 말 시작으로 본다 (기침·충격음 제외) */
  speechStartMs: number;
  /** 말한 뒤 이 시간(ms) 조용하면 말이 끝난 것으로 본다 */
  endSilenceMs: number;
  /** 이보다 짧은 발화는 버린다 */
  minUtteranceMs: number;
  /** 발화가 이보다 길면 끊어서 보낸다 (서버 제한 30초) */
  maxUtteranceMs: number;
  /** 말이 없는 녹음이 이보다 길어지면 버리고 새로 시작한다 (파일이 커지지 않게) */
  idleResetMs: number;
  /** 처음 이 시간(ms)은 주변 소음 측정에만 쓴다 (통화 연결 직후) */
  calibrationMs: number;
};

export const DEFAULT_VAD: VadConfig = {
  speechOverNoiseDb: 12,
  minThresholdDb: -50,
  maxThresholdDb: -20,
  speechStartMs: 150,
  endSilenceMs: 800,
  minUtteranceMs: 400,
  maxUtteranceMs: 25_000,
  idleResetMs: 15_000,
  calibrationMs: 500,
};

/**
 * push() 결과
 * - speechStart: 말이 시작됨 (화면 표시용)
 * - utteranceEnd: 말이 끝남 → 지금까지의 녹음을 보낸다
 * - discard: 너무 짧거나 말이 없는 녹음 → 버리고 새로 시작
 */
export type VadEvent =
  | { type: "speechStart" }
  | { type: "utteranceEnd"; speechMs: number; reason: "silence" | "maxLength" }
  | { type: "discard"; reason: "tooShort" | "idle" };

export type VadSnapshot = {
  speaking: boolean;
  noiseDb: number;
  thresholdDb: number;
};

export function createVad(config: Partial<VadConfig> = {}) {
  const c: VadConfig = { ...DEFAULT_VAD, ...config };
  let noiseDb: number | null = null;
  let segmentStart = 0;
  let loudSince: number | null = null;
  let speechStart: number | null = null;
  let lastLoud = 0;
  /** 첫 reset 시각 (소음 측정 구간 판단) */
  let firstStart: number | null = null;
  /** 발화 중 음량 합계·개수 (소음이 갑자기 커진 경우 기준선 보정용) */
  let speechLevelSum = 0;
  let speechSamples = 0;

  const threshold = () => Math.min(c.maxThresholdDb, Math.max(c.minThresholdDb, (noiseDb ?? -60) + c.speechOverNoiseDb));

  /** 새 녹음 구간 시작 (소음 기준선은 유지) */
  const reset = (nowMs: number) => {
    firstStart ??= nowMs;
    speechLevelSum = 0;
    speechSamples = 0;
    segmentStart = nowMs;
    loudSince = null;
    speechStart = null;
    lastLoud = nowMs;
  };

  /** 구간을 끝내는 이벤트(발화 끝·버림)는 내보내면서 다음 구간을 시작한다 */
  const finish = (event: VadEvent, nowMs: number): VadEvent => {
    reset(nowMs);
    return event;
  };

  return {
    /** 새 녹음 구간을 시작한다 (녹음기를 다시 켤 때마다) */
    reset,

    push(levelDb: number, nowMs: number): VadEvent | null {
      const level = Number.isFinite(levelDb) ? Math.max(-160, levelDb) : -160;

      // 소음 측정 구간: 들어오는 소리를 모두 기준선으로 쓴다
      if (firstStart !== null && nowMs - firstStart < c.calibrationMs) {
        if (level > -160) noiseDb = noiseDb === null ? level : Math.max(noiseDb, level) * 0.5 + level * 0.5;
        return null;
      }
      const loud = level > threshold();

      if (speechStart === null) {
        // 말하지 않는 동안 소음 기준선을 천천히 따라간다 (큰 소리는 반영하지 않음)
        if (!loud) noiseDb = noiseDb === null ? level : noiseDb * 0.95 + level * 0.05;
        if (loud) {
          loudSince ??= nowMs;
          if (nowMs - loudSince >= c.speechStartMs) {
            speechStart = loudSince;
            lastLoud = nowMs;
            return { type: "speechStart" };
          }
        } else {
          loudSince = null;
        }
        if (nowMs - segmentStart >= c.idleResetMs) return finish({ type: "discard", reason: "idle" }, nowMs);
        return null;
      }

      if (loud) lastLoud = nowMs;
      speechLevelSum += level;
      speechSamples += 1;
      const speechMs = lastLoud - speechStart;
      if (nowMs - speechStart >= c.maxUtteranceMs) {
        // 25초 내내 큰 소리 = 말이 아니라 소음이 커졌을 수 있다 → 기준선을 그 수준으로 올린다
        noiseDb = speechLevelSum / speechSamples - 3;
        return finish({ type: "utteranceEnd", speechMs, reason: "maxLength" }, nowMs);
      }
      if (nowMs - lastLoud >= c.endSilenceMs) {
        return finish(
          speechMs >= c.minUtteranceMs ? { type: "utteranceEnd", speechMs, reason: "silence" } : { type: "discard", reason: "tooShort" },
          nowMs,
        );
      }
      return null;
    },

    snapshot(): VadSnapshot {
      return { speaking: speechStart !== null, noiseDb: noiseDb ?? -160, thresholdDb: threshold() };
    },
  };
}

export type Vad = ReturnType<typeof createVad>;
