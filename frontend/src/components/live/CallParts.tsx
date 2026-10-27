import Ionicons from "@expo/vector-icons/Ionicons";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { MyCaption } from "@/audio/myCaptions";
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

/** 상대 말의 실시간 자막: 번역(크게) + 원문(작게). 가장 최근 턴만. captions 배열이 바뀔 때만 다시 그린다 (memo) */
/** peerName: 1:1 상대 이름. nameOf 가 있으면(현장 전체 연결) 말한 사람마다 이름을 찾는다 */
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
  const last = captions.at(-1);
  if (!last) return null;
  return (
    <View style={styles.caption} accessibilityLiveRegion="polite">
      <Text style={[font.caption, { color: colors.muted }]}>{nameOf?.(last.fromUserId) ?? peerName}</Text>
      <Text style={[font.bodyStrong, last.status === "failed" && { color: colors.danger }]}>
        {last.status === "failed" ? t("stream.failed") : last.translation || "…"}
      </Text>
      {last.original && <Text style={[font.caption, { color: colors.inkSoft }]}>{last.original}</Text>}
    </View>
  );
});

/** 내 말 자막: 말하는 순간부터 상태(듣는 중 → 받아쓰는 중 조각 → 원문·번역)를 보여 준다. 가장 최근 말만. failed 는 서버가 알린 때만 (2026-10-19) */
export const MyCaptions = memo(function MyCaptions({ captions }: { captions: MyCaption[] }) {
  const { t } = useT();
  const last = captions.at(-1);
  if (!last) return null;
  const failed = last.status === "failed";
  // 완성본 원문 → 받아쓰는 중 조각 → 둘 다 없으면 상태 문구
  const original = last.original ?? (last.partial || null);
  // 받아쓰는 중 조각은 아직 바뀔 수 있는 글자 → 흐리게. 확정 원문(통역에 쓴 글자)이 오면 진하게 바뀐다 (2026-10-28, docs/streaming-plan.md 4-4절)
  const provisional = !failed && last.original === null && !!last.partial;
  const pending = last.status === "speaking" ? t("stream.mine.speaking") : t("stream.mine.processing");
  return (
    <View style={[styles.caption, styles.mine]} accessibilityLiveRegion="polite">
      <Text style={[font.caption, { color: colors.muted }]}>{t("stream.mine.me")}</Text>
      <Text style={[font.bodyStrong, provisional && styles.provisional, failed && { color: colors.danger }]}>
        {failed && !original ? t("stream.mine.failed") : (original ?? pending)}
      </Text>
      {!failed && last.translation ? <Text style={[font.caption, { color: colors.inkSoft }]}>{last.translation}</Text> : null}
      {failed && original ? <Text style={[font.caption, { color: colors.danger }]}>{t("stream.failed")}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2 },
  modeChip: { alignSelf: "flex-start" },
  caption: { padding: spacing.md, borderRadius: 12, backgroundColor: colors.surfaceAlt, gap: 2 },
  mine: { alignSelf: "flex-end", maxWidth: "90%", borderWidth: 1, borderColor: colors.border },
  /** 받아쓰는 중(아직 확정 전) 원문 */
  provisional: { color: colors.muted, fontWeight: "400" },
});
