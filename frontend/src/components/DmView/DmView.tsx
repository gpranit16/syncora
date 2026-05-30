import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, ArrowLeft, Edit3, Trash2, Reply, X, Paperclip } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getDirectMessages, sendDirectMessage, getRecentDmUsers, editDirectMessage, deleteDirectMessage, type DirectMessage } from '../../api/directMessages';
import { uploadFile } from '../../api/files';
import { API_BASE } from '../../api/client';
import { globalSearch, type SearchUser } from '../../api/search';
import { getSocket } from '../../socket/socketManager';
import { joinDm, emitSendDm, emitMarkDmRead, emitTyping, emitStopTyping, emitDmEdited, emitDmDeleted } from '../../socket/socketManager';
import { useAutoScroll } from '../../hooks/useSocket';
import { formatDistanceToNow } from 'date-fns';
import './DmView.css';

interface DmViewProps {
  initialTargetUser?: { user_id: number; name: string } | null;
  onTargetChange?: (target: { user_id: number; name: string } | null) => void;
}

const DmView: React.FC<DmViewProps> = ({ initialTargetUser, onTargetChange }) => {
  const { user } = useAuth();
  const [selectedUser, setSelectedUser] = useState<SearchUser | null>(null);

  useEffect(() => {
    if (selectedUser) {
      const target = { user_id: selectedUser.user_id, name: selectedUser.name };
      localStorage.setItem('dmTarget', JSON.stringify(target));
      onTargetChange?.(target);
    } else {
      localStorage.removeItem('dmTarget');
      onTargetChange?.(null);
    }
  }, [selectedUser, onTargetChange]);

  useEffect(() => {
    if (initialTargetUser) {
      setSelectedUser({ user_id: initialTargetUser.user_id, name: initialTargetUser.name, email: '' });
      onTargetChange?.(initialTargetUser);
    }
  }, [initialTargetUser]);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [recentUsers, setRecentUsers] = useState<SearchUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useAutoScroll(messages);

  useEffect(() => {
    if (!selectedUser) {
      getRecentDmUsers()
        .then(({ data }) => {
          if (data.success) setRecentUsers(data.users);
        })
        .catch(console.error);
    }
  }, [selectedUser]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.trim()) {
        try {
          const { data } = await globalSearch(searchQuery);
          setSearchResults(data.users.filter((u) => u.user_id !== user?.user_id));
        } catch (err) {
          console.error('Search failed:', err);
        }
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, user]);

  useEffect(() => {
    if (!selectedUser || !user) return;
    joinDm(user.user_id, selectedUser.user_id);
    getDirectMessages(selectedUser.user_id)
      .then(({ data }) => setMessages(data.messages))
      .catch(console.error);
    emitMarkDmRead(selectedUser.user_id, user.user_id);
  }, [selectedUser, user]);

  const playSound = (type: 'send') => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.log('Audio error', e);
    }
  };

  useEffect(() => {
    if (!selectedUser || !user) return;
    const socket = getSocket();
    const handler = (msg: DirectMessage) => {
      const isRelevant =
        (msg.sender_id === user.user_id && msg.receiver_id === selectedUser.user_id) ||
        (msg.sender_id === selectedUser.user_id && msg.receiver_id === user.user_id);
      if (isRelevant) {
        setMessages((prev) => {
          if (prev.some((m) => m.direct_message_id === msg.direct_message_id)) return prev;
          return [...prev, msg];
        });
        emitMarkDmRead(selectedUser.user_id, user.user_id);
      }
    };

    const handleUserTyping = (data: { user_name: string; sender_id?: number; receiver_id?: number }) => {
      if (
        (data.sender_id === selectedUser.user_id && data.receiver_id === user.user_id) ||
        (data.sender_id === user.user_id && data.receiver_id === selectedUser.user_id)
      ) {
        if (data.user_name !== user.name) {
          setTypingUsers((prev) => {
            const next = new Set(prev);
            next.add(data.user_name);
            return next;
          });
        }
      }
    };

    const handleUserStopTyping = (data: { user_name: string; sender_id?: number; receiver_id?: number }) => {
      if (
        (data.sender_id === selectedUser.user_id && data.receiver_id === user.user_id) ||
        (data.sender_id === user.user_id && data.receiver_id === selectedUser.user_id)
      ) {
        setTypingUsers((prev) => {
          const next = new Set(prev);
          next.delete(data.user_name);
          return next;
        });
      }
    };

    const handleDmEdited = (data: { direct_message_id: number; message_text: string }) => {
      setMessages((prev) => prev.map((m) =>
        m.direct_message_id === data.direct_message_id ? { ...m, message_text: data.message_text, is_edited: true } : m
      ));
    };

    const handleDmDeleted = (data: { direct_message_id: number }) => {
      setMessages((prev) => prev.map((m) =>
        m.direct_message_id === data.direct_message_id ? { ...m, message_text: 'This message was deleted.', is_deleted: true } : m
      ));
    };

    const handleOnlineUsers = (onlineIds: number[]) => {
      if (selectedUser) {
        setSelectedUser((prev) => {
          if (!prev) return null;
          const isNowOnline = onlineIds.includes(prev.user_id);
          const wasOnline = prev.is_online;
          
          return { 
            ...prev, 
            is_online: isNowOnline,
            last_seen: (!isNowOnline && wasOnline) ? new Date().toISOString() : prev.last_seen
          };
        });
      }
    };

    socket.on('receive_dm', handler);
    socket.on('user_typing', handleUserTyping);
    socket.on('stop_typing', handleUserStopTyping);
    socket.on('dm_edited', handleDmEdited);
    socket.on('dm_deleted', handleDmDeleted);
    socket.on('online_users', handleOnlineUsers);
    
    return () => { 
      socket.off('receive_dm', handler); 
      socket.off('user_typing', handleUserTyping);
      socket.off('stop_typing', handleUserStopTyping);
      socket.off('dm_edited', handleDmEdited);
      socket.off('dm_deleted', handleDmDeleted);
      socket.off('online_users', handleOnlineUsers);
    };
  }, [selectedUser, user]);

  const handleEdit = async (msgId: number) => {
    if (!editText.trim() || !user || !selectedUser) return;
    try {
      await editDirectMessage(msgId, editText.trim());
      emitDmEdited({
        direct_message_id: msgId,
        sender_id: user.user_id,
        receiver_id: selectedUser.user_id,
        message_text: editText.trim(),
        is_edited: true
      });
      setEditingId(null);
      setEditText('');
    } catch (err) {
      console.error('Edit DM failed:', err);
    }
  };

  const handleDelete = async (msgId: number) => {
    if (!user || !selectedUser) return;
    try {
      await deleteDirectMessage(msgId);
      emitDmDeleted({
        direct_message_id: msgId,
        sender_id: user.user_id,
        receiver_id: selectedUser.user_id,
        is_deleted: true
      });
    } catch (err) {
      console.error('Delete DM failed:', err);
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    if (!user || !selectedUser) return;

    emitTyping({
      user_name: user.name,
      sender_id: user.user_id,
      receiver_id: selectedUser.user_id
    });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      emitStopTyping({
        user_name: user.name,
        sender_id: user.user_id,
        receiver_id: selectedUser.user_id
      });
    }, 1500);
  };

  const handleBlur = () => {
    if (!user || !selectedUser) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    emitStopTyping({
      user_name: user.name,
      sender_id: user.user_id,
      receiver_id: selectedUser.user_id
    });
  };

  const handleSend = async () => {
    if ((!input.trim() && !selectedFile) || !user || !selectedUser) return;
    
    let fileUrl = null;
    let fileName = null;

    if (selectedFile) {
      setIsUploading(true);
      try {
        const { data } = await uploadFile(selectedFile);
        if (data.success && data.file) {
          const uploadBase = API_BASE || '';
          fileUrl = `${uploadBase}/uploads/${data.file.filename}`;
          fileName = data.file.filename;
        }
      } catch (err) {
        console.error('File upload failed', err);
      } finally {
        setIsUploading(false);
      }
    }

    try {
      const payload: any = { 
        receiver_id: selectedUser.user_id, 
        message_text: input.trim(),
        file_url: fileUrl,
        file_name: fileName
      };
      if (replyTo) payload.reply_to = replyTo.direct_message_id;
      
      const { data } = await sendDirectMessage(payload);
      emitSendDm({
        direct_message_id: data.data.direct_message_id,
        sender_id: user.user_id,
        receiver_id: selectedUser.user_id,
        sender_name: user.name,
        message_text: input.trim(),
        file_url: fileUrl,
        file_name: fileName,
        reply_to: replyTo ? replyTo.direct_message_id : null,
        created_at: new Date().toISOString(),
      });
      playSound('send');
      setInput('');
      setReplyTo(null);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      emitStopTyping({
        user_name: user.name,
        sender_id: user.user_id,
        receiver_id: selectedUser.user_id
      });
    } catch (err) {
      console.error('Send DM failed:', err);
    }
  };

  const getInitials = (name: string) => name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?';

  if (!selectedUser) {
    return (
      <div className="dm-view">
        <div className="dm-header">
          <MessageSquare size={20} />
          <h3>Direct Messages</h3>
        </div>
        <div className="dm-search">
          <input
            className="input"
            placeholder="Search users to message..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="dm-user-list">
          {searchQuery && searchResults.map((u) => (
            <button
              key={u.user_id}
              className="dm-user-item"
              onClick={() => {
                setSelectedUser(u);
                onTargetChange?.({ user_id: u.user_id, name: u.name });
              }}
            >
              <div className="avatar">{getInitials(u.name)}</div>
              <div className="dm-user-info">
                <span className="dm-user-name">{u.name}</span>
                <span className="dm-user-email">{u.email}</span>
              </div>
            </button>
          ))}
          {searchQuery && searchResults.length === 0 && (
            <div className="empty-state">
              <p>No users found matching "{searchQuery}".</p>
            </div>
          )}
          
          {!searchQuery && recentUsers.length > 0 && (
            <>
              <h4 style={{ margin: '16px 20px 8px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Recent Conversations</h4>
              {recentUsers.map((u) => (
                <button
                  key={u.user_id}
                  className="dm-user-item"
                  onClick={() => {
                    setSelectedUser(u);
                    onTargetChange?.({ user_id: u.user_id, name: u.name });
                  }}
                >
                  <div className="avatar">{getInitials(u.name)}</div>
                  <div className="dm-user-info">
                    <span className="dm-user-name">{u.name}</span>
                    <span className="dm-user-email">{u.email}</span>
                  </div>
                </button>
              ))}
            </>
          )}

          {!searchQuery && recentUsers.length === 0 && (
            <div className="empty-state">
              <MessageSquare size={48} />
              <h3>Start a conversation</h3>
              <p>Search for a user above to begin messaging.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="dm-view">
      <div className="dm-header">
        <button
          className="btn-icon"
          onClick={() => {
            setSelectedUser(null);
            onTargetChange?.(null);
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="avatar" style={{ position: 'relative' }}>
          {getInitials(selectedUser.name)}
          {selectedUser.is_online && <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--success)', border: '2px solid var(--bg-elevated)' }} />}
        </div>
        <div className="dm-header-info">
          <h3>{selectedUser.name}</h3>
          <span className="dm-header-email" style={{ color: selectedUser.is_online ? 'var(--success)' : 'var(--text-muted)' }}>
            {selectedUser.is_online ? 'Online' : (selectedUser.last_seen ? `Last seen ${formatDistanceToNow(new Date(selectedUser.last_seen), { addSuffix: true })}` : 'Offline')}
          </span>
        </div>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <MessageSquare size={48} />
            <h3>No messages yet</h3>
            <p>Send a message to start the conversation with {selectedUser.name}.</p>
          </div>
        )}
        {messages.map((msg) => {
          const isOwn = msg.sender_id === user?.user_id;
          return (
            <div id={`dm-${msg.direct_message_id}`} key={msg.direct_message_id} className={`message ${isOwn ? 'message-own' : ''} ${msg.is_deleted ? 'message-deleted' : ''}`}>
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
                  const repliedMsg = messages.find(m => m.direct_message_id === msg.reply_to);
                  return (
                    <div className="message-reply-ref" style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => {
                      const el = document.getElementById(`dm-${msg.reply_to}`);
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

                {editingId === msg.direct_message_id ? (
                  <div className="message-edit-form">
                    <input
                      className="input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEdit(msg.direct_message_id);
                        if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
                      }}
                      autoFocus
                    />
                    <div className="message-edit-actions">
                      <button className="btn btn-sm btn-primary" onClick={() => handleEdit(msg.direct_message_id)}>Save</button>
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
                {isOwn && !msg.is_deleted && editingId !== msg.direct_message_id && (
                  <div className="message-actions">
                    <button className="btn-icon" onClick={() => { setEditingId(msg.direct_message_id); setEditText(msg.message_text); }} title="Edit">
                      <Edit3 size={13} />
                    </button>
                    <button className="btn-icon" onClick={() => handleDelete(msg.direct_message_id)} title="Delete">
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
        <div ref={scrollRef} />
      </div>

      {typingUsers.size > 0 && (
        <div className="typing-indicator" style={{ position: 'absolute', bottom: replyTo ? '120px' : '80px', left: '24px' }}>
          <div className="typing-dots">
            <span></span><span></span><span></span>
          </div>
          {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
        </div>
      )}

      {replyTo && (
        <div className="reply-banner" style={{ background: 'var(--bg-elevated)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
          <Reply size={14} color="var(--accent-secondary)" />
          <span style={{ flex: 1, color: 'var(--text-muted)' }}>Replying to <strong style={{ color: 'var(--text-primary)' }}>{replyTo.sender_name}</strong>: {replyTo.message_text.slice(0, 60)}...</span>
          <button className="btn-icon" onClick={() => setReplyTo(null)} style={{ height: 24, width: 24 }}><X size={14} /></button>
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

      <div className="chat-input" style={{ borderTop: (replyTo || selectedFile) ? 'none' : '1px solid var(--border-subtle)' }}>
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
        <button className="btn-icon" style={{ marginRight: '8px' }} onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          <Paperclip size={18} />
        </button>
        <input
          className="input"
          placeholder={`Message ${selectedUser.name}...`}
          value={input}
          onChange={handleTyping}
          onBlur={handleBlur}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={isUploading}
        />
        <button className="btn btn-md btn-primary send-btn" onClick={handleSend} disabled={(!input.trim() && !selectedFile) || isUploading}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
};

export default DmView;
