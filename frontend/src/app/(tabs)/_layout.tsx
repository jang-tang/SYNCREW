import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { t, type StringKey } from "@/i18n/strings";
import { colors, fontSize } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; title: StringKey; icon: IconName }[] = [
  { name: "index", title: "tab.conversations", icon: "chatbubbles" },
  { name: "instructions", title: "tab.instructions", icon: "megaphone" },
  { name: "members", title: "tab.members", icon: "people" },
  { name: "settings", title: "tab.settings", icon: "settings" },
];

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { height: 72, paddingTop: 6, paddingBottom: 10 },
        tabBarLabelStyle: { fontSize: fontSize.caption, fontWeight: "700" },
        headerTitleStyle: { fontSize: fontSize.title, fontWeight: "700" },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.title),
            tabBarIcon: ({ color }) => <Ionicons name={tab.icon} size={28} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
