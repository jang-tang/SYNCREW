import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useCurrentSite, useInbox, useMembers, useSiteId } from "@/hooks/queries";
import { useT, type StringKey } from "@/i18n";
import { colors } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; title: StringKey; icon: IconName; iconActive: IconName }[] = [
  { name: "index", title: "tab.conversations", icon: "chatbubbles-outline", iconActive: "chatbubbles" },
  { name: "instructions", title: "tab.instructions", icon: "megaphone-outline", iconActive: "megaphone" },
  { name: "members", title: "tab.members", icon: "people-outline", iconActive: "people" },
  { name: "settings", title: "tab.settings", icon: "person-circle-outline", iconActive: "person-circle" },
];

export default function TabLayout() {
  const { t } = useT();
  const siteId = useSiteId();
  const { site } = useCurrentSite();
  const manager = site?.role === "manager";
  const inbox = useInbox(siteId, !manager);
  const members = useMembers(siteId);

  const badges: Record<string, number | undefined> = {
    instructions: manager ? undefined : inbox.data?.filter((item) => item.myStatus === "sent" || item.myStatus === "delivered").length,
    members: manager ? members.data?.filter((member) => member.status === "pending").length : undefined,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          height: 84,
          paddingTop: 8,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700", marginTop: 2 },
        tabBarBadgeStyle: { backgroundColor: colors.brand, fontSize: 11, fontWeight: "800" },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.title),
            tabBarBadge: badges[tab.name] || undefined,
            tabBarIcon: ({ focused }) => (
              <Ionicons name={focused ? tab.iconActive : tab.icon} size={26} color={focused ? colors.brand : colors.muted} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
