import React, { useState, useEffect } from 'react';
import { X, CheckSquare, MessageSquare, User } from 'lucide-react';
import { createTaskFromMessage } from '../../api/tasks';
import { getWorkspaceMembers } from '../../api/workspaces';
import { emitTaskAssigned } from '../../socket/socketManager';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';

export interface SourceMessage {
  id: number;
  text: string;
  senderName: string;
  type: 'channel' | 'dm';
  channelId?: number;
  dmUserId?: number;
}

interface CreateTaskFromMessageModalProps {
  sourceMessage: SourceMessage;
  onClose: () => void;
  onCreated: () => void;
}

const CreateTaskFromMessageModal: React.FC<CreateTaskFromMessageModalProps> = ({
  sourceMessage,
  onClose,
  onCreated,
}) => {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [title, setTitle] = useState(
    sourceMessage.text.length > 80
      ? sourceMessage.text.slice(0, 80)
      : sourceMessage.text
  );
  const [description, setDescription] = useState(
    sourceMessage.text.length > 80 ? sourceMessage.text : ''
  );
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState<number | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (activeWorkspace) {
      getWorkspaceMembers(activeWorkspace.workspace_id)
        .then(({ data }) => setMembers(data.members))
        .catch(() => {});
    }
  }, [activeWorkspace]);

  const handleCreate = async () => {
    if (!title.trim() || !activeWorkspace) return;
    setLoading(true);
    setError('');
    try {
      await createTaskFromMessage({
        workspace_id: activeWorkspace.workspace_id,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
        assigned_to: assignedTo || undefined,
        source_message_id: sourceMessage.id,
        source_message_type: sourceMessage.type,
        source_channel_id: sourceMessage.channelId,
        source_dm_user_id: sourceMessage.dmUserId,
      });

      if (assignedTo && assignedTo !== user?.user_id) {
        emitTaskAssigned({
          assigned_to: assignedTo,
          task_title: title.trim(),
          workspace_name: activeWorkspace.name,
          assigned_by: user?.name || 'A team member',
        });
      }

      onCreated();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to create task. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 480, width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckSquare size={18} />
            <h3>Create Task from Message</h3>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Source message preview */}
        <div
          style={{
            margin: '0 0 16px',
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.8125rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: 'var(--text-muted)' }}>
            <MessageSquare size={12} />
            <span>
              Source: {sourceMessage.type === 'channel' ? 'Channel message' : 'Direct message'} from{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{sourceMessage.senderName}</strong>
            </span>
          </div>
          <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {sourceMessage.text.length > 160
              ? sourceMessage.text.slice(0, 160) + '...'
              : sourceMessage.text}
          </p>
        </div>

        {/* Form */}
        <div className="form-group">
          <label>Title *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            autoFocus
          />
        </div>

        <div className="form-group" style={{ marginTop: 14 }}>
          <label>Description</label>
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={3}
          />
        </div>

        <div className="form-row-2" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Priority</label>
            <div className="task-priority-selector" style={{ display: 'flex', gap: 6, width: '100%' }}>
              {(['low', 'medium', 'high'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`btn btn-sm ${priority === p ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPriority(p)}
                  style={{ textTransform: 'capitalize', flex: 1, minWidth: 0 }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Due Date</label>
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 14 }}>
          <label>
            <User size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Assign To
          </label>
          <select
            className="input"
            value={assignedTo || ''}
            onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name} {m.user_id === user?.user_id ? '(me)' : ''}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              borderRadius: 6,
              background: 'rgba(255,80,80,0.1)',
              border: '1px solid rgba(255,80,80,0.3)',
              color: 'var(--error, #f87171)',
              fontSize: '0.8125rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-md btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-md btn-primary"
            onClick={handleCreate}
            disabled={!title.trim() || loading}
          >
            {loading ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateTaskFromMessageModal;
