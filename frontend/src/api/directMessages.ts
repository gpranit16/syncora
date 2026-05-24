import client from './client';

export interface DirectMessage {
  direct_message_id: number;
  sender_id: number;
  sender_name: string;
  sender_email: string;
  receiver_id: number;
  receiver_name: string;
  receiver_email: string;
  message_text: string;
  reply_to?: number | null;
  file_url?: string | null;
  file_name?: string | null;
  is_edited?: boolean;
  is_deleted?: boolean;
  is_read: boolean;
  created_at: string;
}

export interface SendDirectMessagePayload {
  receiver_id: number;
  message_text?: string;
  reply_to?: number | null;
  file_url?: string | null;
  file_name?: string | null;
}

export const getDirectMessages = (receiverId: number) =>
  client.get<{ success: boolean; messages: DirectMessage[] }>(`/direct-messages/chat/${receiverId}`);

export const sendDirectMessage = (data: SendDirectMessagePayload) =>
  client.post('/direct-messages/send', data);

export const getRecentDmUsers = () =>
  client.get<{ success: boolean; users: { user_id: number; name: string; email: string; is_online?: boolean; last_seen?: string }[] }>('/direct-messages/recent');

export const editDirectMessage = (messageId: number, messageText: string) =>
  client.put(`/direct-messages/${messageId}`, { message_text: messageText });

export const deleteDirectMessage = (messageId: number) =>
  client.delete(`/direct-messages/${messageId}`);
