import client from './client';
import type { AuthUser } from './auth';

export interface UpdateProfilePayload {
  name: string;
  avatar_url?: string | null;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export const getProfile = () =>
  client.get<{ success: boolean; user: AuthUser }>('/users/profile');

export const updateProfile = (data: UpdateProfilePayload) =>
  client.put<{ success: boolean; message: string; user: AuthUser }>('/users/profile', data);

export const changePassword = (data: ChangePasswordPayload) =>
  client.put<{ success: boolean; message: string }>('/users/change-password', data);

export const uploadAvatar = (file: File) => {
  const formData = new FormData();
  formData.append('avatar', file);
  return client.post<{ success: boolean; message: string; avatar_url: string; user: AuthUser }>(
    '/users/avatar',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );
};
