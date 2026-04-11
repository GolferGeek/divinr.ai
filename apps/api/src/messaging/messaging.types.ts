export type ChannelScope = 'dm' | 'club' | 'tournament' | 'system';

export type AttachableEntityType = 'prediction' | 'instrument' | 'tournament' | 'analyst' | 'position';

export interface Channel {
  id: string;
  scope: ChannelScope;
  scope_id: string | null;
  name: string | null;
  is_archived: boolean;
  created_at: string;
}

export interface ChannelMember {
  channel_id: string;
  user_id: string;
  role: 'member' | 'admin';
  last_read_at: string;
  is_blocked: boolean;
}

export interface Message {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string;
  parent_message_id: string | null;
  attached_entity_type: AttachableEntityType | null;
  attached_entity_id: string | null;
  is_pinned: boolean;
  is_deleted: boolean;
  created_at: string;
}

export interface MessageReaction {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface UserBlock {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface ChannelWithUnread extends Channel {
  unread_count: number;
  last_message_body: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
}

export interface SendMessageOptions {
  parent_message_id?: string;
  attached_entity_type?: AttachableEntityType;
  attached_entity_id?: string;
}
