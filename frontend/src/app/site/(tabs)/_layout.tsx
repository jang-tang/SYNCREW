import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConversations, useCurrentSite, useInbox, useMembers, useSiteId } from "@/hooks/queries";
import { useT, type StringKey } from "@/i18n";
import { colors } from "@/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

// 연결(첫 화면, 예전 대화·멤버 탭을 합침 2026-10-27) · 지시 · 설정
const TABS: { name: string; title: StringKey; icon: IconName; iconActive: IconName }[] = [
  { name: "index", title: "tab.connect", icon: "people-outline", iconActive: "people" },
  { name: "instructions", title: "tab.instructions", icon: "megaphone-outline", iconActive: "megaphone" },
  { name: "settings", title: "tab.settings", icon: "person-circle-outline", iconActive: "person-circle" },
];

export default function TabLayout() {
  const { t } = useT();
  const siteId = useSiteId();
  const { site } = useCurrentSite();
  const manager = site?.role === "manager";
  const inbox = useInbox(siteId, !manager);
  const members = useMembers(siteId);
  const conversations = useConversations(siteId);
  const insets = useSafeAreaInsets();

  const badges: Record<string, number | undefined> = {
    instructions: manager ? undefined : inbox.data?.filter((item) => item.myStatus === "sent" || item.myStatus === "delivered").length,
    // 연결 탭: 안 읽은 메시지 + (관리자) 가입 요청
    index:
      (conversations.data?.reduce((sum, c) => sum + c.unreadCount, 0) ?? 0) +
      (manager ? (members.data?.filter((member) => member.status === "pending").length ?? 0) : 0),
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          // 탭 영역 50 + 기기 아래 여백 (iPhone 홈 막대 34 → 84). 높이를 84로 고정하면 Galaxy 시스템 버튼에 탭 글자가 겹친다 (10-27)
          height: 50 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom,
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
