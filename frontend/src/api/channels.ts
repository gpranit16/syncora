import client from './client';

export interface Channel {
  channel_id: number;
  workspace_id: number;
  name: string;
  description: string | null;
  created_at: string;
}


export const getChannels = (workspaceId: number) =>
  client.get<{ success: boolean; channels: Channel[] }>(`/channels/workspace/${workspaceId}`);

export const createChannel = (data: { workspace_id: number; name: string; description?: string }) =>
  client.post('/channels/create', data);
