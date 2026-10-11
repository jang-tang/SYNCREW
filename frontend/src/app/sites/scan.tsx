import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, IconButton } from "@/components/ui/Button";
import { useT } from "@/i18n";
import { toast } from "@/stores/toast";
import { colors, font, radius, spacing } from "@/theme";

/** QR 내용: syncrew://join?code=XXXXXXXX */
function codeFrom(data: string): string | null {
  const match = /^syncrew:\/\/join\?code=([A-Za-z0-9]{8})$/.exec(data.trim());
  return match ? match[1]!.toUpperCase() : null;
}

export default function Scan() {
  const { t } = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  return (
    <View style={styles.root}>
      {permission?.granted && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (handled.current) return;
            const code = codeFrom(data);
            if (!code) {
              toast(t("scan.invalid"), "error");
              return;
            }
            handled.current = true;
            router.dismissTo({ pathname: "/sites/join", params: { code } });
          }}
        />
      )}
      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
        <View style={styles.top}>
          <IconButton icon="close" label={t("common.close")} onPress={() => router.back()} />
          <Text style={[font.headline, { color: "#FFFFFF" }]}>{t("scan.title")}</Text>
          <View style={{ width: 44 }} />
        </View>
        {permission && !permission.granted ? (
          <View style={styles.permission}>
            <Text style={[font.body, { color: "#FFFFFF", textAlign: "center" }]}>{t("scan.permission")}</Text>
            <Button title={t("scan.allow")} onPress={() => void requestPermission()} />
          </View>
        ) : (
          <View style={styles.frameWrap}>
            <View style={styles.frame} />
            <Text style={styles.hint}>{t("scan.hint")}</Text>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  overlay: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  frameWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl },
  frame: { width: 240, height: 240, borderRadius: radius.lg, borderWidth: 3, borderColor: colors.brand },
  hint: { ...font.body, color: "#FFFFFF", textAlign: "center", paddingHorizontal: spacing.xxl },
  permission: { flex: 1, justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
});
