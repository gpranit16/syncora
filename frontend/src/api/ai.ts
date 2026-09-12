import client from './client';

export interface AskAIRequest {
  question: string;
  context_type: 'channel' | 'dm';
  context_id?: number;
}

export interface AskAIResponse {
  success: boolean;
  answer?: string;
  sources?: string[];
  message?: string;
}

export const askAI = (data: AskAIRequest) =>
  client.post<AskAIResponse>('/ai/ask', data);

// ─── Task AI ──────────────────────────────────────────────────────────────────

export interface TaskAIActionFields {
  title?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  status?: 'pending' | 'in_progress' | 'completed';
  assigned_to_name?: string;
  _assigned_to_self?: boolean;
  _assigned_to_user_id?: number;
}

export interface TaskAIAction {
  action: true;
  type: 'create' | 'update';
  task_id: number | null;
  fields: TaskAIActionFields;
  preview: string;
}

export interface AskTaskAIResponse {
  success: boolean;
  answer?: string;
  action?: TaskAIAction;
  message?: string;
}

export const askTaskAI = (data: { question: string; workspace_id: number }) =>
  client.post<AskTaskAIResponse>('/ai/ask-tasks', data);