import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
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
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: spacing.md, flexGrow: 1 }}
          ListEmptyComponent={
            messages.isPending ? null : (
              <View style={{ transform: [{ scaleY: -1 }], flex: 1, justifyContent: "center" }}>
                <EmptyState icon="mic-outline" message={t("conv.noMessages")} />
              </View>
            )
          }
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              me={profile}
              showSender={group}
              onRetry={() => retry.mutate(item.id, { onError })}
            />
          )}
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
