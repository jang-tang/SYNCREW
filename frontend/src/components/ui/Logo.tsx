import { Image } from "react-native";

const SOURCES = {
  color: require("../../../assets/brand/syncfield-logo.png"),
  white: require("../../../assets/brand/syncfield-logo-white.png"),
};
const RATIO = 987 / 233;

export function Logo({ height = 28, variant = "color" }: { height?: number; variant?: keyof typeof SOURCES }) {
  return (
    <Image
      source={SOURCES[variant]}
      style={{ height, width: height * RATIO }}
      resizeMode="contain"
      accessibilityLabel="SyncField"
    />
  );
}
