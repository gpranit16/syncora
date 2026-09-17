import client from './client';
import type { ReactionState, ReactionSummary } from '../utils/reactions';

export interface DirectMessage {
  direct_message_id: number;
  sender_id: number;
  sender_name: string;
  sender_email: string;
  sender_avatar?: string | null;
  receiver_id: number;
  receiver_name: string;
  receiver_email: string;
  receiver_avatar?: string | null;
  message_text: string;
  reply_to?: number | null;
  file_url?: string | null;
  file_name?: string | null;
  is_edited?: boolean;
  is_deleted?: boolean;
  is_read: boolean;
  reactions?: ReactionSummary[];
  my_reactions?: string[];
  is_pinned?: boolean;
  pinned_at?: string | null;
  message_type?: 'text' | 'call';
  call_id?: string | null;
  call_type?: 'voice' | 'video' | null;
  call_status?: 'completed' | 'missed' | 'rejected' | 'failed' | 'cancelled' | null;
  call_duration?: number | null;
  created_at: string;
}

export interface SendDirectMessagePayload {
  receiver_id: number;
  message_text?: string;
  reply_to?: number | null;
  file_url?: string | null;
  file_name?: string | null;
}

export interface ReactionToggleResponse {
  success: boolean;
  message: string;
  data: ReactionState;
}

export interface PinToggleResponse {
  success: boolean;
  message: string;
  data: {
    message_id: number;
    direct_message_id: number;
    is_pinned: boolean;
    pinned_at: string | null;
  };
}

export const getDirectMessages = (receiverId: number) =>
  client.get<{ success: boolean; messages: DirectMessage[] }>(`/direct-messages/chat/${receiverId}`);

export const sendDirectMessage = (data: SendDirectMessagePayload) =>
  client.post('/direct-messages/send', data);

export const getRecentDmUsers = () =>
  client.get<{ success: boolean; users: { user_id: number; name: string; email: string; avatar_url?: string | null; is_online?: boolean; last_seen?: string }[] }>('/direct-messages/recent');

export const editDirectMessage = (messageId: number, messageText: string) =>
  client.put(`/direct-messages/${messageId}`, { message_text: messageText });

export const deleteDirectMessage = (messageId: number) =>
  client.delete(`/direct-messages/${messageId}`);

export const deleteConversation = (targetUserId: number) =>
  client.delete<{ success: boolean; message: string }>(`/direct-messages/conversation/${targetUserId}`);

export const toggleDmMessageReaction = (messageId: number, emoji: string) =>
  client.put<ReactionToggleResponse>(`/direct-messages/${messageId}/reactions`, { emoji });

export const removeDmMessageReaction = (messageId: number, emoji: string) =>
  client.delete<ReactionToggleResponse>(`/direct-messages/${messageId}/reactions`, { data: { emoji } });

export const toggleDmMessagePin = (messageId: number) =>
  client.put<PinToggleResponse>(`/direct-messages/${messageId}/pin`);

