import client from './client';

export interface Task {
  task_id: number;
  workspace_id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  created_at: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number;
  created_by_name: string;
  // Source attribution (set when task was created from a message)
  source_message_id?: number | null;
  source_message_type?: 'channel' | 'dm' | null;
  source_channel_id?: number | null;
  source_dm_user_id?: number | null;
}

export interface CreateTaskFromMessagePayload {
  workspace_id: number;
  title: string;
  description?: string;
  assigned_to?: number;
  priority?: string;
  due_date?: string;
  source_message_id: number;
  source_message_type: 'channel' | 'dm';
  source_channel_id?: number;
  source_dm_user_id?: number;
}

export const getTasks = (workspaceId: number, params?: { scope?: string; assigned_to?: number | 'me'; created_by?: number | 'me'; status?: string }) =>
  client.get<{ success: boolean; tasks: Task[] }>(`/tasks/workspace/${workspaceId}`, { params });

export const createTask = (data: {
  workspace_id: number;
  title: string;
  description?: string;
  assigned_to?: number | null;
  status?: string;
  priority?: string;
  due_date?: string;
}) => client.post('/tasks/create', data);

export const createTaskFromMessage = (data: CreateTaskFromMessagePayload) =>
  client.post('/tasks/create-from-message', data);

export const updateTask = (taskId: number, data: {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  due_date?: string | null;
  assigned_to?: number | null;
}) => client.put(`/tasks/update/${taskId}`, data);

export const deleteTask = (taskId: number) =>
  client.delete<{ success: boolean; message: string; task_id: number }>(`/tasks/${taskId}`);

export const updateTaskStatus = (taskId: number, status: string) =>
  client.put(`/tasks/status/${taskId}`, { status });
