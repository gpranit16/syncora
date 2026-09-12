import client from './client';

export interface MeetingTranscriptSegment {
  speaker_id?: number | null;
  speaker_name?: string;
  text: string;
  timestamp?: string;
  language?: string;
}

export interface MeetingTranscript {
  transcript_id: number;
  meeting_id: number;
  meeting_code: string;
  workspace_id: number;
  channel_id?: number | null;
  transcript_text: string;
  segments: MeetingTranscriptSegment[];
  language?: string;
  created_at: string;
  updated_at?: string;
}

export interface MeetingActionItem {
  title: string;
  assignee?: string | null;
  deadline?: string | null;
  source?: string | null;
}

export interface MeetingSummary {
  summary_id?: number;
  meeting_id: number;
  meeting_code: string;
  workspace_id: number;
  channel_id?: number | null;
  language: 'en' | 'hi' | 'same' | string;
  summary_text: string;
  decisions: string[];
  action_items: MeetingActionItem[];
  blockers: string[];
  deadlines: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ConvertActionItemPayload {
  title: string;
  description?: string;
  assignee_name?: string | null;
  assigned_to?: number | null;
  priority?: 'low' | 'medium' | 'high';
  deadline?: string | null;
  due_date?: string | null;
}

/**
 * Fetch meeting transcript
 */
export const getMeetingTranscript = async (meetingCode: string): Promise<MeetingTranscript | null> => {
  const res = await client.get(`/meetings/${meetingCode}/transcript`);
  return res.data.transcript || null;
};

/**
 * Save meeting transcript
 */
export const saveMeetingTranscript = async (
  meetingCode: string,
  payload: {
    transcript_text?: string;
    segments?: MeetingTranscriptSegment[];
    language?: string;
  }
): Promise<MeetingTranscript> => {
  const res = await client.post(`/meetings/${meetingCode}/transcript`, payload);
  return res.data.transcript;
};

/**
 * Fetch existing meeting summary
 */
export const getMeetingSummary = async (
  meetingCode: string,
  lang: string = 'en'
): Promise<MeetingSummary | null> => {
  const res = await client.get(`/meetings/${meetingCode}/summary`, {
    params: { lang },
  });
  return res.data.summary || null;
};

/**
 * Generate (or force regenerate) AI meeting summary via Nemotron
 */
export const generateMeetingSummary = async (
  meetingCode: string,
  payload?: {
    language?: 'en' | 'hi' | 'same';
    force_regenerate?: boolean;
    transcript_text?: string;
  }
): Promise<{ summary: MeetingSummary; cached: boolean }> => {
  const res = await client.post(`/meetings/${meetingCode}/summary`, payload || { language: 'en' });
  return {
    summary: res.data.summary,
    cached: !!res.data.cached,
  };
};

/**
 * Convert a confirmed action item into a real workspace Task
 */
export const convertActionItemToTask = async (
  meetingCode: string,
  payload: ConvertActionItemPayload
): Promise<any> => {
  const res = await client.post(`/meetings/${meetingCode}/action-items/convert-task`, payload);
  return res.data.task;
};
