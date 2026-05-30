import React, { useState, useEffect } from 'react';
import { Plus, X, Zap } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { createWorkspace, getAvailableWorkspaces, joinWorkspace } from '../api/workspaces';
import { getSocket } from '../socket/socketManager';
import Sidebar from '../components/Sidebar/Sidebar';
import Header from '../components/Header/Header';
import ChatView from '../components/ChatView/ChatView';
import DmView from '../components/DmView/DmView';
import TaskBoard from '../components/TaskBoard/TaskBoard';
import type { Channel } from '../api/channels';
import './Dashboard.css';

const DashboardPage: React.FC = () => {
  const { activeWorkspace, workspaces, refreshWorkspaces } = useWorkspace();
  const [activeView, setActiveView] = useState<'channel' | 'dm' | 'tasks'>('channel');
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [preferredChannelId, setPreferredChannelId] = useState<number | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Workspace creation
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsDesc, setWsDesc] = useState('');
  const [wsLoading, setWsLoading] = useState(false);
  const [dmTarget, setDmTarget] = useState<{ user_id: number; name: string } | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const [notification, setNotification] = useState<{ title: string; message: string } | null>(null);

  React.useEffect(() => {
    if (!activeWorkspace && workspaces.length === 0) {
      getAvailableWorkspaces().then(({ data }) => {
        if (data.success) setAvailableWorkspaces(data.workspaces);
      }).catch(console.error);
    }
  }, [activeWorkspace, workspaces.length]);

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

  useEffect(() => {
    const socket = getSocket();
    const onTaskAssigned = (data: { task_title: string; workspace_name: string; assigned_by: string }) => {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      } catch (e) {
        console.log("AudioContext not supported");
      }

      setNotification({
        title: 'New Task Assigned',
        message: `${data.assigned_by} assigned you "${data.task_title}" in ${data.workspace_name}`,
      });

      setTimeout(() => {
        setNotification(null);
      }, 5000);
    };

    const onReceiveDm = (msg: any) => {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      } catch (e) {
        console.log("AudioContext error", e);
      }

      setNotification({
        title: `New DM from ${msg.sender_name}`,
        message: msg.message_text.length > 40 ? msg.message_text.substring(0, 40) + '...' : msg.message_text,
      });

      setTimeout(() => setNotification(null), 5000);
    };

    socket.on('task_assigned', onTaskAssigned);
    socket.on('receive_dm', onReceiveDm);
    return () => {
      socket.off('task_assigned', onTaskAssigned);
      socket.off('receive_dm', onReceiveDm);
    };
  }, []);

  const handleChannelSelect = (channel: Channel) => {
    setActiveChannel(channel);
    setActiveView('channel');
    setPreferredChannelId(channel.channel_id);
    localStorage.setItem('activeView', 'channel');
    localStorage.setItem('activeChannelId', String(channel.channel_id));
    setIsMobileSidebarOpen(false);
  };

  const handleDmSelect = (userId?: number, userName?: string) => {
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
  };

  const handleTasksSelect = () => {
    setActiveView('tasks');
    localStorage.setItem('activeView', 'tasks');
    setActiveChannel(null);
    setIsMobileSidebarOpen(false);
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

  // No workspace — show onboarding
  if (!activeWorkspace && workspaces.length === 0) {
    return (
      <div className="onboarding-page">
        <div className="auth-ambient" />
        <div className="onboarding-container">
          <div className="auth-logo">
            <Zap size={28} />
          </div>
          <h1>Welcome to NexusHub</h1>
          <p className="onboarding-desc">
            Create your first workspace to start collaborating with your team.
          </p>
          <div className="onboarding-tabs" style={{ display: 'flex', gap: 16, marginBottom: 24, justifyContent: 'center' }}>
            <button className={`btn ${activeTab === 'create' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('create')}>Create New</button>
            <button className={`btn ${activeTab === 'join' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('join')}>Join Existing</button>
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
              <div className="join-workspace-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {availableWorkspaces.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>No public workspaces available to join.</p>
                ) : (
                  availableWorkspaces.map(ws => (
                    <div key={ws.workspace_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{ws.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Owned by {ws.owner_name}</div>
                      </div>
                      <button 
                        className="btn btn-sm btn-primary" 
                        onClick={async () => {
                          setWsLoading(true);
                          try {
                            await joinWorkspace(ws.workspace_id);
                            await refreshWorkspaces();
                          } catch (e) { console.error(e); }
                          finally { setWsLoading(false); }
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

  return (
    <div className="dashboard">
      <Sidebar
        activeChannelId={activeChannel?.channel_id || null}
        onChannelSelect={handleChannelSelect}
        onDmSelect={handleDmSelect}
        onTasksSelect={handleTasksSelect}
        activeView={activeView}
        initialChannelId={preferredChannelId}
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="dashboard-main">
        <Header onMenuClick={() => setIsMobileSidebarOpen(true)} />
        <div className="dashboard-content">
          {activeView === 'channel' && activeChannel && (
            <ChatView channel={activeChannel} onDmSelect={handleDmSelect} />
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
              <button className="btn-icon" onClick={() => setShowCreateWs(false)}><X size={18} /></button>
            </div>
            <div className="form-group">
              <label>Name</label>
              <input className="input" value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Workspace name" />
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Description</label>
              <input className="input" value={wsDesc} onChange={(e) => setWsDesc(e.target.value)} placeholder="Optional description" />
            </div>
            <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-md btn-ghost" onClick={() => setShowCreateWs(false)}>Cancel</button>
              <button className="btn btn-md btn-primary" onClick={handleCreateWorkspace} disabled={wsLoading}>
                {wsLoading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '16px',
          boxShadow: 'var(--shadow-xl)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          animation: 'slideIn 0.3s ease-out'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '24px' }}>
            <h4 style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{notification.title}</h4>
            <button className="btn-icon" onClick={() => setNotification(null)} style={{ padding: 2, height: 20, width: 20 }}>
              <X size={14} />
            </button>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{notification.message}</p>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
