import { io, Socket } from 'socket.io-client';
import { API_BASE } from '../api/client';

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(API_BASE, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
};

export const connectSocket = (userId: number) => {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  
  // Clean up any existing listeners to prevent duplicates
  s.off('connect');
  
  // Re-emit user_online every time the socket connects (or reconnects!)
  s.on('connect', () => {
    s.emit('user_online', userId);
    s.emit('join_user_room', userId);
    s.emit('join_notifications', userId);
  });

  // If already connected, emit immediately
  if (s.connected) {
    s.emit('user_online', userId);
    s.emit('join_user_room', userId);
    s.emit('join_notifications', userId);
  }

  return s;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const joinChannel = (channelId: number) => {
  getSocket().emit('join_channel', channelId);
};

export const joinDm = (senderId: number, receiverId: number) => {
  getSocket().emit('join_dm', { senderId, receiverId });
};

export const emitSendMessage = (messageData: {
  message_id: number;
  channel_id: number;
  sender_id: number;
  sender_name: string;
  message_text: string;
  reply_to?: number | null;
  file_url?: string | null;
  file_name?: string | null;
  created_at: string;
}) => {
  getSocket().emit('send_message', messageData);
};

export const emitSendDm = (messageData: {
  direct_message_id: number;
  sender_id: number;
  receiver_id: number;
  sender_name: string;
  message_text: string;
  reply_to?: number | null;
  file_url?: string | null;
  file_name?: string | null;
  created_at: string;
}) => {
  getSocket().emit('send_dm', messageData);
};

export const emitDmEdited = (data: {
  direct_message_id: number;
  sender_id: number;
  receiver_id: number;
  message_text: string;
  is_edited: boolean;
}) => {
  getSocket().emit('dm_edited', data);
};

export const emitDmDeleted = (data: {
  direct_message_id: number;
  sender_id: number;
  receiver_id: number;
  is_deleted: boolean;
}) => {
  getSocket().emit('dm_deleted', data);
};

export const emitMessageEdited = (data: {
  message_id: number;
  channel_id: number;
  message_text: string;
  is_edited: boolean;
}) => {
  getSocket().emit('message_edited', data);
};

export const emitMessageDeleted = (data: {
  message_id: number;
  channel_id: number;
  is_deleted: boolean;
}) => {
  getSocket().emit('message_deleted', data);
};

export const emitTyping = (data: {
  user_name: string;
  channel_id?: number;
  sender_id?: number;
  receiver_id?: number;
}) => {
  getSocket().emit('typing', data);
};

export const emitStopTyping = (data: {
  user_name: string;
  channel_id?: number;
  sender_id?: number;
  receiver_id?: number;
}) => {
  getSocket().emit('stop_typing', data);
};

export const emitMarkChannelRead = (channelId: number, userId: number) => {
  getSocket().emit('mark_channel_read', { channel_id: channelId, user_id: userId });
};

export const emitMarkDmRead = (senderId: number, receiverId: number) => {
  getSocket().emit('mark_dm_read', { sender_id: senderId, receiver_id: receiverId });
};

export const emitTaskAssigned = (data: {
  assigned_to: number;
  task_title: string;
  workspace_name: string;
  assigned_by: string;
}) => {
  getSocket().emit('task_assigned', data);
};
