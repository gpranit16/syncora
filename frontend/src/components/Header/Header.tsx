import React, { useState, useRef, useEffect } from 'react';
import { Search, Bell, X, Hash, Users, CheckSquare, MessageSquare, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useUnread } from '../../context/UnreadContext';
import { globalSearch, type SearchResults } from '../../api/search';
import { getNotifications, markNotificationRead, type Notification } from '../../api/notifications';
import { useDebounce, useClickOutside } from '../../hooks/useSocket';
import { formatDistanceToNow } from 'date-fns';
import './Header.css';

interface HeaderProps {
  onMenuClick?: () => void;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick }) => {
  const { user } = useAuth();
  const { unread } = useUnread();

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(searchQuery, 400);

  useClickOutside(searchRef, () => setSearchOpen(false));

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    globalSearch(debouncedQuery)
      .then(({ data }) => setSearchResults(data))
      .catch(console.error)
      .finally(() => setSearching(false));
  }, [debouncedQuery]);

  // Notifications
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);

  useClickOutside(notifRef, () => setNotifOpen(false));

  useEffect(() => {
    if (notifOpen) {
      getNotifications()
        .then(({ data }) => setNotifications(data.notifications))
        .catch(console.error);
    }
  }, [notifOpen]);

  const handleMarkRead = async (id: number) => {
    await markNotificationRead(id);
    setNotifications((prev) => prev.map((n) => n.notification_id === id ? { ...n, is_read: true } : n));
  };

  const totalSearchResults = searchResults
    ? searchResults.users.length + searchResults.messages.length + searchResults.tasks.length + searchResults.channels.length
    : 0;

  return (
    <header className="app-header">
      <div className="header-left">
        {onMenuClick && (
          <button className="btn-icon mobile-menu-btn" onClick={onMenuClick}>
            <Menu size={20} />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="header-search" ref={searchRef}>
        <div className={`search-trigger ${searchOpen ? 'active' : ''}`} onClick={() => setSearchOpen(true)}>
          <Search size={16} />
          <span>Search everything...</span>
          <kbd>⌘K</kbd>
        </div>

        {searchOpen && (
          <div className="search-panel">
            <div className="search-input-row">
              <Search size={16} />
              <input
                className="search-input"
                placeholder="Search users, messages, tasks, channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <button className="btn-icon" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}>
                <X size={16} />
              </button>
            </div>

            {searching && <div className="search-loading"><div className="skeleton" style={{ width: '100%', height: 20 }} /></div>}

            {searchResults && totalSearchResults > 0 && (
              <div className="search-results">
                {searchResults.users.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label"><Users size={14} /> Users</div>
                    {searchResults.users.slice(0, 5).map((u) => (
                      <div key={u.user_id} className="search-result-item">
                        <div className="avatar avatar-sm">{u.name[0]}</div>
                        <div><strong>{u.name}</strong><span className="search-meta">{u.email}</span></div>
                      </div>
                    ))}
                  </div>
                )}
                {searchResults.channels.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label"><Hash size={14} /> Channels</div>
                    {searchResults.channels.slice(0, 5).map((ch) => (
                      <div key={ch.channel_id} className="search-result-item">
                        <Hash size={16} />
                        <span>{ch.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {searchResults.messages.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label"><MessageSquare size={14} /> Messages</div>
                    {searchResults.messages.slice(0, 5).map((m) => (
                      <div key={m.message_id} className="search-result-item">
                        <MessageSquare size={14} />
                        <span className="search-msg-text">{m.message_text.slice(0, 80)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {searchResults.tasks.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label"><CheckSquare size={14} /> Tasks</div>
                    {searchResults.tasks.slice(0, 5).map((t) => (
                      <div key={t.task_id} className="search-result-item">
                        <CheckSquare size={14} />
                        <div><strong>{t.title}</strong><span className={`status-tag status-${t.status.replace('_', '-')}`}>{t.status}</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {searchResults && totalSearchResults === 0 && searchQuery && (
              <div className="search-empty">No results found for "{searchQuery}"</div>
            )}
          </div>
        )}
      </div>

      {/* Notifications Bell */}
      <div className="header-actions">
        <div className="notif-wrapper" ref={notifRef}>
          <button className="btn-icon notif-btn" onClick={() => setNotifOpen(!notifOpen)}>
            <Bell size={18} />
            {(unread?.notifications || 0) > 0 && (
              <span className="badge notif-badge">{unread?.notifications}</span>
            )}
          </button>

          {notifOpen && (
            <div className="notif-dropdown dropdown">
              <div className="notif-dropdown-header">
                <span className="label">NOTIFICATIONS</span>
              </div>
              {notifications.length === 0 && (
                <div className="notif-empty">No notifications</div>
              )}
              {notifications.map((n) => (
                <div
                  key={n.notification_id}
                  className={`notif-item ${n.is_read ? '' : 'unread'}`}
                  onClick={() => !n.is_read && handleMarkRead(n.notification_id)}
                >
                  <div className={`notif-type-dot ${n.type}`} />
                  <div className="notif-content">
                    <p className="notif-message">{n.message}</p>
                    <span className="notif-time">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {!n.is_read && <div className="notif-unread-dot" />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
