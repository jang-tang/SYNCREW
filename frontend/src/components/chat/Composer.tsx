import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { Recording } from "@/audio/useVoiceRecorder";
import { useT } from "@/i18n";
import { colors, font, radius, spacing } from "@/theme";
import { HoldToTalk, RecordingIndicator } from "./HoldToTalk";

/**
 * 대화 입력: 글을 쓰면 보내기 버튼, 비어 있으면
 * - 1:1 대화: 통역 통화 버튼 (말은 통화로 — 버튼 없이 말하면 자동 통역)
 * - 그룹 대화: 누르고 말하기 버튼
 */
export function Composer({
  onSendText,
  onSendAudio,
  onCall,
}: {
  onSendText: (text: string) => void;
  onSendAudio: (recording: Recording) => void;
  /** 있으면 마이크 대신 통역 통화 버튼을 보여 준다 */
  onCall?: () => void;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const hasText = text.trim().length > 0;

  const send = () => {
    if (!hasText) return;
    onSendText(text.trim());
    setText("");
  };

  return (
    <View style={styles.wrap}>
      {recording && <RecordingIndicator />}
      <View style={styles.row}>
        <View style={styles.inputWrap}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("chat.typePlaceholder")}
            placeholderTextColor={colors.placeholder}
            multiline
            maxLength={500}
            style={styles.input}
            editable={!recording}
          />
        </View>
        {hasText ? (
          <Pressable accessibilityRole="button" accessibilityLabel="send" onPress={send} style={styles.send}>
            <Ionicons name="arrow-up" size={26} color="#FFFFFF" />
          </Pressable>
        ) : onCall ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("call.start")} onPress={onCall} style={[styles.send, styles.call]}>
            <Ionicons name="call" size={24} color="#FFFFFF" />
          </Pressable>
        ) : (
          <HoldToTalk onRecorded={onSendAudio} onRecordingChange={setRecording} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, backgroundColor: colors.background },
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  inputWrap: {
    flex: 1,
    minHeight: 56,
    justifyContent: "center",
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  input: { ...font.body, color: colors.ink, maxHeight: 120, paddingVertical: spacing.md },
  send: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  call: { backgroundColor: colors.success },
});
