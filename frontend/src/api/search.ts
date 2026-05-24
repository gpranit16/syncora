import client from './client';
import type { Message } from './messages';
import type { Task } from './tasks';
import type { Channel } from './channels';

export interface SearchUser {
  user_id: number;
  name: string;
  email: string;
  is_online?: boolean;
  last_seen?: string;
}

export interface SearchResults {
  users: SearchUser[];
  messages: Message[];
  tasks: Task[];
  channels: Channel[];
}

export const globalSearch = (query: string) =>
  client.get<SearchResults>('/search', { params: { q: query } });
