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
}

export const getTasks = (workspaceId: number) =>
  client.get<{ success: boolean; tasks: Task[] }>(`/tasks/workspace/${workspaceId}`);

export const createTask = (data: {
  workspace_id: number;
  title: string;
  description?: string;
  assigned_to?: number;
  status?: string;
  priority?: string;
  due_date?: string;
}) => client.post('/tasks/create', data);

export const updateTaskStatus = (taskId: number, status: string) =>
  client.put(`/tasks/status/${taskId}`, { status });
