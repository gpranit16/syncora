import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  X,
  Zap,
  MessageSquare,
  MessageCircle,
  CheckSquare,
  Video,
  Bell,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { createWorkspace, getAvailableWorkspaces, joinWorkspace } from '../api/workspaces';
import { getChannels, type Channel } from '../api/channels';
import { getSocket, joinChannel } from '../socket/socketManager';
import { soundManager } from '../utils/soundManager';
import { browserNotification } from '../utils/browserNotification';
import Sidebar from '../components/Sidebar/Sidebar';
import Header from '../components/Header/Header';
import ChatView from '../components/ChatView/ChatView';
import DmView from '../components/DmView/DmView';
import TaskBoard from '../components/TaskBoard/TaskBoard';
import './Dashboard.css';

interface ToastNotification {
  id: string;
  title: string;
  message: string;
  type?: 'message' | 'dm' | 'task' | 'meeting' | 'info';
  actionLabel?: string;
  onAction?: () => void;
}

const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { activeWorkspace, workspaces, refreshWorkspaces, loading } = useWorkspace();
  const [activeView, setActiveView] = useState<'channel' | 'dm' | 'tasks'>('channel');
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [channelsList, setChannelsList] = useState<Channel[]>([]);
  const [preferredChannelId, setPreferredChannelId] = useState<number | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Workspace creation & joining
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsDesc, setWsDesc] = useState('');
  const [wsLoading, setWsLoading] = useState(false);
  const [dmTarget, setDmTarget] = useState<{ user_id: number; name: string } | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');

  // Notifications & Alerts
  const [notification, setNotification] = useState<ToastNotification | null>(null);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState<boolean>(() => {
    return browserNotification.isSupported() && browserNotification.getPermission() === 'default';
  });

  // Keep state refs synchronized for socket callbacks
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  const activeChannelRef = useRef(activeChannel);
  activeChannelRef.current = activeChannel;

  const dmTargetRef = useRef(dmTarget);
  dmTargetRef.current = dmTarget;

  const channelsListRef = useRef(channelsList);
  channelsListRef.current = channelsList;

  const userRef = useRef(user);
  userRef.current = user;

  // Fetch public workspaces if none joined
  useEffect(() => {
    if (!activeWorkspace && workspaces.length === 0) {
      getAvailableWorkspaces()
        .then(({ data }) => {
          if (data.success) setAvailableWorkspaces(data.workspaces);
        })
        .catch(console.error);
    }
  }, [activeWorkspace, workspaces.length]);

  // Restore active view & target from localStorage
  useEffect(() => {
    const storedView = localStorage.getItem('activeView');
    const storedChannelId = localStorage.getItem('activeChannelId');
    const storedDmTarget = localStorage.getItem('dmTarget');
    if (storedView === 'channel' || storedView === 'dm' || storedView === 'tasks') {
      setActiveView(storedView);
    }
    if (storedChannelId) {
      setPreferredChannelId(Number(storedChannelId));
    }
    if (storedDmTarget) {
      try {
        const parsed = JSON.parse(storedDmTarget);
        if (parsed?.user_id && parsed?.name) {
          setDmTarget(parsed);
        }
      } catch (e) {
        console.warn('Failed to parse dmTarget from storage');
      }
    }
  }, []);

  // Handle Google Calendar OAuth redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('calendar_connected');
    if (status === 'success') {
      const email = params.get('email');
      setNotification({
        id: String(Date.now()),
        title: 'Google Calendar Connected',
        message: email ? `Successfully synced with ${email}. Deadlines & meetings will now appear in your calendar!` : 'Google Calendar connected successfully!',
        type: 'info',
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (status === 'error') {
      const msg = params.get('message') || 'Could not connect Google Calendar';
      setNotification({
        id: String(Date.now()),
        title: 'Calendar Connection Failed',
        message: msg,
        type: 'info',
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Fetch workspace channels & automatically join all channel rooms for real-time alerts
  useEffect(() => {
    if (activeWorkspace) {
      getChannels(activeWorkspace.workspace_id)
        .then(({ data }) => {
          if (data.success && data.channels) {
            setChannelsList(data.channels);
            // Join socket rooms for all channels in this workspace
            data.channels.forEach((ch) => {
              joinChannel(ch.channel_id);
            });
          }
        })
        .catch(console.error);
    }
  }, [activeWorkspace]);

  // Handle channel selection
  const handleChannelSelect = useCallback((channel: Channel) => {
    setActiveChannel(channel);
    setActiveView('channel');
    setPreferredChannelId(channel.channel_id);
    localStorage.setItem('activeView', 'channel');
    localStorage.setItem('activeChannelId', String(channel.channel_id));
    setIsMobileSidebarOpen(false);
  }, []);

  // Handle DM selection
  const handleDmSelect = useCallback((userId?: number, userName?: string) => {
    if (userId && userName) {
      const target = { user_id: userId, name: userName };
      setDmTarget(target);
      localStorage.setItem('dmTarget', JSON.stringify(target));
    } else {
      setDmTarget(null);
      localStorage.removeItem('dmTarget');
    }
    setActiveView('dm');
    localStorage.setItem('activeView', 'dm');
    setActiveChannel(null);
    setIsMobileSidebarOpen(false);
  }, []);

  // Handle tasks view selection
  const handleTasksSelect = useCallback(() => {
    setActiveView('tasks');
    localStorage.setItem('activeView', 'tasks');
    setActiveChannel(null);
    setIsMobileSidebarOpen(false);
  }, []);

  // --------------------------------------------------------------------------
  // Real-time Global Socket Event Listeners for Notifications & Sounds
  // --------------------------------------------------------------------------
  useEffect(() => {
    const socket = getSocket();

    // 1. Channel Messages
    const onReceiveMessage = (msg: any) => {
      const currentUser = userRef.current;
      if (currentUser && msg.sender_id === currentUser.user_id) {
        return; // Ignore self-sent messages
      }

      const currentView = activeViewRef.current;
      const currentChannel = activeChannelRef.current;
      const isBackgrounded = browserNotification.isBackgrounded();
      const isViewingActiveChannel =
        currentView === 'channel' && currentChannel?.channel_id === msg.channel_id;

      // If user is not viewing this channel or tab is in background
      if (!isViewingActiveChannel || isBackgrounded) {
        soundManager.playMessageSound();

        const channelObj = channelsListRef.current.find((c) => c.channel_id === msg.channel_id);
        const channelName = channelObj?.name || `channel-${msg.channel_id}`;
        const previewText =
          msg.message_text || (msg.file_url ? 'Sent an attachment' : 'New message');

        browserNotification.showNotification({
          title: `#${channelName} • ${msg.sender_name}`,
          body: previewText,
          tag: `channel-${msg.channel_id}`,
          onClick: () => {
            if (channelObj) {
              handleChannelSelect(channelObj);
            }
          },
        });

        if (isBackgrounded) {
          browserNotification.flashTabTitle(`💬 #${channelName} (${msg.sender_name})`);
        }

        if (!isViewingActiveChannel) {
          setNotification({
            id: `msg-${Date.now()}`,
            title: `#${channelName}`,
            message: `${msg.sender_name}: ${previewText.length > 50 ? previewText.substring(0, 50) + '...' : previewText}`,
            type: 'message',
            actionLabel: 'View Channel',
            onAction: () => {
              if (channelObj) {
                handleChannelSelect(channelObj);
              }
              setNotification(null);
            },
          });

          setTimeout(() => {
            setNotification((prev) => (prev?.title === `#${channelName}` ? null : prev));
          }, 6000);
        }
      }
    };

    // 2. Direct Messages (DM)
    const onReceiveDm = (msg: any) => {
      const currentUser = userRef.current;
      if (
        msg.message_type === 'call' ||
        msg.call_type ||
        (currentUser && msg.sender_id === currentUser.user_id)
      ) {
        return;
      }

      const currentView = activeViewRef.current;
      const currentDmTarget = dmTargetRef.current;
      const isBackgrounded = browserNotification.isBackgrounded();
      const isViewingActiveDm =
        currentView === 'dm' && currentDmTarget?.user_id === msg.sender_id;

      if (!isViewingActiveDm || isBackgrounded) {
        soundManager.playDmSound();

        const previewText =
          msg.message_text || (msg.file_url ? 'Sent an attachment' : 'New direct message');

        browserNotification.showNotification({
          title: `💬 DM from ${msg.sender_name}`,
          body: previewText,
          tag: `dm-${msg.sender_id}`,
          onClick: () => {
            handleDmSelect(msg.sender_id, msg.sender_name);
          },
        });

        if (isBackgrounded) {
          browserNotification.flashTabTitle(`💬 DM from ${msg.sender_name}`);
        }

        if (!isViewingActiveDm) {
          setNotification({
            id: `dm-${Date.now()}`,
            title: `DM from ${msg.sender_name}`,
            message:
              previewText.length > 50 ? previewText.substring(0, 50) + '...' : previewText,
            type: 'dm',
            actionLabel: 'Reply',
            onAction: () => {
              handleDmSelect(msg.sender_id, msg.sender_name);
              setNotification(null);
            },
          });

          setTimeout(() => {
            setNotification((prev) =>
              prev?.title === `DM from ${msg.sender_name}` ? null : prev
            );
          }, 6000);
        }
      }
    };

    // 3. Task Assignment
    const onTaskAssigned = (data: {
      task_title: string;
      workspace_name: string;
      assigned_by: string;
      assigned_to?: number;
    }) => {
      const currentUser = userRef.current;
      if (currentUser && data.assigned_to && data.assigned_to !== currentUser.user_id) {
        return;
      }

      soundManager.playTaskSound();

      browserNotification.showNotification({
        title: `📋 Task Assigned: ${data.task_title}`,
        body: `${data.assigned_by} assigned you a task in ${data.workspace_name}`,
        tag: `task-${Date.now()}`,
        onClick: () => {
          handleTasksSelect();
        },
      });

      if (browserNotification.isBackgrounded()) {
        browserNotification.flashTabTitle(`📋 Task Assigned: ${data.task_title}`);
      }

      setNotification({
        id: `task-${Date.now()}`,
        title: 'New Task Assigned',
        message: `${data.assigned_by} assigned you "${data.task_title}" in ${data.workspace_name}`,
        type: 'task',
        actionLabel: 'View Tasks',
        onAction: () => {
          handleTasksSelect();
          setNotification(null);
        },
      });

      setTimeout(() => {
        setNotification((prev) => (prev?.title === 'New Task Assigned' ? null : prev));
      }, 7000);
    };

    // 4. Meeting Started in Channel
    const onMeetingStarted = (data: {
      meeting_code: string;
      channel_id: number;
      channel_name?: string;
      host_name?: string;
    }) => {
      soundManager.playMeetingSound();

      const channelObj = channelsListRef.current.find((c) => c.channel_id === data.channel_id);
      const chName = data.channel_name || channelObj?.name || 'channel';

      browserNotification.showNotification({
        title: `🎥 Meeting Started in #${chName}`,
        body: `${data.host_name || 'A team member'} started a live meeting. Click to join.`,
        tag: `meeting-${data.meeting_code}`,
        onClick: () => {
          if (channelObj) {
            handleChannelSelect(channelObj);
          }
        },
      });

      if (browserNotification.isBackgrounded()) {
        browserNotification.flashTabTitle(`🎥 Meeting in #${chName}`);
      }

      setNotification({
        id: `meet-${Date.now()}`,
        title: `Meeting in #${chName}`,
        message: `${data.host_name || 'A team member'} started a live meeting in #${chName}`,
        type: 'meeting',
        actionLabel: 'Join Meeting',
        onAction: () => {
          if (channelObj) {
            handleChannelSelect(channelObj);
          }
          setNotification(null);
        },
      });

      setTimeout(() => {
        setNotification((prev) => (prev?.title.startsWith('Meeting in') ? null : prev));
      }, 8000);
    };

    // 5. General Notifications
    const onReceiveNotification = (data: any) => {
      soundManager.playNotificationSound();

      const title = data.title || 'Notification';
      const body = data.message || data.text || 'You have a new update.';

      browserNotification.showNotification({
        title,
        body,
        tag: `notif-${Date.now()}`,
      });

      setNotification({
        id: `gen-${Date.now()}`,
        title,
        message: body,
        type: 'info',
      });

      setTimeout(() => setNotification(null), 5000);
    };

    socket.on('receive_message', onReceiveMessage);
    socket.on('receive_dm', onReceiveDm);
    socket.on('task_assigned', onTaskAssigned);
    socket.on('meeting_channel_started', onMeetingStarted);
    socket.on('receive_notification', onReceiveNotification);

    return () => {
      socket.off('receive_message', onReceiveMessage);
      socket.off('receive_dm', onReceiveDm);
      socket.off('task_assigned', onTaskAssigned);
      socket.off('meeting_channel_started', onMeetingStarted);
      socket.off('receive_notification', onReceiveNotification);
    };
  }, [handleChannelSelect, handleDmSelect, handleTasksSelect]);

  const handleRequestPermission = async () => {
    const res = await browserNotification.requestPermission();
    setShowPermissionPrompt(false);
    if (res === 'granted') {
      soundManager.playNotificationSound();
      browserNotification.showNotification({
        title: 'Syncora Notifications Enabled',
        body: 'You will now receive sound and desktop alerts for calls, messages, and tasks.',
      });
    }
  };

  const handleCreateWorkspace = async () => {
    if (!wsName.trim()) return;
    setWsLoading(true);
    try {
      await createWorkspace({ name: wsName.trim(), description: wsDesc.trim() || undefined });
      await refreshWorkspaces();
      setShowCreateWs(false);
      setWsName('');
      setWsDesc('');
    } catch (err) {
      console.error('Create workspace failed:', err);
    } finally {
      setWsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="onboarding-page">
        <div className="auth-ambient" />
        <div className="onboarding-container">
          <h1>Loading workspace...</h1>
          <p className="onboarding-desc">Just a moment, fetching your data.</p>
        </div>
      </div>
    );
  }

  // No workspace — show onboarding
  if (!activeWorkspace && workspaces.length === 0) {
    return (
      <div className="onboarding-page">
        <div className="auth-ambient" />
        <div className="onboarding-container">
          <div className="auth-logo">
            <Zap size={28} />
          </div>
          <h1>Welcome to Syncora</h1>
          <p className="onboarding-desc">
            Create your first workspace to start collaborating with your team.
          </p>
          <div
            className="onboarding-tabs"
            style={{ display: 'flex', gap: 16, marginBottom: 24, justifyContent: 'center' }}
          >
            <button
              className={`btn ${activeTab === 'create' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveTab('create')}
            >
              Create New
            </button>
            <button
              className={`btn ${activeTab === 'join' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveTab('join')}
            >
              Join Existing
            </button>
          </div>

          <div className="onboarding-form">
            {activeTab === 'create' ? (
              <>
                <div className="form-group">
                  <label>Workspace Name</label>
                  <input
                    className="input"
                    placeholder="e.g. Engineering Team"
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginTop: 16 }}>
                  <label>Description (optional)</label>
                  <input
                    className="input"
                    placeholder="What's this workspace for?"
                    value={wsDesc}
                    onChange={(e) => setWsDesc(e.target.value)}
                  />
                </div>
                <button
                  className="btn btn-lg btn-primary"
                  style={{ width: '100%', marginTop: 24 }}
                  onClick={handleCreateWorkspace}
                  disabled={wsLoading || !wsName.trim()}
                >
                  <Plus size={18} /> {wsLoading ? 'Creating...' : 'Create Workspace'}
                </button>
              </>
            ) : (
              <div
                className="join-workspace-list"
                style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                {availableWorkspaces.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
                    No public workspaces available to join.
                  </p>
                ) : (
                  availableWorkspaces.map((ws) => (
                    <div
                      key={ws.workspace_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: 12,
                        background: 'var(--bg-elevated)',
                        borderRadius: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{ws.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Owned by {ws.owner_name}
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={async () => {
                          setWsLoading(true);
                          try {
                            await joinWorkspace(ws.workspace_id);
                            await refreshWorkspaces();
                          } catch (e) {
                            console.error(e);
                          } finally {
                            setWsLoading(false);
                          }
                        }}
                        disabled={wsLoading}
                      >
                        Join
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const handleChannelDeleted = () => {
    setActiveChannel(null);
    localStorage.removeItem('activeChannelId');
  };

  const getToastIcon = (type?: string) => {
    switch (type) {
      case 'message':
        return <MessageSquare size={18} color="#6366f1" />;
      case 'dm':
        return <MessageCircle size={18} color="#06b6d4" />;
      case 'task':
        return <CheckSquare size={18} color="#10b981" />;
      case 'meeting':
        return <Video size={18} color="#f59e0b" />;
      default:
        return <Bell size={18} color="#8b5cf6" />;
    }
  };

  return (
    <div className="dashboard">
      {/* Desktop Notification Permission Banner */}
      {showPermissionPrompt && (
        <div className="notif-permission-banner">
          <div className="banner-icon">
            <Bell size={18} />
          </div>
          <span>Enable notifications & sound alerts for calls, messages, and tasks.</span>
          <button
            className="btn btn-xs btn-primary"
            onClick={handleRequestPermission}
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          >
            Enable
          </button>
          <button
            className="btn-icon"
            onClick={() => setShowPermissionPrompt(false)}
            style={{ padding: 2, height: 20, width: 20 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <Sidebar
        activeChannelId={activeChannel?.channel_id || null}
        onChannelSelect={handleChannelSelect}
        onDmSelect={() => {
          setActiveView('dm');
          localStorage.setItem('activeView', 'dm');
        }}
        onTasksSelect={() => {
          setActiveView('tasks');
          localStorage.setItem('activeView', 'tasks');
        }}
        activeView={activeView}
        initialChannelId={preferredChannelId}
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="dashboard-main">
        <Header onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <div className="dashboard-content">
          {activeView === 'channel' && activeChannel && (
            <ChatView
              channel={activeChannel}
              onDmSelect={handleDmSelect}
              onChannelDeleted={handleChannelDeleted}
            />
          )}
          {activeView === 'channel' && !activeChannel && (
            <div className="welcome-panel">
              <div className="welcome-inner">
                <Zap size={48} className="welcome-icon" />
                <h2>Welcome to {activeWorkspace?.name}</h2>
                <p>Select a channel from the sidebar to start messaging, or create a new one.</p>
                <div className="welcome-stats">
                  <div className="welcome-stat">
                    <span className="welcome-stat-label">Role</span>
                    <span className="welcome-stat-value">{activeWorkspace?.role}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeView === 'dm' && <DmView initialTargetUser={dmTarget} />}
          {activeView === 'tasks' && <TaskBoard />}
        </div>
      </div>

      {/* Create Workspace Modal */}
      {showCreateWs && (
        <div className="modal-overlay" onClick={() => setShowCreateWs(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Workspace</h3>
              <button className="btn-icon" onClick={() => setShowCreateWs(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="form-group">
              <label>Name</label>
              <input
                className="input"
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                placeholder="Workspace name"
              />
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Description</label>
              <input
                className="input"
                value={wsDesc}
                onChange={(e) => setWsDesc(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-md btn-ghost" onClick={() => setShowCreateWs(false)}>
                Cancel
              </button>
              <button
                className="btn btn-md btn-primary"
                onClick={handleCreateWorkspace}
                disabled={wsLoading}
              >
                {wsLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Rich Notification Toast */}
      {notification && (
        <div className={`dashboard-toast toast-${notification.type || 'info'}`}>
          <div className="dashboard-toast-icon">{getToastIcon(notification.type)}</div>
          <div className="dashboard-toast-content">
            <div className="dashboard-toast-header">
              <h4 className="dashboard-toast-title">{notification.title}</h4>
              <button
                className="btn-icon"
                onClick={() => setNotification(null)}
                style={{ padding: 2, height: 20, width: 20 }}
              >
                <X size={14} />
              </button>
            </div>
            <p className="dashboard-toast-message">{notification.message}</p>
            {notification.actionLabel && notification.onAction && (
              <div className="dashboard-toast-action">
                <button
                  className="btn btn-xs btn-primary"
                  onClick={notification.onAction}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: '0.75rem' }}
                >
                  <span>{notification.actionLabel}</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
