import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { Recording } from "@/audio/useVoiceRecorder";
import { useT } from "@/i18n";
import { colors, font, radius, spacing } from "@/theme";
import { HoldToTalk, RecordingIndicator } from "./HoldToTalk";

/**
 * 대화 입력: 글을 쓰면 보내기 버튼, 비어 있으면 누르고 말하기 버튼.
 * (1:1 대화의 통역 통화 버튼은 없앴다 — 말로 하는 1:1 은 멤버 화면에서 사람을 눌러 연결, C2 2026-10-26)
 */
export function Composer({
  onSendText,
  onSendAudio,
}: {
  onSendText: (text: string) => void;
  onSendAudio: (recording: Recording) => void;
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
});
