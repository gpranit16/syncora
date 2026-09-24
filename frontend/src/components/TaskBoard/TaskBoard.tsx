import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckSquare,
  Plus,
  ArrowUpCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
  MessageSquare,
  User as UserIcon,
  UserCheck,
  Search,
  Trash2,
  Edit2,
  Calendar,
  Sparkles,
  ChevronRight,
  Filter
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  getTasks,
  createTask,
  updateTask,
  updateTaskStatus,
  deleteTask,
  type Task
} from '../../api/tasks';
import { getWorkspaceMembers } from '../../api/workspaces';
import { emitTaskAssigned } from '../../socket/socketManager';
import TaskAIAssistant from '../TaskAIAssistant/TaskAIAssistant';
import './TaskBoard.css';

type TaskScope = 'assigned_to_me' | 'all' | 'created_by_me' | 'unassigned';
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed';

const TaskBoard: React.FC = () => {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  // Scope filter — default to "assigned_to_me" so signed-in user immediately sees their tasks!
  const [scope, setScope] = useState<TaskScope>('assigned_to_me');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Create Task state
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState<number | null>(null);

  // Edit Task state
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPriority, setEditPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [editDueDate, setEditDueDate] = useState('');
  const [editAssignedTo, setEditAssignedTo] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<'pending' | 'in_progress' | 'completed'>('pending');

  const [members, setMembers] = useState<any[]>([]);

  const loadTasks = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const { data } = await getTasks(activeWorkspace.workspace_id);
      if (data?.tasks) {
        setTasks(data.tasks);
      }
    } catch (err) {
      console.error('Load tasks failed:', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    if (activeWorkspace) {
      loadTasks();
      getWorkspaceMembers(activeWorkspace.workspace_id)
        .then(({ data }) => setMembers(data.members || []))
        .catch(console.error);
    }
  }, [activeWorkspace, loadTasks]);

  // Open Create Modal and optionally pre-assign
  const handleOpenCreate = (preAssignToSelf = false) => {
    setNewTitle('');
    setNewDesc('');
    setNewPriority('medium');
    setNewDueDate('');
    setAssignedTo(preAssignToSelf && user ? user.user_id : null);
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!newTitle.trim() || !activeWorkspace) return;
    try {
      const res = await createTask({
        workspace_id: activeWorkspace.workspace_id,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        priority: newPriority,
        assigned_to: assignedTo,
        due_date: newDueDate || undefined,
      });

      await loadTasks();

      if (assignedTo && assignedTo !== user?.user_id) {
        emitTaskAssigned({
          assigned_to: assignedTo,
          task_title: newTitle.trim(),
          workspace_name: activeWorkspace.name,
          assigned_by: user?.name || 'A team member',
        });
      }

      setShowCreate(false);
    } catch (err) {
      console.error('Create task failed:', err);
    }
  };

  // Open Edit Modal
  const handleOpenEdit = (task: Task) => {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
    setEditPriority(task.priority);
    setEditDueDate(task.due_date ? task.due_date.split('T')[0] : '');
    setEditAssignedTo(task.assigned_to);
    setEditStatus(task.status);
  };

  const handleUpdate = async () => {
    if (!editingTask || !editTitle.trim()) return;
    try {
      await updateTask(editingTask.task_id, {
        title: editTitle.trim(),
        description: editDesc.trim() || undefined,
        priority: editPriority,
        status: editStatus,
        due_date: editDueDate || null,
        assigned_to: editAssignedTo,
      });

      if (editAssignedTo && editAssignedTo !== editingTask.assigned_to && editAssignedTo !== user?.user_id && activeWorkspace) {
        emitTaskAssigned({
          assigned_to: editAssignedTo,
          task_title: editTitle.trim(),
          workspace_name: activeWorkspace.name,
          assigned_by: user?.name || 'A team member',
        });
      }

      await loadTasks();
      setEditingTask(null);
    } catch (err) {
      console.error('Update task failed:', err);
    }
  };

  const handleDelete = async (taskId: number) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteTask(taskId);
      setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
    } catch (err) {
      console.error('Delete task failed:', err);
    }
  };

  // Quick claim task
  const handleClaimTask = async (taskId: number) => {
    if (!user) return;
    try {
      await updateTask(taskId, { assigned_to: user.user_id });
      setTasks((prev) =>
        prev.map((t) =>
          t.task_id === taskId
            ? { ...t, assigned_to: user.user_id, assigned_to_name: user.name }
            : t
        )
      );
    } catch (err) {
      console.error('Claim task failed:', err);
    }
  };

  const handleStatusChange = async (taskId: number, nextStatus: Task['status']) => {
    try {
      await updateTaskStatus(taskId, nextStatus);
      setTasks((prev) =>
        prev.map((t) => (t.task_id === taskId ? { ...t, status: nextStatus } : t))
      );
    } catch (err) {
      console.error('Update status failed:', err);
    }
  };

  // Counts for each scope view
  const myAssignedCount = useMemo(
    () => tasks.filter((t) => t.assigned_to === user?.user_id).length,
    [tasks, user]
  );
  const myCreatedCount = useMemo(
    () => tasks.filter((t) => t.created_by === user?.user_id).length,
    [tasks, user]
  );
  const unassignedCount = useMemo(
    () => tasks.filter((t) => !t.assigned_to).length,
    [tasks]
  );

  // Filter tasks by scope, status, and search query
  const scopedTasks = useMemo(() => {
    let list = tasks;

    if (scope === 'assigned_to_me') {
      list = list.filter((t) => t.assigned_to === user?.user_id);
    } else if (scope === 'created_by_me') {
      list = list.filter((t) => t.created_by === user?.user_id);
    } else if (scope === 'unassigned') {
      list = list.filter((t) => !t.assigned_to);
    }

    if (statusFilter !== 'all') {
      list = list.filter((t) => t.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.assigned_to_name && t.assigned_to_name.toLowerCase().includes(q)) ||
          (t.created_by_name && t.created_by_name.toLowerCase().includes(q))
      );
    }

    return list;
  }, [tasks, scope, statusFilter, searchQuery, user]);

  const columns = useMemo(() => ({
    pending: scopedTasks.filter((t) => t.status === 'pending'),
    in_progress: scopedTasks.filter((t) => t.status === 'in_progress'),
    completed: scopedTasks.filter((t) => t.status === 'completed'),
  }), [scopedTasks]);

  const statusNextMap: Record<string, Task['status']> = {
    pending: 'in_progress',
    in_progress: 'completed',
    completed: 'pending',
  };

  const priorityIcon = (p: string) => {
    if (p === 'high') return <AlertTriangle size={14} className="priority-high" />;
    if (p === 'medium') return <Clock size={14} className="priority-medium" />;
    return <ArrowUpCircle size={14} className="priority-low" />;
  };

  const isOverdue = (dueDateStr: string | null, status: string) => {
    if (!dueDateStr || status === 'completed') return false;
    const due = new Date(dueDateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return due < now;
  };

  const renderColumn = (
    title: string,
    icon: React.ReactNode,
    statusKey: Task['status'],
    items: Task[],
    statusClass: string
  ) => (
    <div className="task-column">
      <div className="task-column-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon}
          <span>{title}</span>
        </div>
        <span className="task-count">{items.length}</span>
      </div>
      <div className="task-column-body">
        {items.length === 0 ? (
          <div className="task-empty-column">
            <CheckSquare size={20} className="empty-col-icon" />
            <p>No {title.toLowerCase()} tasks</p>
          </div>
        ) : (
          items.map((task) => {
            const isAssignedToMe = task.assigned_to === user?.user_id;
            const isCreatedByMe = task.created_by === user?.user_id;
            const canManage =
              isAssignedToMe ||
              isCreatedByMe ||
              activeWorkspace?.role === 'owner' ||
              activeWorkspace?.role === 'admin';
            const overdue = isOverdue(task.due_date, task.status);

            return (
              <div
                key={task.task_id}
                className={`task-card card ${isAssignedToMe ? 'task-card-mine' : ''}`}
              >
                <div className="task-card-header">
                  <div className="task-badges-left">
                    {priorityIcon(task.priority)}
                    <span className={`priority-tag priority-${task.priority}`}>
                      {task.priority}
                    </span>
                    {isAssignedToMe && (
                      <span className="task-mine-badge" title="Assigned to you">
                        <UserCheck size={11} /> You
                      </span>
                    )}
                  </div>

                  <div className="task-card-top-actions">
                    {canManage && (
                      <>
                        <button
                          type="button"
                          className="btn-icon-subtle"
                          title="Edit Task"
                          onClick={() => handleOpenEdit(task)}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-subtle btn-icon-danger"
                          title="Delete Task"
                          onClick={() => handleDelete(task.task_id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <h4 className="task-title">{task.title}</h4>
                {task.description && <p className="task-desc">{task.description}</p>}

                {/* Source message reference */}
                {task.source_message_id && task.source_message_type && (
                  <div
                    className="task-source-ref"
                    title={`Created from a ${task.source_message_type} message`}
                  >
                    <MessageSquare size={11} />
                    <span>From {task.source_message_type === 'channel' ? 'Channel' : 'DM'}</span>
                  </div>
                )}

                {/* Due Date & Assignment Meta */}
                <div className="task-meta-row">
                  {task.due_date && (
                    <span className={`task-due-badge ${overdue ? 'task-overdue' : ''}`}>
                      <Calendar size={11} />
                      {overdue ? 'Overdue: ' : 'Due: '}
                      {new Date(task.due_date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )}

                  {task.assigned_to_name ? (
                    <span
                      className={`task-assignee-pill ${isAssignedToMe ? 'assignee-me' : ''}`}
                      title={`Assigned to ${task.assigned_to_name}`}
                    >
                      <UserIcon size={11} />
                      {isAssignedToMe ? 'Assigned to You' : task.assigned_to_name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="task-claim-btn"
                      onClick={() => handleClaimTask(task.task_id)}
                      title="Assign this task to yourself"
                    >
                      <Plus size={11} /> Claim Task
                    </button>
                  )}
                </div>

                <div className="task-card-footer">
                  <span className="task-created-meta">
                    by {isCreatedByMe ? 'You' : task.created_by_name}
                  </span>

                  {canManage && (
                    <button
                      type="button"
                      className="btn-advance-status"
                      onClick={() => handleStatusChange(task.task_id, statusNextMap[task.status])}
                      title={`Move to ${statusNextMap[task.status].replace('_', ' ')}`}
                    >
                      <span>Move to {statusNextMap[task.status].replace('_', ' ')}</span>
                      <ChevronRight size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="task-board">
      {/* Top Header */}
      <div className="task-board-header">
        <div className="task-board-title-section">
          <div className="task-board-title">
            <CheckSquare size={20} className="task-header-icon" />
            <div>
              <h3>Tasks</h3>
              <p className="task-subtitle">
                {activeWorkspace ? activeWorkspace.name : 'Workspace'} Task Management
              </p>
            </div>
          </div>

          {/* Quick Primary Scope Selector: Assigned to Me vs All vs Created by Me */}
          <div className="task-scope-tabs">
            <button
              type="button"
              className={`task-scope-tab ${scope === 'assigned_to_me' ? 'active' : ''}`}
              onClick={() => setScope('assigned_to_me')}
            >
              <UserCheck size={14} />
              <span>Assigned to Me</span>
              <span className="scope-count">{myAssignedCount}</span>
            </button>
            <button
              type="button"
              className={`task-scope-tab ${scope === 'all' ? 'active' : ''}`}
              onClick={() => setScope('all')}
            >
              <CheckSquare size={14} />
              <span>All Tasks</span>
              <span className="scope-count">{tasks.length}</span>
            </button>
            <button
              type="button"
              className={`task-scope-tab ${scope === 'created_by_me' ? 'active' : ''}`}
              onClick={() => setScope('created_by_me')}
            >
              <UserIcon size={14} />
              <span>Created by Me</span>
              <span className="scope-count">{myCreatedCount}</span>
            </button>
            <button
              type="button"
              className={`task-scope-tab ${scope === 'unassigned' ? 'active' : ''}`}
              onClick={() => setScope('unassigned')}
            >
              <span>Unassigned</span>
              <span className="scope-count">{unassignedCount}</span>
            </button>
          </div>
        </div>

        <div className="task-board-actions">
          {/* Search bar */}
          <div className="task-search-box">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="task-search-clear"
                onClick={() => setSearchQuery('')}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="task-filters">
            {(['all', 'pending', 'in_progress', 'completed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`task-filter-pill ${statusFilter === f ? 'active' : ''}`}
                onClick={() => setStatusFilter(f)}
              >
                {f === 'all' ? 'All' : f.replace('_', ' ')}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn-sm btn-primary task-new-btn"
            onClick={() => handleOpenCreate(true)}
          >
            <Plus size={15} /> New Task
          </button>
        </div>
      </div>

      {/* Main Board Columns */}
      <div className="task-columns">
        {renderColumn(
          'Pending',
          <Clock size={16} className="priority-medium" />,
          'pending',
          columns.pending,
          'status-pending'
        )}
        {renderColumn(
          'In Progress',
          <ArrowUpCircle size={16} style={{ color: 'var(--accent-secondary, #38bdf8)' }} />,
          'in_progress',
          columns.in_progress,
          'status-in-progress'
        )}
        {renderColumn(
          'Completed',
          <CheckCircle2 size={16} className="priority-low" style={{ color: '#22c55e' }} />,
          'completed',
          columns.completed,
          'status-completed'
        )}
      </div>

      {/* Create Task Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={18} className="text-accent" />
                <h3>Create New Task</h3>
              </div>
              <button type="button" className="btn-icon" onClick={() => setShowCreate(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="task-modal-body">
              <div className="form-group">
                <label>Task Title *</label>
                <input
                  className="input"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Implement authentication middleware"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="textarea"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Add details, requirements or acceptance criteria..."
                  rows={3}
                />
              </div>

              {/* Assignee selection with Quick 'Assign to Me' */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>Assign To</label>
                  {user && assignedTo !== user.user_id && (
                    <button
                      type="button"
                      className="task-quick-assign-me"
                      onClick={() => setAssignedTo(user.user_id)}
                    >
                      <UserCheck size={12} /> Assign to Myself
                    </button>
                  )}
                </div>
                <select
                  className="input"
                  value={assignedTo || ''}
                  onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name} {m.user_id === user?.user_id ? '(You)' : ''} — {m.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>Priority</label>
                  <div className="task-priority-selector">
                    {(['low', 'medium', 'high'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`btn btn-sm ${newPriority === p ? `priority-selected-${p}` : 'btn-ghost'}`}
                        onClick={() => setNewPriority(p)}
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
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-md btn-ghost"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-md btn-primary"
                onClick={handleCreate}
                disabled={!newTitle.trim()}
              >
                Create Task
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Task Modal */}
      {editingTask && (
        <div className="modal-overlay" onClick={() => setEditingTask(null)}>
          <div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Edit2 size={18} className="text-accent" />
                <h3>Edit Task</h3>
              </div>
              <button type="button" className="btn-icon" onClick={() => setEditingTask(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="task-modal-body">
              <div className="form-group">
                <label>Task Title *</label>
                <input
                  className="input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  className="textarea"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>Assign To</label>
                  {user && editAssignedTo !== user.user_id && (
                    <button
                      type="button"
                      className="task-quick-assign-me"
                      onClick={() => setEditAssignedTo(user.user_id)}
                    >
                      <UserCheck size={12} /> Assign to Myself
                    </button>
                  )}
                </div>
                <select
                  className="input"
                  value={editAssignedTo || ''}
                  onChange={(e) => setEditAssignedTo(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name} {m.user_id === user?.user_id ? '(You)' : ''} — {m.email}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>Status</label>
                  <select
                    className="input"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as any)}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Priority</label>
                  <div className="task-priority-selector">
                    {(['low', 'medium', 'high'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`btn btn-sm ${editPriority === p ? `priority-selected-${p}` : 'btn-ghost'}`}
                        onClick={() => setEditPriority(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Due Date</label>
                <input
                  className="input"
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-md btn-ghost"
                onClick={() => setEditingTask(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-md btn-primary"
                onClick={handleUpdate}
                disabled={!editTitle.trim()}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task AI Assistant */}
      <TaskAIAssistant onTasksChanged={loadTasks} />
    </div>
  );
};

export default TaskBoard;

