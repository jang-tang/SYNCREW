import Ionicons from "@expo/vector-icons/Ionicons";
import { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MyCaption } from "@/audio/myCaptions";
import { recentCaptions } from "@/audio/recentCaptions";
import type { Caption, StreamMode } from "@/audio/useStreamingCall";
import { useT, type StringKey } from "@/i18n";
import { colors, font, spacing } from "@/theme";

// 1:1 연결의 통역 표시 부품 (통화 화면에서 옮김, C2 2026-10-26). 연결 패널(ConnectionPanel)이 쓴다.

const MODE_TEXT: Partial<Record<StreamMode, StringKey>> = {
  connecting: "stream.connecting",
  stream: "stream.mode.stream",
  relay: "stream.mode.relay",
  utterance: "stream.mode.utterance",
};

/** 지금 통역 방식 (실시간 스트리밍 / 같은 언어 직접 전달 / 문장 단위) */
export const ModeChip = memo(function ModeChip({ mode }: { mode: StreamMode }) {
  const { t } = useT();
  const key = MODE_TEXT[mode];
  if (!key) return null;
  const tone = mode === "stream" || mode === "relay" ? colors.success : colors.muted;
  return (
    <View style={[styles.row, styles.modeChip]}>
      <Ionicons name={mode === "utterance" ? "chatbox-ellipses-outline" : "pulse"} size={14} color={tone} />
      <Text style={[font.caption, { color: tone, fontWeight: "700" }]}>{t(key)}</Text>
    </View>
  );
});

/** 최근 10초 안의 자막만 (두 줄 이상 보이는 동안 1초마다 다시 계산해 오래된 줄을 지운다) — 받은 자막·내 말 자막 공통 */
function useRecent<T extends { at: number }>(captions: T[]): T[] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (captions.length < 2) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [captions]);
  return recentCaptions(captions, now);
}

/**
 * 상대 말의 실시간 자막: 번역(크게) + 원문(작게). 최근 10초 안의 턴을 모두 순서대로 보여 주고, 지나면 가장 최근 턴만 남긴다
 * (2026-10-28 사용자: 짧게 여러 번 말하면 자막이 하나만 보여 앞 말을 글로 놓쳤다). 가장 최근 턴이 가장 아래·가장 진하다.
 * peerName: 1:1 상대 이름. nameOf 가 있으면(현장 전체 연결) 말한 사람마다 이름을 찾는다
 */
export const LiveCaptions = memo(function LiveCaptions({
  captions,
  peerName,
  nameOf,
}: {
  captions: Caption[];
  peerName: string;
  nameOf?: (userId: string) => string | undefined;
}) {
  const { t } = useT();
  const shown = useRecent(captions);
  if (shown.length === 0) return null;
  return (
    <View style={styles.caption} accessibilityLiveRegion="polite">
      {shown.map((caption, index) => {
        const last = index === shown.length - 1;
        return (
          <View key={caption.turnId} style={[{ gap: 2 }, !last && styles.older]}>
            <Text style={[font.caption, { color: colors.muted }]}>{nameOf?.(caption.fromUserId) ?? peerName}</Text>
            <Text style={[last ? font.bodyStrong : font.body, caption.status === "failed" && { color: colors.danger }]}>
              {caption.status === "failed" ? t("stream.failed") : caption.translation || "…"}
            </Text>
            {caption.original && <Text style={[font.caption, { color: colors.inkSoft }]}>{caption.original}</Text>}
          </View>
        );
      })}
    </View>
  );
});

/**
 * 내 말 자막: 말하는 순간부터 상태(듣는 중 → 받아쓰는 중 조각 → 원문·번역)를 보여 준다. failed 는 서버가 알린 때만 (2026-10-19).
 * 받은 자막과 같이 최근 10초 안의 말은 여러 줄로, 지나면 가장 최근 말만 (2026-10-28 사용자: 말하는 쪽도 같게)
 */
export const MyCaptions = memo(function MyCaptions({ captions }: { captions: MyCaption[] }) {
  const { t } = useT();
  const shown = useRecent(captions);
  if (shown.length === 0) return null;
  return (
    <View style={[styles.caption, styles.mine]} accessibilityLiveRegion="polite">
      <Text style={[font.caption, { color: colors.muted }]}>{t("stream.mine.me")}</Text>
      {shown.map((caption, index) => {
        const last = index === shown.length - 1;
        const failed = caption.status === "failed";
        // 완성본 원문 → 받아쓰는 중 조각 → 둘 다 없으면 상태 문구
        const original = caption.original ?? (caption.partial || null);
        // 받아쓰는 중 조각은 아직 바뀔 수 있는 글자 → 흐리게. 확정 원문(통역에 쓴 글자)이 오면 진하게 바뀐다 (2026-10-28, docs/streaming-plan.md 4-4절)
        const provisional = !failed && caption.original === null && !!caption.partial;
        const pending = caption.status === "speaking" ? t("stream.mine.speaking") : t("stream.mine.processing");
        return (
          <View key={caption.key} style={[{ gap: 2 }, !last && styles.older]}>
            <Text style={[last ? font.bodyStrong : font.body, provisional && styles.provisional, failed && { color: colors.danger }]}>
              {failed && !original ? t("stream.mine.failed") : (original ?? pending)}
            </Text>
            {!failed && caption.translation ? <Text style={[font.caption, { color: colors.inkSoft }]}>{caption.translation}</Text> : null}
            {failed && original ? <Text style={[font.caption, { color: colors.danger }]}>{t("stream.failed")}</Text> : null}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  modeChip: { alignSelf: "flex-start" },
  caption: { padding: spacing.md, borderRadius: 12, backgroundColor: colors.surfaceAlt, gap: spacing.sm },
  /** 최근 10초 안의 앞 턴: 흐리게 (가장 최근 턴이 눈에 띄게) */
  older: { opacity: 0.6 },
  mine: { alignSelf: "flex-end", maxWidth: "90%", borderWidth: 1, borderColor: colors.border },
  /** 받아쓰는 중(아직 확정 전) 원문 */
  provisional: { color: colors.muted, fontWeight: "400" },
});
