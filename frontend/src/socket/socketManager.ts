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

export const emitConversationDeleted = (data: {
  sender_id: number;
  receiver_id: number;
}) => {
  getSocket().emit('conversation_deleted', data);
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

export interface ReactionEventPayload {
  message_id?: number;
  channel_id?: number;
  direct_message_id?: number;
  sender_id?: number;
  receiver_id?: number;
  emoji: string;
  user_id: number;
}

export const emitReactionAdded = (data: ReactionEventPayload) => {
  getSocket().emit('reaction_added', data);
};

export const emitReactionRemoved = (data: ReactionEventPayload) => {
  getSocket().emit('reaction_removed', data);
};

export interface PinEventPayload {
  message_id?: number;
  channel_id?: number;
  direct_message_id?: number;
  sender_id?: number;
  receiver_id?: number;
  is_pinned: boolean;
}

export const emitMessagePinned = (data: PinEventPayload) => {
  getSocket().emit('message_pinned', data);
};

export const emitMessageUnpinned = (data: PinEventPayload) => {
  getSocket().emit('message_unpinned', data);
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

// ── WebRTC 1-to-1 Calls ───────────────────────────────────────────────────────
export interface CallUserPayload {
  receiver_id: number;
  call_type: 'voice' | 'video';
  offer?: RTCSessionDescriptionInit | null;
}

export interface CallAcceptPayload {
  call_id: string;
  answer?: RTCSessionDescriptionInit | null;
}

export interface CallRejectPayload {
  call_id: string;
  reason?: 'declined' | 'busy' | 'timeout';
}

export interface CallEndPayload {
  call_id?: string;
  target_user_id?: number;
  reason?: 'hung_up' | 'disconnected' | 'error';
}

export interface WebrtcSignalPayload {
  call_id: string;
  target_user_id: number;
  signal: {
    type: 'offer' | 'answer' | 'ice-candidate';
    sdp?: string;
    candidate?: RTCIceCandidateInit;
  };
}

export const emitCallUser = (data: CallUserPayload) => {
  getSocket().emit('call_user', data);
};

export const emitCallAccept = (data: CallAcceptPayload) => {
  getSocket().emit('call_accept', data);
};

export const emitCallReject = (data: CallRejectPayload) => {
  getSocket().emit('call_reject', data);
};

export const emitCallEnd = (data: CallEndPayload) => {
  getSocket().emit('call_end', data);
};

export const emitWebrtcSignal = (data: WebrtcSignalPayload) => {
  getSocket().emit('webrtc_signal', data);
};

// ── Multi-participant Meetings ──────────────────────────────────────────────
export interface MeetingJoinPayload {
  meeting_code: string;
  user_id: number;
  user_name: string;
  user_avatar?: string | null;
  user_email?: string | null;
  is_muted?: boolean;
  is_camera_off?: boolean;
}

export interface MeetingSignalPayload {
  meeting_code: string;
  target_socket_id: string;
  signal: {
    type: 'offer' | 'answer' | 'ice-candidate';
    sdp?: string;
    candidate?: RTCIceCandidateInit;
  };
}

export const emitMeetingJoin = (data: MeetingJoinPayload) => {
  getSocket().emit('meeting_join', data);
};

export const emitMeetingSignal = (data: MeetingSignalPayload) => {
  getSocket().emit('meeting_signal', data);
};

export const emitMeetingToggleMedia = (data: { meeting_code: string; is_muted?: boolean; is_camera_off?: boolean }) => {
  getSocket().emit('meeting_toggle_media', data);
};

export const emitMeetingMuteParticipant = (data: { meeting_code: string; target_socket_id: string }) => {
  getSocket().emit('meeting_mute_participant', data);
};

export const emitMeetingUnmuteParticipant = (data: { meeting_code: string; target_socket_id: string }) => {
  getSocket().emit('meeting_unmute_participant', data);
};

export const emitMeetingRemoveParticipant = (data: { meeting_code: string; target_socket_id: string }) => {
  getSocket().emit('meeting_remove_participant', data);
};

export const emitMeetingEnd = (data: { meeting_code: string }) => {
  getSocket().emit('meeting_end', data);
};

export const emitMeetingLeave = (data: { meeting_code: string }) => {
  getSocket().emit('meeting_leave', data);
};

export const emitMeetingTranscriptChunk = (data: {
  meeting_code: string;
  text: string;
  user_id?: number;
  user_name?: string;
  timestamp?: string;
  language?: string;
}) => {
  getSocket().emit('meeting_transcript_chunk', data);
};

export const emitMeetingScreenShareStatus = (data: {
  meeting_code: string;
  is_sharing: boolean;
}) => {
  getSocket().emit('meeting_screen_share_status', data);
};

export const emitMeetingStopScreenShare = (data: {
  meeting_code: string;
  target_socket_id: string;
}) => {
  getSocket().emit('meeting_stop_screen_share', data);
};

export const emitMeetingSendMessage = (data: {
  meeting_code: string;
  message: string;
}) => {
  getSocket().emit('meeting_send_message', data);
};

export const emitMeetingToggleScreenShareLock = (data: {
  meeting_code: string;
  is_locked: boolean;
}) => {
  getSocket().emit('meeting_toggle_screen_share_lock', data);
};



