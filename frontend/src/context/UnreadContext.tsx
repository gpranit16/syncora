import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { getUnreadCounts, type UnreadCounts } from '../api/unread';
import { getSocket } from '../socket/socketManager';
import { useAuth } from './AuthContext';

interface UnreadContextType {
  unread: UnreadCounts | null;
  refreshUnread: () => Promise<void>;
}

const UnreadContext = createContext<UnreadContextType | undefined>(undefined);

export const UnreadProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [unread, setUnread] = useState<UnreadCounts | null>(null);

  const refreshUnread = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const { data } = await getUnreadCounts();
      setUnread(data);
    } catch (err) {
      console.error('Failed to fetch unread counts:', err);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshUnread();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getSocket();
    const handler = (data: UnreadCounts) => setUnread(data);
    socket.on('unread_update', handler);
    return () => { socket.off('unread_update', handler); };
  }, [isAuthenticated]);

  return (
    <UnreadContext.Provider value={{ unread, refreshUnread }}>
      {children}
    </UnreadContext.Provider>
  );
};

export const useUnread = () => {
  const ctx = useContext(UnreadContext);
  if (!ctx) throw new Error('useUnread must be used within UnreadProvider');
  return ctx;
};
