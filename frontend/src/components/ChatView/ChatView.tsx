import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Send, Paperclip, Edit3, Trash2, Reply, X, Users, Pin, CheckSquare, Video, Mic, PhoneOff, Radio, Sparkles, FileText, Bot, Crown, Shield, ShieldCheck, ShieldAlert, UserMinus, Ban, Unlock, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { getWorkspaceMembers, getBannedMembers, updateMemberRole, removeMember, banMember, unbanMember, type WorkspaceMember, type BannedMember } from '../../api/workspaces';
import { getMessages, sendMessage as sendMsgApi, editMessage as editMsgApi, deleteMessage as deleteMsgApi, toggleMessageReaction, removeMessageReaction, toggleMessagePin, type Message } from '../../api/messages';
import { uploadFile } from '../../api/files';
import { API_BASE } from '../../api/client';
import { getSocket } from '../../socket/socketManager';
import { joinChannel, emitSendMessage, emitMessageEdited, emitMessageDeleted, emitTyping, emitStopTyping, emitMarkChannelRead, emitReactionAdded, emitReactionRemoved, emitMessagePinned, emitMessageUnpinned } from '../../socket/socketManager';
import { useTypingIndicator, useAutoScroll } from '../../hooks/useSocket';
import MessageReactions from '../MessageReactions/MessageReactions';
import PinnedMessagesPanel from '../PinnedMessagesPanel/PinnedMessagesPanel';
import AIAssistantPanel from '../AIAssistantPanel/AIAssistantPanel';
import CreateTaskFromMessageModal, { type SourceMessage } from '../CreateTaskFromMessageModal/CreateTaskFromMessageModal';
import { StartMeetingModal } from '../Meetings/StartMeetingModal';
import { MeetingAIModal } from '../Meetings/MeetingAIModal';
import { getActiveMeetingByChannel, endMeeting, Meeting } from '../../api/meetings';
import { deleteChannel, type Channel } from '../../api/channels';
import { applyReactionDelta } from '../../utils/reactions';
import { formatMessageTimestamp } from '../../utils/date';
import { getAvatarUrl } from '../../utils/avatar';
import { soundManager } from '../../utils/soundManager';
import './ChatView.css';

interface ChatViewProps {
  channel: Channel;
  onDmSelect: (userId: number, userName: string) => void;
  onChannelDeleted?: (channelId: number) => void;
}

