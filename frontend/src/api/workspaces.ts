import client from './client';

export interface Workspace {
  workspace_id: number;
  name: string;
  description: string | null;
  owner_id: number;
  role: string;
  created_at: string;
}

export interface WorkspaceMember {
  user_id: number;
  name: string;
  email: string;
  avatar_url?: string | null;
  role: 'owner' | 'admin' | 'member';
  joined_at?: string;
}

export interface BannedMember {
  ban_id: number;
  workspace_id: number;
  user_id: number;
  banned_by: number;
  reason: string;
  created_at: string;
  name: string;
  email: string;
  avatar_url?: string | null;
  banned_by_name?: string;
}

export const getWorkspaces = () =>
  client.get<{ success: boolean; workspaces: Workspace[] }>('/workspaces/my-workspaces');

export const createWorkspace = (data: { name: string; description?: string }) =>
  client.post('/workspaces/create', data);

export const getAvailableWorkspaces = () =>
  client.get<{ success: boolean; workspaces: any[] }>('/workspaces/available');

export const joinWorkspace = (workspace_id: number) =>
  client.post('/workspaces/join', { workspace_id });

export const addMemberToWorkspace = (workspace_id: number, email: string, role: string = 'member') =>
  client.post('/workspaces/add-member', { workspace_id, email, role });

export const getWorkspaceMembers = (workspace_id: number) =>
  client.get<{ success: boolean; members: WorkspaceMember[] }>(`/workspaces/${workspace_id}/members`);

export const updateMemberRole = (workspace_id: number, user_id: number, role: 'admin' | 'member') =>
  client.put<{ success: boolean; message: string; role: string }>(`/workspaces/${workspace_id}/members/${user_id}/role`, { role });

export const removeMember = (workspace_id: number, user_id: number) =>
  client.delete<{ success: boolean; message: string }>(`/workspaces/${workspace_id}/members/${user_id}`);

export const banMember = (workspace_id: number, user_id: number, reason?: string) =>
  client.post<{ success: boolean; message: string }>(`/workspaces/${workspace_id}/members/${user_id}/ban`, { reason });

export const unbanMember = (workspace_id: number, user_id: number) =>
  client.post<{ success: boolean; message: string }>(`/workspaces/${workspace_id}/banned/${user_id}/unban`);

export const getBannedMembers = (workspace_id: number) =>
  client.get<{ success: boolean; banned_members: BannedMember[] }>(`/workspaces/${workspace_id}/banned`);
