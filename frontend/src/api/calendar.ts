import client from './client';

export interface CalendarIntegrationStatus {
  connected: boolean;
  email: string | null;
  sync_tasks: boolean;
  sync_meetings: boolean;
  created_at?: string;
  updated_at?: string;
}

export const getGoogleCalendarAuthUrl = async (): Promise<{ authUrl: string }> => {
  const response = await client.get('/integrations/google/calendar/auth-url');
  return response.data;
};

export const getCalendarStatus = async (): Promise<CalendarIntegrationStatus> => {
  const response = await client.get('/integrations/google/calendar/status');
  return response.data;
};

export const updateCalendarSettings = async (settings: {
  sync_tasks?: boolean;
  sync_meetings?: boolean;
}): Promise<{ success: boolean; message: string }> => {
  const response = await client.put('/integrations/google/calendar/settings', settings);
  return response.data;
};

export const disconnectGoogleCalendar = async (): Promise<{ success: boolean; message: string }> => {
  const response = await client.post('/integrations/google/calendar/disconnect');
  return response.data;
};
