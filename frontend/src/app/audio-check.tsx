import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { createVolumeKeyDetector, DOUBLE_PRESS_MS } from "@/audio/callCycle";
import { createDuplexAudio, type AudioRoute } from "@/audio/duplex";
import { restoreVolume, stepVolume, volumeKeysAvailable, watchVolumeKeys } from "@/audio/volumeKeys";
import { Button } from "@/components/ui/Button";
import { Screen, StackHeader } from "@/components/ui/Screen";
import { colors, font, spacing } from "@/theme";

// 개발용 오디오 점검 화면 (개발 빌드에서만). 실기기에서 이중 오디오(S3)를 통화 없이 확인한다:
//   경로(헤드셋·스피커)·마이크 음량·조각 간격, 시험음 재생, 3초 녹음 후 다시 듣기, 재생 중 마이크로 새는 소리(에코)
//   음량 버튼(C1): 누름·한 번/두 번 판정 — 두 번 누르기는 음량이 남지 않아야 하고, 한 번 누름은 0.45초 뒤 한 칸 바뀐다
// 열기: 주소 syncrew:///audio-check (자동 시작: ?auto=1). 2초마다 요약을 콘솔에 남긴다 ("[audio-check]").
// 사용자용 화면이 아니므로 문구는 한국어로만 둔다.

const SAMPLE_RATE = 16_000;
const PLAY_RATE = 24_000;

type Stats = {
  frames: number;
  intervalAvg: number;
  intervalMax: number;
  levelDb: number;
  peakDb: number;
  route: AudioRoute;
  routeName: string | null;
  playing: boolean;
  /** 시험음 재생 중 마이크 최대 음량 (에코 정도) */
  echoPeakDb: number | null;
};

const EMPTY: Stats = {
  frames: 0,
  intervalAvg: 0,
  intervalMax: 0,
  levelDb: -160,
  peakDb: -160,
  route: "unknown",
  routeName: null,
  playing: false,
  echoPeakDb: null,
};

/** 24kHz 사인파 조각 (100ms 단위) */
function toneChunks(seconds: number, hz: number): ArrayBuffer[] {
  const per = PLAY_RATE / 10;
  const chunks: ArrayBuffer[] = [];
  for (let c = 0; c < seconds * 10; c++) {
    const pcm = new Int16Array(per);
    for (let i = 0; i < per; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * hz * (c * per + i)) / PLAY_RATE) * 12000);
    chunks.push(pcm.buffer);
  }
  return chunks;
}

