import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../socket/socketManager';

interface TypingUser {
  user_name: string;
  timestamp: number;
}

export const useTypingIndicator = (channelId?: number) => {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const timeoutRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!channelId) return;
    const socket = getSocket();

    const handleTyping = (data: { user_name: string; channel_id?: number }) => {
      if (data.channel_id !== channelId) return;
      setTypingUsers((prev) => {
        const filtered = prev.filter((u) => u.user_name !== data.user_name);
        return [...filtered, { user_name: data.user_name, timestamp: Date.now() }];
      });
      if (timeoutRefs.current[data.user_name]) {
        clearTimeout(timeoutRefs.current[data.user_name]);
      }
      timeoutRefs.current[data.user_name] = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u.user_name !== data.user_name));
      }, 3000);
    };

    const handleStopTyping = (data: { user_name: string; channel_id?: number }) => {
      if (data.channel_id !== channelId) return;
      setTypingUsers((prev) => prev.filter((u) => u.user_name !== data.user_name));
    };

    socket.on('user_typing', handleTyping);
    socket.on('user_stop_typing', handleStopTyping);

    return () => {
      socket.off('user_typing', handleTyping);
      socket.off('user_stop_typing', handleStopTyping);
      Object.values(timeoutRefs.current).forEach(clearTimeout);
    };
  }, [channelId]);

  return typingUsers;
};

export const useOnlineUsers = () => {
  const [onlineUsers, setOnlineUsers] = useState<number[]>([]);

  useEffect(() => {
    const socket = getSocket();
    const handler = (users: number[]) => setOnlineUsers(users);
    socket.on('online_users', handler);
    return () => { socket.off('online_users', handler); };
  }, []);

  return onlineUsers;
};

export const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

export const useClickOutside = (ref: React.RefObject<HTMLElement | null>, callback: () => void) => {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        callback();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, callback]);
};

export const useAutoScroll = (dependency: unknown) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scroll = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);
  useEffect(() => { scroll(); }, [dependency, scroll]);
  return scrollRef;
};
