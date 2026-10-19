import Ionicons from "@expo/vector-icons/Ionicons";
import { memo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { MessageView, Profile } from "@shared/api";
import { playNow, usePlaybackStore } from "@/audio/playback";
import { Avatar } from "@/components/ui/Avatar";
import { useT } from "@/i18n";
import { formatTime, nativeNameOf } from "@/lib/format";
import { colors, font, radius, spacing } from "@/theme";

function MineStatus({ message, onRetry }: { message: MessageView; onRetry: (messageId: string) => void }) {
  const { t } = useT();
  if (message.status === "queued" || message.status === "processing") {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={colors.muted} />
        <Text style={styles.statusText}>{t("chat.translating")}</Text>
      </View>
    );
  }
  if (message.status === "failed" || message.status === "partially_failed") {
    return (
      <Pressable accessibilityRole="button" onPress={() => onRetry(message.id)} style={styles.statusRow}>
        <Ionicons name="alert-circle" size={14} color={colors.danger} />
        <Text style={[styles.statusText, { color: colors.danger }]}>
          {t(message.status === "failed" ? "chat.failed" : "chat.partial")} · {t("common.retry")}
        </Text>
      </Pressable>
    );
  }
  const langs = (message.translations ?? []).filter((item) => item.status === "done").map((item) => item.lang.toUpperCase());
  return (
    <View style={styles.statusRow}>
      <Ionicons name="checkmark-done" size={14} color={colors.success} />
      {langs.length > 0 && <Text style={styles.statusText}>{langs.join(" · ")}</Text>}
    </View>
  );
}

/** 재시도가 없는 목록(통화·일괄 지시)용 고정 콜백 — 같은 참조를 넘겨야 memo 가 듣는다 */
export const NO_RETRY = (_messageId: string) => undefined;

/**
 * 말풍선. 목록이 바뀔 때 바뀌지 않은 메시지는 다시 그리지 않는다 (memo, 2026-10-20 저사양 폰 최적화).
 * - message·me 는 react-query 가 같은 내용이면 같은 참조를 유지한다 (structural sharing)
 * - onRetry 는 (messageId) => void 로 받아 부모가 안정된 콜백 하나를 넘길 수 있게 한다
 * - 재생 중 표시는 "이 메시지가 재생 중인가" 만 구독해, 다른 메시지가 재생돼도 다시 그리지 않는다
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  me,
  showSender,
  onRetry,
}: {
  message: MessageView;
  me: Profile;
  showSender: boolean;
  onRetry: (messageId: string) => void;
}) {
  const { t, lang } = useT();
  const playing = usePlaybackStore((state) => state.playingId === message.id);
  const mine = message.senderId === me.id;
  const time = formatTime(message.createdAt, lang);

  if (mine) {
    return (
      <View style={[styles.wrap, styles.right]}>
        <View style={[styles.bubble, styles.mine]}>
          {message.text ? (
            <Text style={[font.body, { color: "#FFFFFF" }]}>{message.text}</Text>
          ) : (
            <View style={styles.statusRow}>
              <Ionicons name="mic" size={16} color="rgba(255,255,255,0.7)" />
              <Text style={[font.body, { color: "rgba(255,255,255,0.7)" }]}>…</Text>
            </View>
          )}
        </View>
        <View style={[styles.meta, { justifyContent: "flex-end" }]}>
          {message.sessionId && <LiveTag instruction={message.kind === "instruction"} />}
          <MineStatus message={message} onRetry={onRetry} />
          <Text style={styles.time}>{time}</Text>
        </View>
      </View>
    );
  }

  const translated = message.sourceLang !== me.preferredLang;
  return (
    <View style={[styles.wrap, styles.left]}>
      {showSender && <Avatar id={message.senderId} name={message.senderName} size={36} />}
      <View style={{ flex: 1, gap: spacing.xs, alignItems: "flex-start" }}>
        {showSender && <Text style={styles.sender}>{message.senderName}</Text>}
        <View style={[styles.bubble, styles.theirs]}>
          {message.text ? (
            <Text style={[font.message, { color: colors.ink }]}>{message.text}</Text>
          ) : (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.brand} />
              <Text style={styles.statusText}>{t("chat.translating")}</Text>
            </View>
          )}
          {translated && message.originalText && (
            <View style={styles.original}>
              <Text style={styles.originalLabel}>
                {t("chat.original")} · {nativeNameOf(message.sourceLang)}
              </Text>
              <Text style={styles.originalText}>{message.originalText}</Text>
            </View>
          )}
          {message.text && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.replay")}
              onPress={() => playNow({ id: message.id, text: message.text, lang: me.preferredLang, audioUrl: message.audioUrl, rate: me.speechRate })}
              style={[styles.play, playing && styles.playing]}
            >
              <Ionicons name={playing ? "volume-high" : "play"} size={16} color={playing ? "#FFFFFF" : colors.brandPressed} />
              <Text style={[font.label, { color: playing ? "#FFFFFF" : colors.brandPressed }]}>{t("chat.replay")}</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.meta}>
          {message.sessionId && <LiveTag instruction={message.kind === "instruction"} />}
          <Text style={styles.time}>{time}</Text>
        </View>
      </View>
    </View>
  );
});

/** 실시간 통역 중 발화 표시: 1:1 통화는 '통화', 일괄 지시는 '실시간' */
function LiveTag({ instruction }: { instruction: boolean }) {
  const { t } = useT();
  return (
    <View style={styles.statusRow}>
      <Ionicons name={instruction ? "radio" : "call"} size={11} color={colors.success} />
      <Text style={[styles.statusText, { color: colors.success, fontWeight: "700" }]}>{t(instruction ? "instr.liveTag" : "chat.callTag")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, marginVertical: spacing.sm, maxWidth: "100%" },
  right: { alignItems: "flex-end", paddingLeft: 56 },
  left: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingRight: 40 },
  bubble: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, maxWidth: "100%" },
  mine: { backgroundColor: colors.ink, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderTopLeftRadius: 6, gap: spacing.sm, alignSelf: "stretch" },
  sender: { ...font.caption, fontWeight: "700", color: colors.inkSoft, marginLeft: spacing.xs },
  original: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm, gap: 2 },
  originalLabel: { ...font.caption, color: colors.muted },
  originalText: { ...font.label, fontWeight: "400", color: colors.inkSoft },
  play: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    alignSelf: "flex-start",
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  playing: { backgroundColor: colors.brand },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  statusText: { ...font.caption, color: colors.muted },
  time: { ...font.caption, color: colors.placeholder, marginLeft: spacing.xs },
});
