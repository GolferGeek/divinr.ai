import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useApi } from '../composables/useApi';

export interface Channel {
  id: string;
  scope: 'dm' | 'club' | 'tournament' | 'system';
  scope_id: string | null;
  name: string | null;
  is_archived: boolean;
  created_at: string;
  unread_count: number;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
}

export interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string;
  parent_message_id: string | null;
  attached_entity_type: string | null;
  attached_entity_id: string | null;
  is_pinned: boolean;
  is_deleted: boolean;
  created_at: string;
  reply_count?: number;
}

export const useMessagingStore = defineStore('messaging', () => {
  const channels = ref<Channel[]>([]);
  const activeChannelId = ref<string | null>(null);
  const messagesByChannel = ref<Record<string, Message[]>>({});
  const unreadCounts = ref<Record<string, number>>({});
  const loading = ref(false);
  const hasMore = ref<Record<string, boolean>>({});

  const totalUnread = computed(() =>
    Object.values(unreadCounts.value).reduce((sum, c) => sum + c, 0)
  );

  const activeMessages = computed(() =>
    activeChannelId.value ? (messagesByChannel.value[activeChannelId.value] ?? []) : []
  );

  async function fetchChannels() {
    const api = useApi();
    loading.value = true;
    try {
      const result = await api.get<{ data: Channel[] }>('/messaging/channels');
      channels.value = result.data;
      // Update unread counts from channel data
      for (const ch of result.data) {
        unreadCounts.value[ch.id] = ch.unread_count;
      }
    } catch {
      // Non-critical
    } finally {
      loading.value = false;
    }
  }

  async function getOrCreateDm(targetUserId: string): Promise<Channel> {
    const api = useApi();
    const result = await api.post<{ data: Channel }>('/messaging/channels/dm', {
      target_user_id: targetUserId,
    });
    const channel = result.data;
    if (!channels.value.some(c => c.id === channel.id)) {
      channels.value = [channel, ...channels.value];
      unreadCounts.value[channel.id] ??= 0;
    }
    return channel;
  }

  async function fetchMessages(channelId: string, before?: string) {
    const api = useApi();
    try {
      const query = before ? `?before=${before}&limit=50` : '?limit=50';
      const result = await api.get<{ data: Message[]; has_more: boolean }>(
        `/messaging/channels/${channelId}/messages${query}`
      );
      if (before) {
        // Append older messages
        const existing = messagesByChannel.value[channelId] ?? [];
        messagesByChannel.value[channelId] = [...existing, ...result.data];
      } else {
        messagesByChannel.value[channelId] = result.data;
      }
      hasMore.value[channelId] = result.has_more;
    } catch {
      // Non-critical
    }
  }

  async function sendMessage(channelId: string, body: string, opts?: {
    parent_message_id?: string;
    attached_entity_type?: string;
    attached_entity_id?: string;
  }) {
    const api = useApi();
    try {
      const result = await api.post<{ data: Message }>(
        `/messaging/channels/${channelId}/messages`,
        { body, ...opts }
      );
      const msgs = messagesByChannel.value[channelId] ?? [];
      messagesByChannel.value[channelId] = [result.data, ...msgs];
      return result.data;
    } catch (err) {
      // Re-fetch to ensure state is consistent
      await fetchMessages(channelId);
      throw err;
    }
  }

  async function markRead(channelId: string) {
    const api = useApi();
    try {
      await api.patch(`/messaging/channels/${channelId}/read`);
      unreadCounts.value[channelId] = 0;
      const ch = channels.value.find(c => c.id === channelId);
      if (ch) ch.unread_count = 0;
    } catch {
      // Non-critical
    }
  }

  async function fetchThread(channelId: string, messageId: string) {
    const api = useApi();
    try {
      const result = await api.get<{ data: Message[] }>(
        `/messaging/channels/${channelId}/threads/${messageId}`
      );
      return result.data;
    } catch {
      return [];
    }
  }

  async function addReaction(messageId: string, emoji: string) {
    const api = useApi();
    await api.post(`/messaging/messages/${messageId}/reactions`, { emoji });
  }

  async function removeReaction(messageId: string, emoji: string) {
    const api = useApi();
    await api.delete(`/messaging/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  async function togglePin(messageId: string) {
    const api = useApi();
    const result = await api.patch<{ data: { is_pinned: boolean } }>(`/messaging/messages/${messageId}/pin`);
    return result.data;
  }

  async function fetchPinnedMessages(channelId: string) {
    const api = useApi();
    try {
      const result = await api.get<{ data: Message[] }>(`/messaging/channels/${channelId}/pinned`);
      return result.data;
    } catch {
      return [];
    }
  }

  async function fetchUnreadCounts() {
    const api = useApi();
    try {
      const result = await api.get<{ data: Record<string, number> }>('/messaging/unread-counts');
      unreadCounts.value = result.data;
    } catch {
      // Non-critical
    }
  }

  function handleSseMessage(event: { hook_event_type: string; payload?: Record<string, unknown> }) {
    if (event.hook_event_type !== 'message_created') return;
    const channelId = event.payload?.channelId as string;
    if (!channelId) return;

    if (channelId === activeChannelId.value) {
      // Refresh messages for active channel
      fetchMessages(channelId);
    } else {
      // Increment unread count
      unreadCounts.value[channelId] = (unreadCounts.value[channelId] ?? 0) + 1;
      const ch = channels.value.find(c => c.id === channelId);
      if (ch) ch.unread_count = (ch.unread_count ?? 0) + 1;
    }
  }

  return {
    channels,
    activeChannelId,
    messagesByChannel,
    unreadCounts,
    loading,
    hasMore,
    totalUnread,
    activeMessages,
    fetchChannels,
    getOrCreateDm,
    fetchMessages,
    sendMessage,
    markRead,
    fetchUnreadCounts,
    fetchThread,
    addReaction,
    removeReaction,
    togglePin,
    fetchPinnedMessages,
    handleSseMessage,
  };
});
