import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Send, Paperclip, Edit3, Trash2, Reply, X, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { getWorkspaceMembers } from '../../api/workspaces';
import { getMessages, sendMessage as sendMsgApi, editMessage as editMsgApi, deleteMessage as deleteMsgApi, type Message } from '../../api/messages';
import { uploadFile } from '../../api/files';
import { API_BASE } from '../../api/client';
import { getSocket } from '../../socket/socketManager';
import { joinChannel, emitSendMessage, emitMessageEdited, emitMessageDeleted, emitTyping, emitStopTyping, emitMarkChannelRead } from '../../socket/socketManager';
import { useTypingIndicator, useAutoScroll } from '../../hooks/useSocket';
import type { Channel } from '../../api/channels';
import { formatDistanceToNow } from 'date-fns';
import './ChatView.css';

interface ChatViewProps {
  channel: Channel;
  onDmSelect: (userId: number, userName: string) => void;
}

const ChatView: React.FC<ChatViewProps> = ({ channel, onDmSelect }) => {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const typingUsers = useTypingIndicator(channel.channel_id);
  const scrollRef = useAutoScroll(messages);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      
      if (type === 'send') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      } else {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      }
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.log('Audio error', e);
    }
  }, []);

  useEffect(() => {
    const socket = getSocket();
    
    const onConnect = () => {
      joinChannel(channel.channel_id);
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

    socket.on('receive_message', onReceive);
    socket.on('message_edited', onEdited);
    socket.on('message_deleted', onDeleted);
    return () => {
      socket.off('receive_message', onReceive);
      socket.off('message_edited', onEdited);
      socket.off('message_deleted', onDeleted);
    };
  }, [channel.channel_id, user]);

  const handleSend = async () => {
    if ((!input.trim() && !selectedFile) || !user) return;
    
    let fileUrl = null;
    let fileName = null;

    if (selectedFile) {
      setIsUploading(true);
      try {
        const { data: uploadData } = await uploadFile(selectedFile);
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
        message_text: input.trim(),
        reply_to: replyTo?.message_id || null,
        file_url: fileUrl,
        file_name: fileName
      });
      const msgData = {
        message_id: data.data.message_id,
        channel_id: channel.channel_id,
        sender_id: user.user_id,
        sender_name: user.name,
        message_text: input.trim(),
        reply_to: replyTo?.message_id || null,
        file_url: fileUrl,
        file_name: fileName,
        created_at: new Date().toISOString(),
      };
      emitSendMessage(msgData);
      playSound('send');
      setInput('');
      setReplyTo(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      emitStopTyping({ user_name: user.name, channel_id: channel.channel_id });
    } catch (err) {
      console.error('Send failed:', err);
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
          <button className={`btn-icon ${showMembers ? 'active' : ''}`} onClick={() => setShowMembers(!showMembers)}>
            <Users size={18} />
          </button>
        </div>
      </div>

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
          return (
            <div id={`msg-${msg.message_id}`} key={msg.message_id} className={`message ${isOwn ? 'message-own' : ''} ${msg.is_deleted ? 'message-deleted' : ''}`}>
              <div className="avatar avatar-sm">{getInitials(msg.sender_name)}</div>
              <div className="message-content">
                <div className="message-meta">
                  <span className="message-sender">{msg.sender_name}</span>
                  <span className="message-time">
                    {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                  </span>
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

                {/* Actions */}
                {isOwn && !msg.is_deleted && editingId !== msg.message_id && (
                  <div className="message-actions">
                    <button className="btn-icon" onClick={() => { setEditingId(msg.message_id); setEditText(msg.message_text); }} title="Edit">
                      <Edit3 size={13} />
                    </button>
                    <button className="btn-icon" onClick={() => handleDelete(msg.message_id)} title="Delete">
                      <Trash2 size={13} />
                    </button>
                    <button className="btn-icon" onClick={() => setReplyTo(msg)} title="Reply">
                      <Reply size={13} />
                    </button>
                  </div>
                )}
                {!isOwn && !msg.is_deleted && (
                  <div className="message-actions">
                    <button className="btn-icon" onClick={() => setReplyTo(msg)} title="Reply">
                      <Reply size={13} />
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

      {/* Right Sidebar for Members */}
      {showMembers && (
        <>
          <div className="members-overlay" onClick={() => setShowMembers(false)} />
          <div className="chat-members-panel">
            <div className="members-header">
              <h3>Members</h3>
              <button className="btn-icon" onClick={() => setShowMembers(false)}><X size={16} /></button>
            </div>
            <div className="members-list">
              {members.map(member => (
                <div key={member.user_id} className="member-row">
                  <div className="avatar avatar-sm">{getInitials(member.name)}</div>
                  <div className="member-meta">
                    <div className="member-name">{member.name}</div>
                    <div className="member-role">{member.role}</div>
                  </div>
                  {member.user_id !== user?.user_id && (
                    <button className="btn btn-sm btn-primary" onClick={() => { onDmSelect(member.user_id, member.name); setShowMembers(false); }}>
                      Message
                    </button>
                  )}
                </div>
              ))}
              {members.length === 0 && <div className="members-empty">No members found.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChatView;
