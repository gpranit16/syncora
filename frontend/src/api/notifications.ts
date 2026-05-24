import client from './client';

export interface Notification {
  notification_id: number;
  user_id: number;
  message: string;
  type: 'message' | 'task' | 'workspace';
  is_read: boolean;
  created_at: string;
}

export const getNotifications = () =>
  client.get<{ success: boolean; notifications: Notification[] }>('/notifications/my-notifications');

export const markNotificationRead = (notificationId: number) =>
  client.put(`/notifications/read/${notificationId}`);
