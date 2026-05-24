import client from './client';

export interface Workspace {
  workspace_id: number;
  name: string;
  description: string | null;
  owner_id: number;
  role: string;
  created_at: string;
}

export const getWorkspaces = () =>
  client.get<{ success: boolean; workspaces: Workspace[] }>('/workspaces/my-workspaces');

export const createWorkspace = (data: { name: string; description?: string }) =>
  client.post('/workspaces/create', data);

export const getAvailableWorkspaces = () =>
  client.get<{ success: boolean; workspaces: any[] }>('/workspaces/available');

export const joinWorkspace = (workspace_id: number) =>
  client.post('/workspaces/join', { workspace_id });

export const addMemberToWorkspace = (workspace_id: number, email: string) =>
  client.post('/workspaces/add-member', { workspace_id, email });

export const getWorkspaceMembers = (workspace_id: number) =>
  client.get<{ success: boolean; members: any[] }>(`/workspaces/${workspace_id}/members`);
