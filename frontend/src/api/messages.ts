import client from './client';
import type { ReactionState, ReactionSummary } from '../utils/reactions';

export interface Message {
  message_id: number;
  channel_id: number;
  sender_id: number;
  sender_name: string;
  sender_email: string;
  message_text: string;
  is_edited?: boolean;
  is_deleted?: boolean;
  reply_to?: number | null;
  file_url?: string | null;
  file_name?: string | null;
  reactions?: ReactionSummary[];
  my_reactions?: string[];
  is_pinned?: boolean;
  pinned_at?: string | null;
  message_type?: string;
  meeting_id?: number | null;
  meeting_code?: string | null;
  meeting_type?: string | null;
  meeting_duration?: number;
  created_at: string;
}

export interface SendMessagePayload {
  channel_id: number;
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
    is_pinned: boolean;
    pinned_at: string | null;
  };
}

export const getMessages = (channelId: number) =>
  client.get<{ success: boolean; messages: Message[] }>(`/messages/channel/${channelId}`);

export const sendMessage = (data: SendMessagePayload) =>
  client.post('/messages/send', data);

export const editMessage = (messageId: number, data: { message_text: string }) =>
  client.put(`/messages/edit/${messageId}`, data);

export const deleteMessage = (messageId: number) =>
  client.delete(`/messages/${messageId}`);

export const toggleMessageReaction = (messageId: number, emoji: string) =>
  client.put<ReactionToggleResponse>(`/messages/${messageId}/reactions`, { emoji });

export const removeMessageReaction = (messageId: number, emoji: string) =>
  client.delete<ReactionToggleResponse>(`/messages/${messageId}/reactions`, { data: { emoji } });

export const toggleMessagePin = (messageId: number) =>
  client.put<PinToggleResponse>(`/messages/${messageId}/pin`);