export default function AudioCheck() {
  const { auto } = useLocalSearchParams<{ auto?: string }>();
  const duplex = useMemo(() => createDuplexAudio(), []);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [note, setNote] = useState<string | null>(null);

  const s = useRef({ ...EMPTY, lastAt: 0, intervalSum: 0, intervals: 0, recording: null as ArrayBuffer[] | null, echo: false });

  useEffect(() => {
    if (!duplex) return;
    const offFrame = duplex.onFrame((frame) => {
      const r = s.current;
      if (r.lastAt) {
        const gap = frame.timestamp - r.lastAt;
        r.intervalSum += gap;
        r.intervals += 1;
        r.intervalMax = Math.max(r.intervalMax, gap);
      }
      r.lastAt = frame.timestamp;
      r.frames += 1;
      r.levelDb = frame.levelDb;
      r.peakDb = Math.max(r.peakDb, frame.levelDb);
      if (r.echo) r.echoPeakDb = Math.max(r.echoPeakDb ?? -160, frame.levelDb);
      if (r.recording) r.recording.push(frame.pcm);
    });
    const offRoute = duplex.onRoute((route, name) => {
      s.current.route = route;
      s.current.routeName = name ?? null;
    });
    const offPlayback = duplex.onPlayback(({ playing }) => {
      s.current.playing = playing;
      if (!playing) s.current.echo = false;
    });
    const timer = setInterval(() => {
      const r = s.current;
      const next: Stats = {
        frames: r.frames,
        intervalAvg: r.intervals ? Math.round(r.intervalSum / r.intervals) : 0,
        intervalMax: Math.round(r.intervalMax),
        levelDb: Math.round(r.levelDb),
        peakDb: Math.round(r.peakDb),
        route: r.route,
        routeName: r.routeName,
        playing: r.playing,
        echoPeakDb: r.echoPeakDb === null ? null : Math.round(r.echoPeakDb),
      };
      setStats(next);
      console.log(`[audio-check] ${JSON.stringify(next)}`);
      r.peakDb = -160; // 최근 2초 최대값
    }, 2000);
    return () => {
      offFrame();
      offRoute();
      offPlayback();
      clearInterval(timer);
      void duplex.stop();
    };
  }, [duplex]);

  const start = async () => {
    if (!duplex) return;
    setError(null);
    try {
      await duplex.start({ sampleRate: SAMPLE_RATE, frameMs: 100, echoCancellation: true });
      setRunning(true);
      console.log("[audio-check] started");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      console.log(`[audio-check] start failed: ${message}`);
    }
  };

  const stop = async () => {
    await duplex?.stop();
    setRunning(false);
  };

  useEffect(() => {
    if (auto === "1" && duplex && __DEV__) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, duplex]);

  const playTone = () => {
    if (!duplex) return;
    s.current.echoPeakDb = null;
    s.current.echo = true;
    const id = `tone-${Date.now()}`;
    toneChunks(2, 440).forEach((chunk) => duplex.enqueue(id, chunk, PLAY_RATE));
    duplex.endStream(id);
    setNote("시험음 2초 (440Hz). 재생 중 마이크 최대 음량이 낮을수록 에코 제거가 잘 된 것입니다.");
  };

  const recordAndPlay = () => {
    if (!duplex) return;
    s.current.recording = [];
    setNote("3초 동안 말해 보세요…");
    setTimeout(() => {
      const chunks = s.current.recording ?? [];
      s.current.recording = null;
      const id = `loop-${Date.now()}`;
      chunks.forEach((chunk) => duplex.enqueue(id, chunk, SAMPLE_RATE));
      duplex.endStream(id);
      setNote(`녹음한 ${chunks.length}개 조각(${(chunks.length / 10).toFixed(1)}초)을 다시 재생합니다.`);
    }, 3000);
  };

  if (!__DEV__) {
    return (
      <Screen>
        <StackHeader title="오디오 점검" />
        <Text style={[font.body, { padding: spacing.xl }]}>개발 빌드에서만 쓸 수 있습니다.</Text>
      </Screen>
    );
  }

  const row = (label: string, value: string) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs }}>
      <Text style={[font.label, { color: colors.inkSoft }]}>{label}</Text>
      <Text style={[font.bodyStrong, { color: colors.ink }]}>{value}</Text>
    </View>
  );

  return (
    <Screen scroll>
      <StackHeader title="오디오 점검 (개발용)" subtitle={`${Platform.OS} · 이중 오디오 ${duplex ? "있음" : "없음"}`} />
      <View style={{ padding: spacing.xl, gap: spacing.md }}>
        {!duplex && <Text style={[font.body, { color: colors.danger }]}>이 빌드에는 이중 오디오가 없습니다 (통화는 문장 단위).</Text>}
        {error && <Text style={[font.body, { color: colors.danger }]}>시작 실패: {error}</Text>}
        <View>
          {row("상태", running ? "듣는 중" : "멈춤")}
          {row("경로", `${stats.route}${stats.routeName ? ` (${stats.routeName})` : ""}`)}
          {row("받은 조각", `${stats.frames}개`)}
          {row("조각 간격 평균 / 최대", `${stats.intervalAvg} / ${stats.intervalMax} ms`)}
          {row("마이크 음량 (최근 2초 최대)", `${stats.levelDb} dB (${stats.peakDb} dB)`)}
          {row("재생", stats.playing ? "재생 중" : "-")}
          {row("시험음 중 마이크 최대 (에코)", stats.echoPeakDb === null ? "-" : `${stats.echoPeakDb} dB`)}
        </View>
        {note && <Text style={[font.label, { color: colors.inkSoft }]}>{note}</Text>}
        <Button title={running ? "멈추기" : "시작"} variant={running ? "secondary" : "primary"} onPress={running ? stop : start} disabled={!duplex} />
        <Button title="시험음 재생 (2초)" variant="dark" onPress={playTone} disabled={!running} />
        <Button title="3초 녹음 후 다시 듣기" variant="dark" onPress={recordAndPlay} disabled={!running} />
        <VolumeKeyCheck />
      </View>
    </Screen>
  );
}

/** 음량 버튼 점검 (C1): 지켜보기를 켜면 누름(원신호)과 판정(한 번 → 음량 한 칸 / 두 번 → 다음·이전 멤버)을 보여 준다 */
function VolumeKeyCheck() {
  const [watching, setWatching] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!watching) return;
    const started = Date.now();
    const add = (line: string) => {
      const entry = `${((Date.now() - started) / 1000).toFixed(2)}s ${line}`;
      console.log(`[audio-check] volume ${entry}`);
      setLog((current) => [entry, ...current].slice(0, 10));
    };
    const detector = createVolumeKeyDetector(
      {
        onSingle: (direction) => {
          add(`한 번 ${direction} → 음량 한 칸`);
          stepVolume(direction);
        },
        onDouble: (direction) => {
          add(`두 번 ${direction} → ${direction === "up" ? "다음" : "이전"} 멤버`);
          restoreVolume();
        },
      },
      { windowMs: DOUBLE_PRESS_MS },
    );
    const unwatch = watchVolumeKeys((direction) => {
      add(`누름 ${direction}`);
      detector.press(direction);
    });
    return () => {
      unwatch();
      detector.reset();
    };
  }, [watching]);

  return (
    <View style={{ gap: spacing.sm, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={font.bodyStrong}>음량 버튼 (통화 상대 바꾸기)</Text>
      {!volumeKeysAvailable() && <Text style={[font.body, { color: colors.danger }]}>이 빌드에는 음량 버튼 기능이 없습니다.</Text>}
      <Button
        title={watching ? "음량 버튼 그만 보기" : "음량 버튼 지켜보기"}
        variant={watching ? "secondary" : "dark"}
        onPress={() => setWatching((value) => !value)}
        disabled={!volumeKeysAvailable()}
      />
      {log.length > 0 && <Button title="기록 지우기" variant="ghost" onPress={() => setLog([])} />}
      {log.map((line, index) => (
        <Text key={`${index}-${line}`} style={[font.caption, { color: colors.inkSoft }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}
