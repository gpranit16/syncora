import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Sparkles, AlertCircle, Loader2, CheckSquare, CheckCircle2 } from 'lucide-react';
import { askTaskAI, type TaskAIAction } from '../../api/ai';
import { createTask, updateTask, updateTaskStatus, getTasks } from '../../api/tasks';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { getWorkspaceMembers } from '../../api/workspaces';
import FormattedAIMessage from '../FormattedAIMessage/FormattedAIMessage';
import './TaskAIAssistant.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  action?: TaskAIAction;
  actionStatus?: 'pending' | 'confirmed' | 'cancelled';
}

const TASK_SUGGESTIONS = [
  'Show my pending tasks',
  'Which tasks are overdue?',
  'What should I work on first?',
  'Summarize my tasks',
  'Which tasks are high priority?',
];

interface TaskAIAssistantProps {
  onTasksChanged?: () => void;
}

const TaskAIAssistant: React.FC<TaskAIAssistantProps> = ({ onTasksChanged }) => {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [confirmingIdx, setConfirmingIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleAsk = async (question: string) => {
    if (!question.trim() || isLoading || !activeWorkspace) return;

    const userMsg: ChatMessage = { role: 'user', content: question.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const { data } = await askTaskAI({
        question: question.trim(),
        workspace_id: activeWorkspace.workspace_id,
      });

      if (data.success) {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: data.answer || 'Action ready.',
          action: data.action,
          actionStatus: data.action ? 'pending' : undefined,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.message || 'Unable to get a response.', isError: true },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'AI service temporarily unavailable. Please try again.', isError: true },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Execute a confirmed AI action against the real task APIs.
   */
  const handleConfirmAction = async (msgIdx: number, action: TaskAIAction) => {
    if (!activeWorkspace || !user) return;
    setConfirmingIdx(msgIdx);

    try {
      if (action.type === 'create') {
        // Resolve assigned_to from name if possible
        let assignedToId: number | undefined;
        if (action.fields._assigned_to_user_id) {
          assignedToId = action.fields._assigned_to_user_id;
        } else if (action.fields.assigned_to_name) {
          // Try to resolve by name from members
          try {
            const { data: membersData } = await getWorkspaceMembers(activeWorkspace.workspace_id);
            const found = membersData.members.find(
              (m: any) => m.name.toLowerCase() === action.fields.assigned_to_name!.toLowerCase()
            );
            if (found) assignedToId = found.user_id;
          } catch {}
        }

        await createTask({
          workspace_id: activeWorkspace.workspace_id,
          title: action.fields.title || 'New Task',
          description: action.fields.description,
          priority: action.fields.priority,
          assigned_to: assignedToId,
          status: action.fields.status,
        });
      } else if (action.type === 'update' && action.task_id) {
        // Resolve assigned_to if needed
        let assignedToId: number | null | undefined = undefined;
        if (action.fields._assigned_to_user_id) {
          assignedToId = action.fields._assigned_to_user_id;
        } else if (action.fields.assigned_to_name) {
          try {
            const { data: membersData } = await getWorkspaceMembers(activeWorkspace.workspace_id);
            const found = membersData.members.find(
              (m: any) => m.name.toLowerCase() === action.fields.assigned_to_name!.toLowerCase()
            );
            if (found) assignedToId = found.user_id;
          } catch {}
        }

        const updatePayload: any = {};
        if (action.fields.title !== undefined) updatePayload.title = action.fields.title;
        if (action.fields.description !== undefined) updatePayload.description = action.fields.description;
        if (action.fields.priority !== undefined) updatePayload.priority = action.fields.priority;
        if (action.fields.status !== undefined) updatePayload.status = action.fields.status;
        if (assignedToId !== undefined) updatePayload.assigned_to = assignedToId;

        if (action.fields.status && !action.fields.title && !action.fields.priority) {
          // status-only — use the lightweight status endpoint
          await updateTaskStatus(action.task_id, action.fields.status);
        } else {
          await updateTask(action.task_id, updatePayload);
        }
      }

      // Mark as confirmed
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIdx ? { ...m, actionStatus: 'confirmed', content: '✅ ' + m.content } : m
        )
      );
      // Notify parent to refresh tasks
      onTasksChanged?.();
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIdx
            ? {
                ...m,
                actionStatus: 'cancelled',
                content: `❌ Failed: ${err?.response?.data?.message || 'Could not complete action.'}`,
                isError: true,
              }
            : m
        )
      );
    } finally {
      setConfirmingIdx(null);
    }
  };

  const handleCancelAction = (msgIdx: number) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === msgIdx ? { ...m, actionStatus: 'cancelled', content: '↩ Action cancelled.' } : m
      )
    );
  };

  return (
    <>
      <button
        className="task-ai-fab"
        onClick={() => setIsOpen(!isOpen)}
        title="AI Assistant for Tasks"
      >
        <Bot size={22} />
      </button>

      {isOpen && (
        <div className="task-ai-panel">
          <div className="task-ai-header">
            <div className="task-ai-title">
              <Sparkles size={18} />
              <span>Task AI Assistant</span>
            </div>
            <button className="task-ai-close" onClick={() => setIsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="task-ai-messages">
            {messages.length === 0 && (
              <div className="task-ai-empty">
                <CheckSquare size={32} />
                <p>Ask me anything about your tasks</p>
                <div className="task-ai-suggestions">
                  {TASK_SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => handleAsk(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`task-ai-msg ${msg.role} ${msg.isError ? 'error' : ''}`}>
                {msg.isError && <AlertCircle size={14} className="task-ai-error-icon" />}
                <div className="task-ai-msg-content">
                  {msg.role === 'assistant' ? (
                    <FormattedAIMessage content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>

                {/* Action preview card */}
                {msg.action && msg.actionStatus === 'pending' && (
                  <div className="task-ai-action-card">
                    <div className="task-ai-action-label">
                      <CheckSquare size={13} />
                      <span>
                        {msg.action.type === 'create' ? 'Create Task' : `Update Task #${msg.action.task_id}`}
                      </span>
                    </div>
                    <div className="task-ai-action-fields">
                      {msg.action.fields.title && (
                        <div><span>Title:</span> {msg.action.fields.title}</div>
                      )}
                      {msg.action.fields.priority && (
                        <div><span>Priority:</span> {msg.action.fields.priority}</div>
                      )}
                      {msg.action.fields.status && (
                        <div><span>Status:</span> {msg.action.fields.status.replace('_', ' ')}</div>
                      )}
                      {msg.action.fields.assigned_to_name && (
                        <div><span>Assignee:</span> {msg.action.fields.assigned_to_name}</div>
                      )}
                    </div>
                    <div className="task-ai-action-buttons">
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => handleCancelAction(i)}
                        disabled={confirmingIdx === i}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleConfirmAction(i, msg.action!)}
                        disabled={confirmingIdx === i}
                      >
                        {confirmingIdx === i ? (
                          <><Loader2 size={12} className="spin" /> Applying…</>
                        ) : (
                          <><CheckCircle2 size={12} /> Confirm</>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="task-ai-msg assistant loading">
                <Loader2 size={14} className="spin" />
                <span>Thinking…</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            className="task-ai-input"
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk(input);
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your tasks…"
              disabled={isLoading}
            />
            <button type="submit" disabled={!input.trim() || isLoading}>
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export default TaskAIAssistant;
