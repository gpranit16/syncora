import client from './client';

export interface UnreadCounts {
  success: boolean;
  channel_unread: number;
  dm_unread: number;
  notifications: number;
  per_channel_unread: Record<number, number>;
  total_unread: number;
}

export const getUnreadCounts = () =>
  client.get<UnreadCounts>('/unread/count');
