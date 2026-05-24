import React, { useState, useEffect } from 'react';
import { CheckSquare, Plus, ArrowUpCircle, Clock, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { getTasks, createTask, updateTaskStatus, type Task } from '../../api/tasks';
import { getWorkspaceMembers } from '../../api/workspaces';
import { emitTaskAssigned } from '../../socket/socketManager';
import { formatDistanceToNow } from 'date-fns';
import './TaskBoard.css';

const TaskBoard: React.FC = () => {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [assignedTo, setAssignedTo] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    if (activeWorkspace) {
      getTasks(activeWorkspace.workspace_id)
        .then(({ data }) => setTasks(data.tasks))
        .catch(console.error);
      
      getWorkspaceMembers(activeWorkspace.workspace_id)
        .then(({ data }) => setMembers(data.members))
        .catch(console.error);
    }
  }, [activeWorkspace]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !activeWorkspace) return;
    try {
      await createTask({
        workspace_id: activeWorkspace.workspace_id,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        priority: newPriority,
        assigned_to: assignedTo || undefined,
      });
      const { data } = await getTasks(activeWorkspace.workspace_id);
      setTasks(data.tasks);
      
      if (assignedTo && assignedTo !== user?.user_id) {
        emitTaskAssigned({
          assigned_to: assignedTo,
          task_title: newTitle.trim(),
          workspace_name: activeWorkspace.name,
          assigned_by: user?.name || 'A team member'
        });
      }

      setNewTitle('');
      setNewDesc('');
      setAssignedTo(null);
      setShowCreate(false);
    } catch (err) {
      console.error('Create task failed:', err);
    }
  };

  const handleStatusChange = async (taskId: number, status: string) => {
    try {
      await updateTaskStatus(taskId, status);
      setTasks((prev) => prev.map((t) => t.task_id === taskId ? { ...t, status: status as Task['status'] } : t));
    } catch (err) {
      console.error('Update status failed:', err);
    }
  };

  const filteredTasks = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);
  const columns = {
    pending: filteredTasks.filter((t) => t.status === 'pending'),
    in_progress: filteredTasks.filter((t) => t.status === 'in_progress'),
    completed: filteredTasks.filter((t) => t.status === 'completed'),
  };

  const statusNext: Record<string, string> = {
    pending: 'in_progress',
    in_progress: 'completed',
    completed: 'pending',
  };

  const priorityIcon = (p: string) => {
    if (p === 'high') return <AlertTriangle size={14} className="priority-high" />;
    if (p === 'medium') return <Clock size={14} className="priority-medium" />;
    return <ArrowUpCircle size={14} className="priority-low" />;
  };

  const renderColumn = (title: string, icon: React.ReactNode, statusKey: string, items: Task[], statusClass: string) => (
    <div className="task-column">
      <div className="task-column-header">
        {icon}
        <span>{title}</span>
        <span className="task-count">{items.length}</span>
      </div>
      <div className="task-column-body">
        {items.map((task) => (
          <div key={task.task_id} className="task-card card">
            <div className="task-card-header">
              {priorityIcon(task.priority)}
              <span className={`status-tag status-${task.status.replace('_', '-')}`}>{task.status.replace('_', ' ')}</span>
            </div>
            <h4 className="task-title">{task.title}</h4>
            {task.description && <p className="task-desc">{task.description}</p>}
            <div className="task-card-footer">
              <span className="task-meta">by {task.created_by_name}</span>
              {task.assigned_to_name && (
                <span className="task-meta">→ {task.assigned_to_name}</span>
              )}
              {(activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin' || task.assigned_to === user?.user_id || task.created_by === user?.user_id) && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => handleStatusChange(task.task_id, statusNext[task.status])}
                >
                  Move →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="task-board">
      <div className="task-board-header">
        <div className="task-board-title">
          <CheckSquare size={20} />
          <h3>Tasks</h3>
        </div>
        <div className="task-board-actions">
          <div className="task-filters">
            {(['all', 'pending', 'in_progress', 'completed'] as const).map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f.replace('_', ' ')}
              </button>
            ))}
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New Task
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Task</h3>
              <button className="btn-icon" onClick={() => setShowCreate(false)}><X size={18} /></button>
            </div>
            <div className="form-group">
              <label>Title</label>
              <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Task title" />
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Description</label>
              <textarea className="textarea" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Optional description..." />
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Assign To</label>
              <select 
                className="input" 
                value={assignedTo || ''} 
                onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Unassigned</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>{m.name} ({m.email})</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Priority</label>
              <div className="task-priority-selector">
                {(['low', 'medium', 'high'] as const).map((p) => (
                  <button
                    key={p}
                    className={`btn btn-sm ${newPriority === p ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setNewPriority(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-md btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-md btn-primary" onClick={handleCreate}>Create Task</button>
            </div>
          </div>
        </div>
      )}

      <div className="task-columns">
        {renderColumn('Pending', <Clock size={16} className="priority-medium" />, 'pending', columns.pending, 'status-pending')}
        {renderColumn('In Progress', <ArrowUpCircle size={16} style={{ color: 'var(--accent-secondary)' }} />, 'in_progress', columns.in_progress, 'status-in-progress')}
        {renderColumn('Completed', <CheckCircle2 size={16} className="priority-low" />, 'completed', columns.completed, 'status-completed')}
      </div>
    </div>
  );
};

export default TaskBoard;
