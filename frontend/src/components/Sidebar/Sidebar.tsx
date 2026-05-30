import React, { useState, useEffect } from 'react';
import { Hash, MessageSquare, ChevronDown, Plus, Users, Settings, LogOut, CheckSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useUnread } from '../../context/UnreadContext';
import { getChannels, createChannel, type Channel } from '../../api/channels';
import { addMemberToWorkspace } from '../../api/workspaces';
import './Sidebar.css';

interface SidebarProps {
  activeChannelId: number | null;
  onChannelSelect: (channel: Channel) => void;
  onDmSelect: () => void;
  onTasksSelect: () => void;
  activeView: 'channel' | 'dm' | 'tasks';
  initialChannelId?: number | null;
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeChannelId, onChannelSelect, onDmSelect, onTasksSelect, activeView, initialChannelId, isOpen, onClose }) => {
  const { user, logout } = useAuth();
  const { workspaces, activeWorkspace, setActiveWorkspace } = useWorkspace();
  const { unread } = useUnread();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showInviteMenu, setShowInviteMenu] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');

  useEffect(() => {
    if (activeWorkspace) {
      getChannels(activeWorkspace.workspace_id)
        .then(({ data }) => setChannels(data.channels))
        .catch(console.error);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    if (activeView !== 'channel') return;
    if (!initialChannelId || activeChannelId || channels.length === 0) return;
    const storedChannel = channels.find((ch) => ch.channel_id === initialChannelId);
    if (storedChannel) {
      onChannelSelect(storedChannel);
    }
  }, [initialChannelId, activeChannelId, channels, activeView, onChannelSelect]);

  const handleCreateChannel = async () => {
    if (!newChannelName.trim() || !activeWorkspace) return;
    try {
      await createChannel({ workspace_id: activeWorkspace.workspace_id, name: newChannelName.trim() });
      const { data } = await getChannels(activeWorkspace.workspace_id);
      setChannels(data.channels);
      setNewChannelName('');
      setShowCreateChannel(false);
    } catch (err) {
      console.error('Failed to create channel:', err);
    }
  };

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspace || !inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      await addMemberToWorkspace(activeWorkspace.workspace_id, inviteEmail.trim());
      setInviteSuccess('Member added!');
      setInviteEmail('');
      setTimeout(() => setShowInviteMenu(false), 2000);
    } catch (err: any) {
      setInviteError(err.response?.data?.message || 'Failed to add member');
    } finally {
      setInviteLoading(false);
    }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2);

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Workspace Header */}
        <div className="sidebar-header" onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}>
        <div className="workspace-icon">{activeWorkspace?.name?.[0] || 'N'}</div>
        <div className="workspace-info">
          <span className="workspace-name">{activeWorkspace?.name || 'Select Workspace'}</span>
          <span className="workspace-role">{activeWorkspace?.role || ''}</span>
        </div>
        <ChevronDown size={14} className={`chevron ${showWorkspaceMenu ? 'open' : ''}`} />
      </div>

      {showWorkspaceMenu && (
        <div className="workspace-dropdown">
          {workspaces.map((ws) => (
            <button
              key={ws.workspace_id}
              className={`dropdown-item ${ws.workspace_id === activeWorkspace?.workspace_id ? 'active' : ''}`}
              onClick={() => { setActiveWorkspace(ws); setShowWorkspaceMenu(false); }}
            >
              <div className="workspace-icon-sm">{ws.name[0]}</div>
              <span>{ws.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <div className="section-header">
            <span className="label">CHANNELS</span>
            <button className="btn-icon" onClick={() => setShowCreateChannel(true)} title="Create Channel">
              <Plus size={14} />
            </button>
          </div>

          {showCreateChannel && (
            <div className="create-channel-form">
              <input
                className="input"
                placeholder="channel-name"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateChannel()}
                autoFocus
              />
              <div className="create-channel-actions">
                <button className="btn btn-sm btn-primary" onClick={handleCreateChannel}>Create</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setShowCreateChannel(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="channel-list">
            {channels.map((ch) => {
              const unreadCount = unread?.per_channel_unread?.[ch.channel_id] || 0;
              return (
                <button
                  key={ch.channel_id}
                  className={`channel-item ${activeChannelId === ch.channel_id && activeView === 'channel' ? 'active' : ''}`}
                  onClick={() => onChannelSelect(ch)}
                >
                  <Hash size={16} />
                  <span className="channel-name">{ch.name}</span>
                  {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
                </button>
              );
            })}
            {channels.length === 0 && (
              <div className="empty-hint">No channels yet</div>
            )}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-header">
            <span className="label">DIRECT MESSAGES</span>
          </div>
          <button
            className={`channel-item ${activeView === 'dm' ? 'active' : ''}`}
            onClick={onDmSelect}
          >
            <MessageSquare size={16} />
            <span className="channel-name">Messages</span>
            {(unread?.dm_unread || 0) > 0 && <span className="badge">{unread?.dm_unread}</span>}
          </button>
        </div>

        <div className="sidebar-section">
          <div className="section-header">
            <span className="label">WORKSPACE</span>
          </div>
          <button
            className={`channel-item ${activeView === 'tasks' ? 'active' : ''}`}
            onClick={onTasksSelect}
          >
            <CheckSquare size={16} />
            <span className="channel-name">Tasks</span>
          </button>
        </div>

        {/* Persistent Invite Section */}
        {activeWorkspace?.role === 'owner' && (
          <div className="sidebar-section" style={{ padding: '0 var(--space-4) var(--space-4) var(--space-4)' }}>
            <div className="section-header">
              <span className="label">INVITE MEMBER</span>
            </div>
            <form onSubmit={handleInvite} style={{ display: 'flex', gap: 8, flexDirection: 'column', marginTop: 8 }}>
              <input 
                type="email" 
                className="input" 
                style={{ height: 32, fontSize: '0.75rem' }} 
                placeholder="user@example.com" 
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={inviteLoading || !inviteEmail}>
                {inviteLoading ? 'Adding...' : 'Add Member'}
              </button>
              {inviteError && <div style={{ color: 'var(--accent-danger)', fontSize: 10 }}>{inviteError}</div>}
              {inviteSuccess && <div style={{ color: 'var(--accent-success)', fontSize: 10 }}>{inviteSuccess}</div>}
            </form>
          </div>
        )}
      </nav>

      {/* User Footer */}
      <div className="sidebar-footer">
        <div className="user-info">
          <div className="avatar">{user ? getInitials(user.name) : '?'}</div>
          <div className="user-details">
            <span className="user-name">{user?.name}</span>
            <span className="user-status">
              <span className="status-dot status-online" />
              Online
            </span>
          </div>
        </div>
        <button className="btn-icon" onClick={logout} title="Logout">
          <LogOut size={16} />
        </button>
      </div>
    </aside>
    </>
  );
};

export default Sidebar;