const ChatView: React.FC<ChatViewProps> = ({ channel, onDmSelect, onChannelDeleted }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showPinned, setShowPinned] = useState(false);
  const [showStartMeeting, setShowStartMeeting] = useState(false);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [selectedMeetingAI, setSelectedMeetingAI] = useState<{
    isOpen: boolean;
    meetingCode: string;
    meetingTitle?: string;
    initialTab: 'summary' | 'transcript';
  } | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [bannedMembers, setBannedMembers] = useState<BannedMember[]>([]);
  const [activeMemberTab, setActiveMemberTab] = useState<'members' | 'banned'>('members');
  const [confirmModal, setConfirmModal] = useState<{
    type: 'promote' | 'demote' | 'remove' | 'ban' | 'unban' | 'deleteChannel';
    targetUser?: any;
  } | null>(null);
  const [banReason, setBanReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const typingUsers = useTypingIndicator(channel.channel_id);
  const scrollRef = useAutoScroll(messages);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [createTaskMsg, setCreateTaskMsg] = useState<SourceMessage | null>(null);

  const fetchMembersAndBanned = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const res = await getWorkspaceMembers(activeWorkspace.workspace_id);
      if (res.data.success) {
        setMembers(res.data.members);
      }
      if (['owner', 'admin'].includes(activeWorkspace.role)) {
        const banRes = await getBannedMembers(activeWorkspace.workspace_id);
        if (banRes.data.success) {
          setBannedMembers(banRes.data.banned_members);
        }
      }
    } catch (err) {
      console.error('Failed to load workspace members/banned:', err);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    fetchMembersAndBanned();
  }, [fetchMembersAndBanned]);

  // Fetch active meeting for current channel on channel change
  useEffect(() => {
    getActiveMeetingByChannel(channel.channel_id)
      .then((m) => setActiveMeeting(m))
      .catch(() => setActiveMeeting(null));
  }, [channel.channel_id]);

  // Realtime channel meeting socket listeners
  useEffect(() => {
    const socket = getSocket();

    const handleChannelMeetingStarted = (data: any) => {
      if (data && Number(data.channel_id) === Number(channel.channel_id)) {
        setActiveMeeting({
          meeting_id: data.meeting_id || data.meetingId,
          meeting_code: data.meeting_code || data.meetingCode,
          workspace_id: activeWorkspace?.workspace_id || channel.workspace_id,
          channel_id: Number(channel.channel_id),
          host_id: Number(data.host_id || data.hostId),
          host_name: data.host_name,
          title: data.title,
          mode: data.mode || data.meeting_type || 'video',
          status: 'active',
          created_at: data.created_at || new Date().toISOString(),
        });
      }
    };

    const handleChannelMeetingEnded = (data: any) => {
      if (data && Number(data.channel_id) === Number(channel.channel_id)) {
        setActiveMeeting(null);
      }
    };

    socket.on('meeting_channel_started', handleChannelMeetingStarted);
    socket.on('meeting_channel_ended', handleChannelMeetingEnded);

    return () => {
      socket.off('meeting_channel_started', handleChannelMeetingStarted);
      socket.off('meeting_channel_ended', handleChannelMeetingEnded);
    };
  }, [channel.channel_id, activeWorkspace?.workspace_id, channel.workspace_id]);

  const handleEndMeeting = async () => {
    if (!activeMeeting) return;
    try {
      await endMeeting(activeMeeting.meeting_id || activeMeeting.meeting_code);
      setActiveMeeting(null);
    } catch (err) {
      console.error('Failed to end meeting:', err);
    }
  };

  useEffect(() => {
    joinChannel(channel.channel_id);
    getMessages(channel.channel_id)
      .then(({ data }) => setMessages(data.messages))
      .catch(console.error);
    if (user) emitMarkChannelRead(channel.channel_id, user.user_id);
    if (activeWorkspace) {
      getWorkspaceMembers(activeWorkspace.workspace_id)
        .then(({ data }) => setMembers(data.members))
        .catch(console.error);
    }
  }, [channel.channel_id, user, activeWorkspace]);

  const playSound = useCallback((type: 'send' | 'receive') => {
    if (type === 'send') {
      soundManager.playSendSound();
    } else {
      soundManager.playMessageSound();
    }
  }, []);

  useEffect(() => {
    const socket = getSocket();
    
    const onConnect = () => {
      joinChannel(channel.channel_id);
      // Re-sync messages (including reactions) after a disconnect/reconnect
      getMessages(channel.channel_id)
        .then(({ data }) => setMessages(data.messages))
        .catch(console.error);
    };

    const onReceive = (msg: Message) => {
      if (msg.channel_id === channel.channel_id) {
        setMessages((prev) => {
          if (prev.some(m => m.message_id === msg.message_id)) return prev;
          return [...prev, msg];
        });
        if (msg.sender_id !== user?.user_id) {
          playSound('receive');
        }
        if (user) emitMarkChannelRead(channel.channel_id, user.user_id);
      }
    };
    const onEdited = (data: { message_id: number; channel_id: number; message_text: string; is_edited: boolean }) => {
      if (data.channel_id === channel.channel_id) {
        setMessages((prev) => prev.map((m) => m.message_id === data.message_id ? { ...m, message_text: data.message_text, is_edited: true } : m));
      }
    };
    const onDeleted = (data: { message_id: number; channel_id: number }) => {
      if (data.channel_id === channel.channel_id) {
        setMessages((prev) => prev.map((m) => m.message_id === data.message_id ? { ...m, message_text: '[deleted]', is_deleted: true } : m));
      }
    };

    const onReactionAdded = (data: { message_id: number; channel_id: number; emoji: string; user_id: number }) => {
      if (data.channel_id !== channel.channel_id) return;
      if (data.user_id === user?.user_id) return; // own toggle already applied optimistically
      setMessages((prev) => prev.map((m) => m.message_id === data.message_id ? applyReactionDelta(m, data, true) : m));
    };

    const onReactionRemoved = (data: { message_id: number; channel_id: number; emoji: string; user_id: number }) => {
      if (data.channel_id !== channel.channel_id) return;
      if (data.user_id === user?.user_id) return;
      setMessages((prev) => prev.map((m) => m.message_id === data.message_id ? applyReactionDelta(m, data, false) : m));
    };

    const onPinned = (data: { message_id: number; channel_id: number; is_pinned: boolean }) => {
      if (data.channel_id !== channel.channel_id) return;
      setMessages((prev) => prev.map((m) => m.message_id === data.message_id ? { ...m, is_pinned: data.is_pinned } : m));
    };

    const onUnpinned = (data: { message_id: number; channel_id: number }) => {
      if (data.channel_id !== channel.channel_id) return;
      setMessages((prev) => prev.map((m) => m.message_id === data.message_id ? { ...m, is_pinned: false } : m));
    };

    socket.on('connect', onConnect);
    socket.on('receive_message', onReceive);
    socket.on('message_edited', onEdited);
    socket.on('message_deleted', onDeleted);
    socket.on('reaction_added', onReactionAdded);
    socket.on('reaction_removed', onReactionRemoved);
    socket.on('message_pinned', onPinned);
    socket.on('message_unpinned', onUnpinned);
    return () => {
      socket.off('connect', onConnect);
      socket.off('receive_message', onReceive);
      socket.off('message_edited', onEdited);
      socket.off('message_deleted', onDeleted);
      socket.off('reaction_added', onReactionAdded);
      socket.off('reaction_removed', onReactionRemoved);
      socket.off('message_pinned', onPinned);
      socket.off('message_unpinned', onUnpinned);
    };
  }, [channel.channel_id, user]);

  const handleSend = async () => {
    if (isSending || (!input.trim() && !selectedFile) || !user) return;
    
    const textToSend = input.trim();
    const currentReplyTo = replyTo;
    const currentFile = selectedFile;

    setIsSending(true);
    setInput('');
    setReplyTo(null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    emitStopTyping({ user_name: user.name, channel_id: channel.channel_id });

    let fileUrl = null;
    let fileName = null;

    if (currentFile) {
      setIsUploading(true);
      try {
        const { data: uploadData } = await uploadFile(currentFile);
        if (uploadData.success && uploadData.file) {
          const uploadBase = API_BASE || '';
          fileUrl = `${uploadBase}/uploads/${uploadData.file.filename}`;
          fileName = uploadData.file.filename;
        }
      } catch (err) {
        console.error('File upload failed', err);
      } finally {
        setIsUploading(false);
      }
    }

    try {
      const { data } = await sendMsgApi({
        channel_id: channel.channel_id,
        message_text: textToSend,
        reply_to: currentReplyTo?.message_id || null,
        file_url: fileUrl,
        file_name: fileName
      });
      const msgData = {
        message_id: data.data.message_id,
        channel_id: channel.channel_id,
        sender_id: user.user_id,
        sender_name: user.name,
        message_text: textToSend,
        reply_to: currentReplyTo?.message_id || null,
        file_url: fileUrl,
        file_name: fileName,
        created_at: data.data.created_at || new Date().toISOString(),
      };
      emitSendMessage(msgData);
      playSound('send');
    } catch (err) {
      console.error('Send failed:', err);
      // Restore drafted message on failure
      setInput(textToSend);
      if (currentReplyTo) setReplyTo(currentReplyTo);
    } finally {
      setIsSending(false);
    }
  };

  const handleEdit = async (msgId: number) => {
    if (!editText.trim()) return;
    try {
      await editMsgApi(msgId, { message_text: editText.trim() });
      emitMessageEdited({ message_id: msgId, channel_id: channel.channel_id, message_text: editText.trim(), is_edited: true });
      setEditingId(null);
      setEditText('');
    } catch (err) {
      console.error('Edit failed:', err);
    }
  };

  const handleDelete = async (msgId: number) => {
    try {
      await deleteMsgApi(msgId);
      emitMessageDeleted({ message_id: msgId, channel_id: channel.channel_id, is_deleted: true });
      setMenuOpenId(null);
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const handleTogglePin = async (messageId: number) => {
    if (!user) return;
    try {
      const { data } = await toggleMessagePin(messageId);
      const pinned = Boolean(data?.data?.is_pinned);
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === messageId ? { ...m, is_pinned: pinned, pinned_at: data?.data?.pinned_at ?? m.pinned_at } : m
        )
      );
      const event = { message_id: messageId, channel_id: channel.channel_id, is_pinned: pinned };
      if (pinned) {
        emitMessagePinned(event);
      } else {
        emitMessageUnpinned(event);
      }
    } catch (err) {
      console.error('Pin toggle failed:', err);
    }
  };

  const jumpToMessage = (messageId: number) => {
    setShowPinned(false);
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background-color 0.5s ease';
      el.style.backgroundColor = 'rgba(100, 150, 255, 0.2)';
      setTimeout(() => {
        el.style.backgroundColor = 'transparent';
        setTimeout(() => (el.style.transition = ''), 500);
      }, 1500);
    }
  };

  const pinnedList = messages
    .filter((m) => m.is_pinned)
    .map((m) => ({ id: m.message_id, sender_name: m.sender_name, message_text: m.message_text }));

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (user) {
      emitTyping({ user_name: user.name, channel_id: channel.channel_id });
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        emitStopTyping({ user_name: user.name, channel_id: channel.channel_id });
      }, 2000);
    }
  };

  const handleToggleReaction = async (messageId: number, emoji: string) => {
    if (!user) return;
    const message = messages.find((m) => m.message_id === messageId);
    if (!message || message.is_deleted) return;

    const mine = message.my_reactions?.includes(emoji) ?? false;

    // Optimistic update so counts change instantly
    setMessages((prev) =>
      prev.map((m) =>
        m.message_id === messageId
          ? applyReactionDelta(m, { emoji, user_id: user.user_id }, !mine, user.user_id)
          : m
      )
    );

    try {
      const { data } = mine
        ? await removeMessageReaction(messageId, emoji)
        : await toggleMessageReaction(messageId, emoji);

      // Replace with the authoritative state returned by the server
      if (data?.success && data?.data) {
        setMessages((prev) =>
          prev.map((m) =>
            m.message_id === messageId
              ? { ...m, reactions: data.data.reactions, my_reactions: data.data.my_reactions }
              : m
          )
        );
      }

      const event = { message_id: messageId, channel_id: channel.channel_id, emoji, user_id: user.user_id };
      if (mine) {
        emitReactionRemoved(event);
      } else {
        emitReactionAdded(event);
      }
    } catch (err) {
      // Revert the optimistic update on failure
      setMessages((prev) =>
        prev.map((m) =>
          m.message_id === messageId
            ? applyReactionDelta(m, { emoji, user_id: user.user_id }, mine, user.user_id)
            : m
        )
      );
      console.error('Reaction toggle failed:', err);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmModal || !activeWorkspace) return;
    setActionLoading(true);
    setActionError('');
    setActionSuccess('');
    try {
      const { type, targetUser } = confirmModal;
      if (type === 'promote') {
        await updateMemberRole(activeWorkspace.workspace_id, targetUser.user_id, 'admin');
        setActionSuccess(`Promoted ${targetUser.name} to Admin`);
      } else if (type === 'demote') {
        await updateMemberRole(activeWorkspace.workspace_id, targetUser.user_id, 'member');
        setActionSuccess(`Demoted ${targetUser.name} to Member`);
      } else if (type === 'remove') {
        await removeMember(activeWorkspace.workspace_id, targetUser.user_id);
        setActionSuccess(`Removed ${targetUser.name} from workspace`);
      } else if (type === 'ban') {
        await banMember(activeWorkspace.workspace_id, targetUser.user_id, banReason.trim() || 'Banned by admin/owner');
        setActionSuccess(`Banned ${targetUser.name} from workspace`);
      } else if (type === 'unban') {
        await unbanMember(activeWorkspace.workspace_id, targetUser.user_id);
        setActionSuccess(`Unbanned ${targetUser.name}`);
      } else if (type === 'deleteChannel') {
        await deleteChannel(channel.channel_id);
        setConfirmModal(null);
        if (onChannelDeleted) {
          onChannelDeleted(channel.channel_id);
        }
        return;
      }
      await fetchMembersAndBanned();
      setTimeout(() => {
        setConfirmModal(null);
        setActionLoading(false);
        setBanReason('');
        setActionSuccess('');
      }, 700);
    } catch (err: any) {
      setActionError(err.response?.data?.message || 'Action failed');
      setActionLoading(false);
    }
  };

  const getInitials = (name: string) => name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?';
  const filteredTyping = typingUsers.filter((t) => t.user_name !== user?.name);

  return (
    <div className="chat-view" style={{ display: 'flex', flexDirection: 'row', flex: 1, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100%' }}>
        {/* Header */}
      <div className="chat-header">
        <Hash size={20} className="chat-header-icon" />
        <div className="chat-header-info">
          <h3>{channel.name}</h3>
          {channel.description && <span className="chat-header-desc">{channel.description}</span>}
        </div>
        <div className="chat-header-actions">
          {activeMeeting ? (
            <div className="channel-live-meeting-group">
              <div className="channel-live-indicator-pill">
                <span className="live-pulsing-dot" />
                <span className="live-indicator-text">{activeMeeting.title || 'Meeting in progress'}</span>
                <span className={`live-mode-tag ${activeMeeting.mode === 'voice' ? 'voice' : 'video'}`}>
                  {activeMeeting.mode === 'voice' ? <Mic size={11} /> : <Video size={11} />}
                  {activeMeeting.mode === 'voice' ? 'Voice' : 'Video'}
                </span>
              </div>
              <button
                type="button"
                className="channel-join-meeting-btn"
                onClick={() => navigate(`/meet/${activeMeeting.meeting_code}`)}
                title="Join this live meeting"
              >
                <Video size={15} />
                <span>Join Meeting</span>
              </button>
              {user && Number(activeMeeting.host_id) === Number(user.user_id) && (
                <button
                  type="button"
                  className="channel-end-meeting-btn"
                  onClick={handleEndMeeting}
                  title="End meeting for all participants"
                >
                  <PhoneOff size={13} />
                  <span>End</span>
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="channel-meeting-btn"
              onClick={() => setShowStartMeeting(true)}
              title="Start a meeting in this channel"
            >
              <Video size={16} />
              <span className="channel-meeting-label">Start Meeting</span>
            </button>
          )}

          <button className={`btn-icon ${showPinned ? 'active' : ''}`} onClick={() => setShowPinned(!showPinned)} title="Pinned messages">
            <Pin size={16} />
          </button>
          <button className={`btn-icon ${showMembers ? 'active' : ''}`} onClick={() => setShowMembers(!showMembers)} title="Workspace Members & Roles">
            <Users size={18} />
          </button>
          {['owner', 'admin'].includes(activeWorkspace?.role || '') && (
            <button
              className="btn-icon"
              onClick={() => setConfirmModal({ type: 'deleteChannel' })}
              title="Delete Channel"
              style={{ color: 'var(--accent-danger)' }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Active Meeting Top Banner */}
      {activeMeeting && (
        <div className="channel-active-meeting-banner">
          <div className="banner-left">
            <div className="banner-live-tag">
              <span className="live-pulsing-dot" /> LIVE
            </div>
            <div className="banner-info">
              <div className="banner-title-line">
                <h4 className="banner-title">{activeMeeting.title}</h4>
                <span className={`banner-mode-tag ${activeMeeting.mode === 'voice' ? 'voice' : 'video'}`}>
                  {activeMeeting.mode === 'voice' ? <Mic size={11} /> : <Video size={11} />}
                  {activeMeeting.mode === 'voice' ? 'Voice Meeting' : 'Video Meeting'}
                </span>
              </div>
              <span className="banner-desc">
                Meeting in progress{activeMeeting.host_name ? ` • Host: ${activeMeeting.host_name}` : ''}
              </span>
            </div>
          </div>
          <div className="banner-right">
            <button
              type="button"
              className="banner-join-btn"
              onClick={() => navigate(`/meet/${activeMeeting.meeting_code}`)}
            >
              <Video size={15} />
              <span>Join Meeting</span>
            </button>
            {user && Number(activeMeeting.host_id) === Number(user.user_id) && (
              <button
                type="button"
                className="banner-end-btn"
                onClick={handleEndMeeting}
                title="End meeting for everyone"
              >
                End Meeting
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <Hash size={48} />
            <h3>Welcome to #{channel.name}</h3>
            <p>This is the beginning of the channel. Send a message to start the conversation.</p>
          </div>
        )}
        {messages.map((msg) => {
          const isOwn = msg.sender_id === user?.user_id;

          // Slack/Teams-style Meeting Event Card
          if (msg.message_type === 'meeting' || (msg as any).meeting_code || (msg as any).meeting_id) {
            const isVideo = (msg as any).meeting_type === 'video' || (msg as any).mode === 'video' || msg.message_text?.toLowerCase().includes('video');
            const durSecs = (msg as any).meeting_duration || 0;
            const durMins = Math.floor(durSecs / 60);
            const durRemSecs = durSecs % 60;
            const durStr = durSecs > 0 ? `${durMins}m ${durRemSecs > 0 ? durRemSecs + 's' : ''}`.trim() : null;
            const meetingCode = (msg as any).meeting_code || 'syncora-meet';
            const meetingTitle = msg.message_text || 'Channel Meeting';

            return (
              <div id={`msg-${msg.message_id}`} key={msg.message_id} className="channel-meeting-event-wrapper">
                <div className={`channel-meeting-event-card ${isVideo ? 'video' : 'voice'}`}>
                  <div className="channel-meeting-event-icon">
                    {isVideo ? <Video size={18} /> : <Mic size={18} />}
                  </div>
                  <div className="channel-meeting-event-content">
                    <div className="channel-meeting-event-title-row">
                      <span className="channel-meeting-event-title">
                        {msg.message_text.includes('ended') ? msg.message_text : `${isVideo ? 'Video' : 'Voice'} Meeting ended`}
                      </span>
                      <span className="channel-meeting-event-badge">Ended</span>
                    </div>
                    <div className="channel-meeting-event-subtext">
                      <span className="meeting-host-pill">Host: <strong className="meeting-host-name">{msg.sender_name || 'Host'}</strong></span>
                      {durStr && <span className="meeting-dur-pill">Duration: <strong>{durStr}</strong></span>}
                      <span className="meeting-time-pill">{formatMessageTimestamp(msg.created_at)}</span>
                    </div>
                    {meetingCode && (
                      <div className="channel-meeting-event-actions">
                        <button
                          className="meeting-event-ai-btn summary"
                          onClick={() => setSelectedMeetingAI({
                            isOpen: true,
                            meetingCode: meetingCode,
                            meetingTitle: meetingTitle,
                            initialTab: 'summary'
                          })}
                        >
                          <Sparkles size={12} />
                          <span>View Summary</span>
                        </button>
                        <button
                          className="meeting-event-ai-btn transcript"
                          onClick={() => setSelectedMeetingAI({
                            isOpen: true,
                            meetingCode: meetingCode,
                            meetingTitle: meetingTitle,
                            initialTab: 'transcript'
                          })}
                        >
                          <FileText size={12} />
                          <span>View Transcript</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div id={`msg-${msg.message_id}`} key={msg.message_id} className={`message ${isOwn ? 'message-own' : ''} ${msg.is_deleted ? 'message-deleted' : ''}`}>
              <div className="avatar avatar-sm">
                {msg.sender_avatar ? (
                  <img src={getAvatarUrl(msg.sender_avatar) || ''} alt={msg.sender_name} className="avatar-img" />
                ) : (
                  getInitials(msg.sender_name)
                )}
              </div>
              <div className="message-content">
                <div className="message-meta">
                  <span className="message-sender">{msg.sender_name}</span>
                  <span className="message-time">
                    {formatMessageTimestamp(msg.created_at)}
                  </span>
                  {msg.is_pinned && <span className="pinned-indicator" title="Pinned"><Pin size={12} /></span>}
                  {msg.is_edited && <span className="message-edited-tag">(edited)</span>}
                </div>

                {msg.reply_to && (() => {
                  const repliedMsg = messages.find(m => m.message_id === msg.reply_to);
                  return (
                    <div className="message-reply-ref" style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => {
                      const el = document.getElementById(`msg-${msg.reply_to}`);
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.style.transition = 'background-color 0.5s ease';
                        el.style.backgroundColor = 'rgba(100, 150, 255, 0.2)'; // WhatsApp-style blue highlight
                        setTimeout(() => {
                          el.style.backgroundColor = 'transparent';
                          setTimeout(() => el.style.transition = '', 500);
                        }, 1500);
                      }
                    }}>
                      <Reply size={12} />
                      <span>
                        {repliedMsg ? (
                          <>Replying to <strong>{repliedMsg.sender_name}</strong>: "{repliedMsg.message_text.length > 30 ? repliedMsg.message_text.substring(0, 30) + '...' : repliedMsg.message_text}"</>
                        ) : (
                          `Replying to message #${msg.reply_to}`
                        )}
                      </span>
                    </div>
                  );
                })()}

                {editingId === msg.message_id ? (
                  <div className="message-edit-form">
                    <input
                      className="input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEdit(msg.message_id);
                        if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
                      }}
                      autoFocus
                    />
                    <div className="message-edit-actions">
                      <button className="btn btn-sm btn-primary" onClick={() => handleEdit(msg.message_id)}>Save</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setEditingId(null); setEditText(''); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="message-text">{msg.message_text}</p>
                )}
                {msg.file_url && !msg.is_deleted && (
                  <div className="message-attachment" style={{ marginTop: '8px', padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', display: 'inline-block' }}>
                    {msg.file_url.match(/\.(jpeg|jpg|gif|png)$/i) ? (
                      <img src={msg.file_url} alt="attachment" style={{ maxWidth: '200px', borderRadius: '4px', display: 'block' }} />
                    ) : (
                      <a href={msg.file_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
                        <Paperclip size={14} />
                        {msg.file_name || 'Attachment'}
                      </a>
                    )}
                  </div>
                )}

                {/* Reactions */}
                <MessageReactions
                  reactions={msg.reactions}
                  myReactions={msg.my_reactions}
                  isDeleted={Boolean(msg.is_deleted)}
                  onToggle={(emoji) => handleToggleReaction(msg.message_id, emoji)}
                />

                {/* Actions */}
                {isOwn && !msg.is_deleted && editingId !== msg.message_id && (
                  <div className="message-actions">
                    <button className={`btn-icon ${msg.is_pinned ? 'active' : ''}`} onClick={() => handleTogglePin(msg.message_id)} title={msg.is_pinned ? 'Unpin message' : 'Pin message'}>
                      <Pin size={13} />
                    </button>
                    <button className="btn-icon" onClick={() => { setEditingId(msg.message_id); setEditText(msg.message_text); }} title="Edit">
                      <Edit3 size={13} />
                    </button>
                    <button className="btn-icon" onClick={() => handleDelete(msg.message_id)} title="Delete">
                      <Trash2 size={13} />
                    </button>
                    <button className="btn-icon" onClick={() => setReplyTo(msg)} title="Reply">
                      <Reply size={13} />
                    </button>
                    <button
                      className="btn-icon"
                      title="Create Task from this message"
                      onClick={() => setCreateTaskMsg({
                        id: msg.message_id,
                        text: msg.message_text,
                        senderName: msg.sender_name,
                        type: 'channel',
                        channelId: channel.channel_id,
                      })}
                    >
                      <CheckSquare size={13} />
                    </button>
                  </div>
                )}
                {!isOwn && !msg.is_deleted && (
                  <div className="message-actions">
                    <button className={`btn-icon ${msg.is_pinned ? 'active' : ''}`} onClick={() => handleTogglePin(msg.message_id)} title={msg.is_pinned ? 'Unpin message' : 'Pin message'}>
                      <Pin size={13} />
                    </button>
                    <button className="btn-icon" onClick={() => setReplyTo(msg)} title="Reply">
                      <Reply size={13} />
                    </button>
                    <button
                      className="btn-icon"
                      title="Create Task from this message"
                      onClick={() => setCreateTaskMsg({
                        id: msg.message_id,
                        text: msg.message_text,
                        senderName: msg.sender_name,
                        type: 'channel',
                        channelId: channel.channel_id,
                      })}
                    >
                      <CheckSquare size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Typing Indicator */}
      {filteredTyping.length > 0 && (
        <div className="typing-indicator">
          <div className="typing-dots">
            <span /><span /><span />
          </div>
          <span>{filteredTyping.map((t) => t.user_name).join(', ')} {filteredTyping.length === 1 ? 'is' : 'are'} typing...</span>
        </div>
      )}

      {/* Reply Banner */}
      {replyTo && (
        <div className="reply-banner">
          <Reply size={14} />
          <span>Replying to <strong>{replyTo.sender_name}</strong>: {replyTo.message_text.slice(0, 60)}...</span>
          <button className="btn-icon" onClick={() => setReplyTo(null)}><X size={14} /></button>
        </div>
      )}

      {selectedFile && (
        <div className="file-preview" style={{ padding: '8px 16px', backgroundColor: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
            <Paperclip size={14} />
            <span>{selectedFile.name}</span>
          </div>
          <button className="btn-icon" onClick={() => setSelectedFile(null)}>
            <X size={14} />
          </button>
        </div>
      )}

        {/* Composer */}
        <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
          <input 
            type="file" 
            style={{ display: 'none' }} 
            ref={fileInputRef} 
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                setSelectedFile(e.target.files[0]);
              }
            }}
          />
          <button type="button" className="btn-icon" style={{ marginRight: '8px' }} onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            <Paperclip size={18} />
          </button>
          <input
            className="composer-input"
            placeholder={`Message #${channel.name}`}
            value={input}
            onChange={handleInputChange}
            disabled={isUploading}
          />
          <button type="submit" className="btn btn-md btn-primary send-btn" disabled={(!input.trim() && !selectedFile) || isUploading}>
            <Send size={16} />
          </button>
        </form>
      </div>

      {/* Pinned Messages */}
      {showPinned && (
        <PinnedMessagesPanel
          title={`Pinned in #${channel.name}`}
          pinned={pinnedList}
          onSelect={jumpToMessage}
          onClose={() => setShowPinned(false)}
        />
      )}

      {/* Right Sidebar for Members & Role Management */}
      {showMembers && (
        <>
          <div className="members-overlay" onClick={() => setShowMembers(false)} />
          <div className="chat-members-panel">
            <div className="members-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={18} color="var(--accent-primary)" />
                <h3>Members & Roles ({members.length})</h3>
              </div>
              <button className="btn-icon" onClick={() => setShowMembers(false)}><X size={16} /></button>
            </div>

            {/* Tabs if owner or admin */}
            {['owner', 'admin'].includes(activeWorkspace?.role || '') && (
              <div className="members-tabs">
                <button
                  className={`members-tab-btn ${activeMemberTab === 'members' ? 'active' : ''}`}
                  onClick={() => setActiveMemberTab('members')}
                >
                  <Users size={14} />
                  <span>Members ({members.length})</span>
                </button>
                <button
                  className={`members-tab-btn ${activeMemberTab === 'banned' ? 'active' : ''}`}
                  onClick={() => setActiveMemberTab('banned')}
                >
                  <Ban size={14} />
                  <span>Banned ({bannedMembers.length})</span>
                </button>
              </div>
            )}

            {activeMemberTab === 'members' ? (
              <div className="members-list">
                {members.map((member) => {
                  const isSelf = member.user_id === user?.user_id;
                  const currentUserRole = activeWorkspace?.role || 'member';

                  return (
                    <div key={member.user_id} className="member-row">
                      <div className="avatar avatar-sm">
                        {member.avatar_url ? (
                          <img src={getAvatarUrl(member.avatar_url) || ''} alt={member.name} className="avatar-img" />
                        ) : (
                          getInitials(member.name)
                        )}
                      </div>
                      <div className="member-meta">
                        <div className="member-name-row">
                          <span className="member-name">{member.name}</span>
                          {isSelf && <span className="member-you-tag">You</span>}
                        </div>
                        <span className="member-email">{member.email}</span>
                        <div style={{ marginTop: 2 }}>
                          {member.role === 'owner' && (
                            <span className="role-badge owner">
                              <Crown size={11} /> Owner
                            </span>
                          )}
                          {member.role === 'admin' && (
                            <span className="role-badge admin">
                              <Shield size={11} /> Admin
                            </span>
                          )}
                          {member.role === 'member' && (
                            <span className="role-badge member">
                              Member
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="member-actions-group">
                        {!isSelf && (
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => { onDmSelect(member.user_id, member.name); setShowMembers(false); }}
                            title="Direct Message"
                          >
                            DM
                          </button>
                        )}

                        {/* Owner actions: can promote/demote, remove, ban any admin/member */}
                        {!isSelf && currentUserRole === 'owner' && (
                          <>
                            {member.role === 'admin' && (
                              <button
                                className="member-action-btn demote"
                                onClick={() => setConfirmModal({ type: 'demote', targetUser: member })}
                                title="Demote to Member"
                              >
                                <ShieldAlert size={14} />
                              </button>
                            )}
                            {member.role === 'member' && (
                              <button
                                className="member-action-btn promote"
                                onClick={() => setConfirmModal({ type: 'promote', targetUser: member })}
                                title="Promote to Admin"
                              >
                                <ShieldCheck size={14} />
                              </button>
                            )}
                            <button
                              className="member-action-btn remove"
                              onClick={() => setConfirmModal({ type: 'remove', targetUser: member })}
                              title="Remove from Workspace"
                            >
                              <UserMinus size={14} />
                            </button>
                            <button
                              className="member-action-btn ban"
                              onClick={() => setConfirmModal({ type: 'ban', targetUser: member })}
                              title="Ban from Workspace"
                            >
                              <Ban size={14} />
                            </button>
                          </>
                        )}

                        {/* Admin actions: can remove, ban regular members only (cannot touch owner or admins) */}
                        {!isSelf && currentUserRole === 'admin' && member.role === 'member' && (
                          <>
                            <button
                              className="member-action-btn remove"
                              onClick={() => setConfirmModal({ type: 'remove', targetUser: member })}
                              title="Remove from Workspace"
                            >
                              <UserMinus size={14} />
                            </button>
                            <button
                              className="member-action-btn ban"
                              onClick={() => setConfirmModal({ type: 'ban', targetUser: member })}
                              title="Ban from Workspace"
                            >
                              <Ban size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                {members.length === 0 && <div className="members-empty">No members found.</div>}
              </div>
            ) : (
              <div className="members-list">
                {bannedMembers.map((banned) => (
                  <div key={banned.ban_id} className="banned-row">
                    <div className="banned-meta">
                      <div className="banned-name">{banned.name}</div>
                      <div className="member-email">{banned.email}</div>
                      <div className="banned-reason">Reason: {banned.reason}</div>
                      {banned.banned_by_name && (
                        <div className="banned-by">Banned by: {banned.banned_by_name}</div>
                      )}
                    </div>
                    <div className="banned-footer">
                      <span className="timestamp" style={{ fontSize: 10 }}>
                        {formatMessageTimestamp(banned.created_at)}
                      </span>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setConfirmModal({ type: 'unban', targetUser: banned })}
                      >
                        <Unlock size={12} /> Unban
                      </button>
                    </div>
                  </div>
                ))}
                {bannedMembers.length === 0 && (
                  <div className="members-empty">No banned users in this workspace.</div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Confirmation Modal for Role Changes, Removal, Ban, Unban, Channel Deletion */}
      {confirmModal && (
        <div className="modal-overlay" onClick={() => !actionLoading && setConfirmModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={20} color="var(--accent-warning)" />
                <h3>
                  {confirmModal.type === 'promote' && 'Promote to Admin'}
                  {confirmModal.type === 'demote' && 'Demote to Member'}
                  {confirmModal.type === 'remove' && 'Remove Member'}
                  {confirmModal.type === 'ban' && 'Ban Member'}
                  {confirmModal.type === 'unban' && 'Unban User'}
                  {confirmModal.type === 'deleteChannel' && 'Delete Channel'}
                </h3>
              </div>
              <button className="btn-icon" onClick={() => !actionLoading && setConfirmModal(null)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: 16 }}>
              {confirmModal.type === 'promote' && (
                <p>Are you sure you want to promote <strong>{confirmModal.targetUser?.name}</strong> to <strong>Admin</strong>? They will be able to manage members and channels.</p>
              )}
              {confirmModal.type === 'demote' && (
                <p>Are you sure you want to demote <strong>{confirmModal.targetUser?.name}</strong> to <strong>Member</strong>? They will lose administrative privileges.</p>
              )}
              {confirmModal.type === 'remove' && (
                <p>Are you sure you want to remove <strong>{confirmModal.targetUser?.name}</strong> from this workspace? They will lose access to all channels and tasks.</p>
              )}
              {confirmModal.type === 'ban' && (
                <div>
                  <p>Are you sure you want to ban <strong>{confirmModal.targetUser?.name}</strong>? They will be removed immediately and blocked from rejoining.</p>
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label>Ban Reason (Optional)</label>
                    <input
                      className="input"
                      placeholder="e.g. Violation of team rules"
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                    />
                  </div>
                </div>
              )}
              {confirmModal.type === 'unban' && (
                <p>Unban <strong>{confirmModal.targetUser?.name}</strong>? They will be allowed to rejoin or be invited back to the workspace.</p>
              )}
              {confirmModal.type === 'deleteChannel' && (
                <p>Are you sure you want to delete <strong>#{channel.name}</strong>? All message history will be permanently deleted.</p>
              )}
            </div>

            {actionError && (
              <div style={{ color: 'var(--accent-danger)', fontSize: '0.8125rem', marginBottom: 12 }}>
                {actionError}
              </div>
            )}
            {actionSuccess && (
              <div style={{ color: 'var(--accent-success)', fontSize: '0.8125rem', marginBottom: 12 }}>
                {actionSuccess}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setConfirmModal(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className={`btn btn-sm ${confirmModal.type === 'deleteChannel' || confirmModal.type === 'remove' || confirmModal.type === 'ban' ? 'btn-danger' : 'btn-primary'}`}
                onClick={handleConfirmAction}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant */}
      <AIAssistantPanel contextType="channel" contextId={channel.channel_id} />

      {/* Create Task from Message Modal */}
      {createTaskMsg && (
        <CreateTaskFromMessageModal
          sourceMessage={createTaskMsg}
          onClose={() => setCreateTaskMsg(null)}
          onCreated={() => setCreateTaskMsg(null)}
        />
      )}

      {/* Start Meeting Modal */}
      <StartMeetingModal
        isOpen={showStartMeeting}
        onClose={() => setShowStartMeeting(false)}
        workspaceId={channel.workspace_id || activeWorkspace?.workspace_id || 1}
        channelId={channel.channel_id}
        channelName={channel.name}
      />

      {/* Meeting AI Summary & Transcript Modal */}
      {selectedMeetingAI && (
        <MeetingAIModal
          isOpen={selectedMeetingAI.isOpen}
          onClose={() => setSelectedMeetingAI(null)}
          meetingCode={selectedMeetingAI.meetingCode}
          meetingTitle={selectedMeetingAI.meetingTitle}
          workspaceId={channel.workspace_id || activeWorkspace?.workspace_id || 1}
          initialTab={selectedMeetingAI.initialTab}
        />
      )}
    </div>
  );
};

export default ChatView;
