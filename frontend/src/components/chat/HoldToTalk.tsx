import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useVoiceRecorder, type Recording } from "@/audio/useVoiceRecorder";
import { useT } from "@/i18n";
import { toast } from "@/stores/toast";
import { colors, font, radius, shadow, spacing } from "@/theme";

const haptic = (style: Haptics.ImpactFeedbackStyle) => {
  if (Platform.OS !== "web") void Haptics.impactAsync(style).catch(() => undefined);
};

/**
 * 누르고 있는 동안 녹음, 떼면 전송.
 * 장갑을 낀 손으로도 누르기 쉽게 크게 만든다.
 */
export function HoldToTalk({
  onRecorded,
  onRecordingChange,
  size = 56,
  label,
}: {
  onRecorded: (recording: Recording) => void;
  onRecordingChange?: (recording: boolean) => void;
  size?: number;
  /** 버튼 아래 안내 문구 (큰 버튼일 때) */
  label?: boolean;
}) {
  const { t } = useT();
  const recorder = useVoiceRecorder();
  const pulse = useRef(new Animated.Value(0)).current;
  const pressed = useRef(false);

  useEffect(() => {
    onRecordingChange?.(recorder.isRecording);
    if (!recorder.isRecording) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ).start();
  }, [recorder.isRecording, pulse, onRecordingChange]);

  const begin = async () => {
    pressed.current = true;
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    const error = await recorder.start();
    if (error === "permission") toast(t("chat.micPermission"), "error");
    else if (error) toast(t("chat.recordFailed"), "error");
    // 녹음 준비 중에 이미 손을 뗐다면 바로 종료
    if (!error && !pressed.current) void end();
  };

  const end = async () => {
    pressed.current = false;
    if (!recorder.isRecording) return;
    const result = await recorder.stop();
    haptic(Haptics.ImpactFeedbackStyle.Light);
    if (result === "too_short") toast(t("chat.tooShort"));
    else if (result === "failed" || result === "permission") toast(t("chat.recordFailed"), "error");
    else onRecorded(result);
  };

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View style={{ alignItems: "center", gap: spacing.sm }}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            { width: size, height: size, borderRadius: size / 2, opacity: ringOpacity, transform: [{ scale: ringScale }] },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.hold")}
          onPressIn={() => void begin()}
          onPressOut={() => void end()}
          style={[
            styles.button,
            { width: size, height: size, borderRadius: size / 2 },
            recorder.isRecording && styles.recording,
          ]}
        >
          <Ionicons name={recorder.isRecording ? "radio-button-on" : "mic"} size={size * 0.42} color="#FFFFFF" />
        </Pressable>
      </View>
      {label && <Text style={styles.label}>{recorder.isRecording ? t("chat.recording") : t("chat.hold")}</Text>}
    </View>
  );
}

/** 녹음 중 입력창 위에 뜨는 안내 */
export function RecordingIndicator() {
  const { t } = useT();
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.25, duration: 500, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);
  return (
    <View style={styles.indicator}>
      <Animated.View style={[styles.dot, { opacity: blink }]} />
      <Text style={[font.label, { color: "#FFFFFF" }]}>{t("chat.recording")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: "absolute", backgroundColor: colors.brand },
  button: { alignItems: "center", justifyContent: "center", backgroundColor: colors.brand, ...shadow.floating },
  recording: { backgroundColor: colors.brandPressed, transform: [{ scale: 1.08 }] },
  label: { ...font.label, color: colors.inkSoft },
  indicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    marginBottom: spacing.sm,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
});
