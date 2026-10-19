import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { FlatList, Platform, StyleSheet, Text, View, type ListRenderItem } from "react-native";
import type { MessageView } from "@shared/api";
import { Composer } from "@/components/chat/Composer";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Avatar } from "@/components/ui/Avatar";
import { LangBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen, StackHeader } from "@/components/ui/Screen";
import {
  newClientMessageId,
  useConversations,
  useMe,
  useMessages,
  useRetryMessage,
  useSendMessage,
  useSiteId,
  useStartCall,
} from "@/hooks/queries";
import { useErrorMessage } from "@/hooks/useErrorMessage";
import { useT } from "@/i18n";
import { nativeNameOf } from "@/lib/format";
import { toast } from "@/stores/toast";
import { colors, font, spacing } from "@/theme";

/**
 * 역순(inverted) 목록의 빈 화면 보정. 네이티브는 React Native 가 빈 화면을 이미 바로 세워 주므로 웹에서만 뒤집는다.
 * (네이티브에서도 뒤집으면 Android 는 좌우 거울 글자, iOS 는 거꾸로 보인다 — 2026-10-14 Galaxy S22 실기기에서 발견)
 */
const WEB_EMPTY_FLIP = Platform.OS === "web" ? { transform: [{ scaleY: -1 as const }] } : {};

const keyOf = (item: MessageView) => item.id;
const LIST_CONTENT = { paddingVertical: spacing.md, flexGrow: 1 };

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const errorMessage = useErrorMessage();
  const siteId = useSiteId();
  const me = useMe();
  const conversations = useConversations(siteId);
  const messages = useMessages(id);
  const conversation = conversations.data?.find((c) => c.id === id);
  const profile = me.data;
  const send = useSendMessage(id, { id: profile?.id ?? "", name: profile?.displayName ?? "", lang: profile?.preferredLang ?? "ko" });
  const retry = useRetryMessage(id);
  const startCall = useStartCall(siteId);

  // 대화를 열면 읽음 처리된 목록으로 갱신
  useEffect(() => {
    void conversations.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.dataUpdatedAt]);

  const data = useMemo(() => [...(messages.data ?? [])].sort((a, b) => a.seq - b.seq).reverse(), [messages.data]);
  const group = conversation?.type === "group";

  const onError = (error: unknown) => toast(errorMessage(error), "error");
  // 말풍선(memo)에 같은 콜백·렌더 함수를 넘겨 메시지가 추가돼도 기존 말풍선은 다시 그리지 않는다 (2026-10-20)
  const retryMessage = useCallback((messageId: string) => retry.mutate(messageId, { onError: (error: unknown) => toast(errorMessage(error), "error") }), [retry, errorMessage]);
  const renderItem = useCallback<ListRenderItem<MessageView>>(
    ({ item }) => <MessageBubble message={item} me={profile!} showSender={group} onRetry={retryMessage} />,
    [profile, group, retryMessage],
  );
  const peer = conversation?.peer;
  const call = peer
    ? () => startCall.mutate(peer.userId, { onSuccess: (session) => router.push(`/site/call/${session.id}`), onError })
    : undefined;

  const header = conversation?.peer ? (
    <View style={styles.title}>
      <Avatar id={conversation.peer.userId} name={conversation.peer.displayName} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={font.headline} numberOfLines={1}>
          {conversation.peer.displayName}
        </Text>
        <View style={styles.sub}>
          <LangBadge lang={conversation.peer.lang} />
          <Text style={styles.subText}>{nativeNameOf(conversation.peer.lang)}</Text>
        </View>
      </View>
    </View>
  ) : (
    <View>
      <Text style={font.headline}>{t("conv.group")}</Text>
      {conversation && <Text style={styles.subText}>{t("common.people", { n: conversation.participantCount })}</Text>}
    </View>
  );

  return (
    <Screen edges={["top", "bottom"]}>
      <StackHeader subtitle={header} />
      <View style={styles.divider} />
      {profile && (
        <FlatList
          inverted
          data={data}
          keyExtractor={keyOf}
          contentContainerStyle={LIST_CONTENT}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={7}
          ListEmptyComponent={
            messages.isPending ? null : (
              <View style={{ ...WEB_EMPTY_FLIP, flex: 1, justifyContent: "center" }}>
                <EmptyState icon="mic-outline" message={t("conv.noMessages")} />
              </View>
            )
          }
          renderItem={renderItem}
        />
      )}
      <Composer
        onCall={call}
        onSendText={(text) => send.mutate({ input: { kind: "text", text }, clientMessageId: newClientMessageId() }, { onError })}
        onSendAudio={(recording) =>
          send.mutate(
            { input: { kind: "audio", uri: recording.uri, mimeType: recording.mimeType }, clientMessageId: newClientMessageId() },
            { onError },
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  sub: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginTop: 2 },
  subText: { ...font.caption, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.border },
});
