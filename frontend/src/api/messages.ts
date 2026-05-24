import client from './client';

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
  created_at: string;
}

export interface SendMessagePayload {
  channel_id: number;
  message_text?: string;
  reply_to?: number | null;
  file_url?: string | null;
  file_name?: string | null;
}

export const getMessages = (channelId: number) =>
  client.get<{ success: boolean; messages: Message[] }>(`/messages/channel/${channelId}`);

export const sendMessage = (data: SendMessagePayload) =>
  client.post('/messages/send', data);

export const editMessage = (messageId: number, data: { message_text: string }) =>
  client.put(`/messages/edit/${messageId}`, data);

export const deleteMessage = (messageId: number) =>
  client.delete(`/messages/${messageId}`);
