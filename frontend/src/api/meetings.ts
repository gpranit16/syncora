import client from './client';

export interface Meeting {
  meeting_id: number;
  meeting_code: string;
  workspace_id: number;
  workspace_name?: string;
  channel_id?: number | null;
  channel_name?: string | null;
  host_id: number;
  host_user_id?: number;
  host_name?: string;
  host_email?: string;
  host_avatar?: string | null;
  title: string;
  mode: 'voice' | 'video';
  meeting_type?: 'voice' | 'video';
  status: 'active' | 'ended';
  is_host?: boolean;
  participants?: MeetingParticipant[];
  created_at?: string;
  ended_at?: string | null;
}

export interface MeetingParticipant {
  participant_id?: number;
  meeting_id?: number;
  user_id: number;
  name?: string;
  user_name?: string;
  email?: string;
  user_avatar?: string | null;
  role: 'host' | 'participant';
  status: 'connected' | 'left' | 'removed';
  is_muted: boolean;
  is_camera_off: boolean;
  joined_at?: string;
}

export interface CreateMeetingPayload {
  workspace_id: number;
  channel_id?: number | null;
  title?: string;
  mode?: 'voice' | 'video';
  meeting_type?: 'voice' | 'video';
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  participant_emails?: string[];
}

export const createMeeting = async (payload: CreateMeetingPayload): Promise<Meeting> => {
  const response = await client.post('/meetings/create', payload);
  return response.data.meeting || response.data.data;
};

export const getActiveMeetingByChannel = async (channelId: number): Promise<Meeting | null> => {
  const response = await client.get(`/meetings/channel/${channelId}/active`);
  return response.data.active_meeting || response.data.meeting || response.data.data || null;
};

export const getMeetingByCode = async (meetingCode: string): Promise<Meeting> => {
  const response = await client.get(`/meetings/code/${meetingCode}`);
  return response.data.meeting || response.data.data;
};

export const endMeeting = async (meetingIdOrCode: number | string): Promise<{ success: boolean; message: string }> => {
  const endpoint = typeof meetingIdOrCode === 'number'
    ? `/meetings/${meetingIdOrCode}/end`
    : `/meetings/code/${meetingIdOrCode}/end`;
  const response = await client.post(endpoint);
  return response.data;
};

export const inviteToMeeting = async (
  meetingId: number,
  targetUserIds: number[]
): Promise<{ success: boolean; message: string; invited_user_ids: number[] }> => {
  const response = await client.post(`/meetings/${meetingId}/invite`, {
    target_user_ids: targetUserIds,
  });
  return response.data;
};
