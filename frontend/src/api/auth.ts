import client from './client';

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface AuthUser {
  user_id: number;
  name: string;
  email: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  token?: string;
  user?: AuthUser;
}

export const loginApi = (data: LoginPayload) =>
  client.post<AuthResponse>('/auth/login', data);

export const registerApi = (data: RegisterPayload) =>
  client.post<AuthResponse>('/auth/register', data);
