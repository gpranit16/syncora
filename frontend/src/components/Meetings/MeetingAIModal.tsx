import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  FileText,
  CheckCircle2,
  ListTodo,
  AlertOctagon,
  Calendar,
  Copy,
  Check,
  RefreshCw,
  Plus,
  Search,
  User,
  Clock,
  ExternalLink,
  Bot
} from 'lucide-react';
import {
  getMeetingTranscript,
  getMeetingSummary,
  generateMeetingSummary,
  convertActionItemToTask,
  MeetingTranscript,
  MeetingSummary,
  MeetingActionItem
} from '../../api/meetingAI';
import { getWorkspaceMembers } from '../../api/workspaces';
import './MeetingAIModal.css';

interface MeetingAIModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingCode: string;
  meetingTitle?: string;
  workspaceId: number;
  initialTab?: 'summary' | 'transcript';
}

interface WorkspaceMember {
  user_id: number;
  name: string;
  email: string;
  avatar?: string;
}

export const MeetingAIModal: React.FC<MeetingAIModalProps> = ({
  isOpen,
  onClose,
  meetingCode,
  meetingTitle = 'Syncora Meeting',
  workspaceId,
  initialTab = 'summary',
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript'>(initialTab);
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'hi' | 'same'>('en');

  const [transcript, setTranscript] = useState<MeetingTranscript | null>(null);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState('');

  // Workspace members for task creation assignment
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  // Action item to task modal state
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [selectedActionItem, setSelectedActionItem] = useState<MeetingActionItem | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskAssigneeId, setTaskAssigneeId] = useState<number | null>(null);
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [createdActionTitles, setCreatedActionTitles] = useState<Set<string>>(new Set());
  const [taskSuccessMsg, setTaskSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      loadTranscript();
      loadSummary(selectedLanguage);
      loadWorkspaceMembers();
    }
  }, [isOpen, meetingCode]);

  useEffect(() => {
    if (isOpen) {
      loadSummary(selectedLanguage);
    }
  }, [selectedLanguage]);

  const loadWorkspaceMembers = async () => {
    if (!workspaceId) return;
    try {
      const res = await getWorkspaceMembers(workspaceId);
      if (res.data?.members) {
        setMembers(res.data.members);
      }
    } catch (err) {
      console.error('Failed to load workspace members for task assignment:', err);
    }
  };

  const loadTranscript = async (retryCount = 0) => {
    setLoadingTranscript(true);
    try {
      const data = await getMeetingTranscript(meetingCode);
      if (data && data.transcript_text) {
        setTranscript(data);
      } else if (retryCount < 2) {
        setTimeout(() => {
          loadTranscript(retryCount + 1);
        }, 1200);
        return;
      } else {
        setTranscript(data);
      }
    } catch (err) {
      console.error('Failed to load meeting transcript:', err);
    } finally {
      setLoadingTranscript(false);
    }
  };

  const loadSummary = async (lang: 'en' | 'hi' | 'same', forceRegenerate = false) => {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      if (!forceRegenerate) {
        const existing = await getMeetingSummary(meetingCode, lang);
        if (existing && existing.summary_text && !existing.summary_text.includes('could not be structured')) {
          setSummary(existing);
          setLoadingSummary(false);
          return;
        }
      }

      // If no valid cached summary or force regenerate, generate via AI
      const result = await generateMeetingSummary(meetingCode, {
        language: lang,
        force_regenerate: true,
      });
      setSummary(result.summary);
    } catch (err: any) {
      console.error('Failed to fetch/generate meeting summary:', err);
      setSummaryError(err.response?.data?.message || 'Failed to generate meeting summary. Please try again.');
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleCopyTranscript = () => {
    if (!transcript?.transcript_text) return;
    navigator.clipboard.writeText(transcript.transcript_text);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  const openTaskModal = (item: MeetingActionItem) => {
    setSelectedActionItem(item);
    setTaskTitle(item.title);
    setTaskDescription(
      item.source
        ? `Action item from meeting "${meetingTitle}": ${item.source}`
        : `Action item extracted from meeting "${meetingTitle}"`
    );

    // Try to auto-match assignee from members list
    let matchedUserId: number | null = null;
    if (item.assignee && members.length > 0) {
      const cleanAssignee = item.assignee.toLowerCase().trim();
      const matched = members.find(
        (m) =>
          m.name.toLowerCase().includes(cleanAssignee) ||
          cleanAssignee.includes(m.name.toLowerCase())
      );
      if (matched) matchedUserId = matched.user_id;
    }
    setTaskAssigneeId(matchedUserId);

    // Format deadline date if parseable
    let dueDateFormatted = '';
    if (item.deadline) {
      const lower = item.deadline.toLowerCase().trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
        dueDateFormatted = lower;
      } else {
        const now = new Date();
        if (lower === 'today') {
          dueDateFormatted = now.toISOString().split('T')[0];
        } else if (lower === 'tomorrow') {
          const tom = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          dueDateFormatted = tom.toISOString().split('T')[0];
        } else {
          const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const idx = days.findIndex((d) => lower.includes(d));
          if (idx !== -1) {
            const currentDay = now.getDay();
            let add = (idx - currentDay + 7) % 7;
            if (add === 0) add = 7;
            const target = new Date(now.getTime() + add * 24 * 60 * 60 * 1000);
            dueDateFormatted = target.toISOString().split('T')[0];
          }
        }
      }
    }
    setTaskDueDate(dueDateFormatted);
    setTaskPriority('medium');
    setTaskModalOpen(true);
    setTaskSuccessMsg(null);
  };

  const handleConfirmCreateTask = async () => {
    if (!taskTitle.trim() || !meetingCode) return;
    setCreatingTask(true);
    try {
      await convertActionItemToTask(meetingCode, {
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        assigned_to: taskAssigneeId || undefined,
        priority: taskPriority,
        due_date: taskDueDate || undefined,
      });

      if (selectedActionItem) {
        setCreatedActionTitles((prev) => new Set(prev).add(selectedActionItem.title));
      }
      setTaskSuccessMsg('Task created successfully in workspace board!');
      setTimeout(() => {
        setTaskModalOpen(false);
        setTaskSuccessMsg(null);
      }, 1200);
    } catch (err: any) {
      console.error('Failed to convert action item to task:', err);
      alert(err.response?.data?.message || 'Failed to create task');
    } finally {
      setCreatingTask(false);
    }
  };

  if (!isOpen) return null;

  // Filter transcript segments
  const filteredSegments = (transcript?.segments || []).filter((seg) => {
    if (!transcriptSearch.trim()) return true;
    const query = transcriptSearch.toLowerCase();
    return (
      (seg.speaker_name && seg.speaker_name.toLowerCase().includes(query)) ||
      (seg.text && seg.text.toLowerCase().includes(query))
    );
  });

  const cleanText = (text: string | undefined): string => {
    if (!text) return '';
    let s = text.trim();
    const lower = s.toLowerCase();
    if (
      lower.includes('i need to make sure') ||
      lower.includes('rule ') ||
      lower.includes('json is valid') ||
      lower.includes("i'll output []") ||
      lower.includes('i will output []') ||
      lower.includes('action_items') ||
      lower.includes('top-level') ||
      lower.includes('check constraints') ||
      /^(?:-\s*)?i (?:need to|must|should|will) (?:make sure|analyze|check|output|ensure)/i.test(s)
    ) {
      return selectedLanguage === 'hi'
        ? 'यह एक संक्षिप्त बातचीत / चेक-इन थी।'
        : 'Brief check-in / greeting with no substantive work items.';
    }
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    s = s.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
    s = s.replace(/^(?:I'll output|I will output|Here is (?:the )?(?:summary|output|response)|Output|Response|Sure, here is|Okay, here is|Here's (?:the )?(?:summary|output|response))\s*[:：]?\s*/i, '');
    s = s.replace(/^\{\s*"?summary"?\s*:\s*["']?/i, '');
    s = s.replace(/^"?summary"?\s*:\s*["']?/i, '');
    s = s.replace(/["']?\s*,\s*"?decisions"?\s*:\s*\[[\s\S]*$/i, '');
    s = s.replace(/["']?\s*,\s*"?action_items"?\s*:\s*\[[\s\S]*$/i, '');
    s = s.replace(/["']?\s*,\s*"?blockers"?\s*:\s*\[[\s\S]*$/i, '');
    s = s.replace(/["']?\s*\}?\s*$/i, '');
    s = s.replace(/^["'“]+|["'”]+$/g, '').trim();
    if (
      s.toLowerCase().includes('i need to make sure') ||
      s.toLowerCase().includes('rule ') ||
      /^(?:-\s*)?i (?:need to|must|should|will)/i.test(s)
    ) {
      return selectedLanguage === 'hi'
        ? 'यह एक संक्षिप्त बातचीत / चेक-इन थी।'
        : 'Brief check-in / greeting with no substantive work items.';
    }
    return s;
  };

  return (
    <div className="meeting-ai-overlay" onClick={onClose}>
      <div className="meeting-ai-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="meeting-ai-header">
          <div className="meeting-ai-header-main">
            <div className="meeting-ai-header-info">
              <div className="meeting-ai-badge">
                <Sparkles size={14} className="sparkle-icon" />
                <span>Meeting Intelligence</span>
              </div>
              <h2 className="meeting-ai-title">{meetingTitle}</h2>
              <span className="meeting-ai-code">Room: {meetingCode}</span>
            </div>

            <button className="meeting-ai-close-btn mobile-close" onClick={onClose} aria-label="Close modal">
              <X size={20} />
            </button>
          </div>

          <div className="meeting-ai-header-tabs">
            <button
              className={`meeting-ai-tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              <Bot size={16} />
              <span>AI Summary</span>
            </button>
            <button
              className={`meeting-ai-tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
              onClick={() => setActiveTab('transcript')}
            >
              <FileText size={16} />
              <span>Transcript</span>
            </button>
          </div>

          <button className="meeting-ai-close-btn desktop-close" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="meeting-ai-body">
          {/* TAB 1: SUMMARY */}
          {activeTab === 'summary' && (
            <div className="meeting-ai-summary-tab">
              {/* Controls bar */}
              <div className="meeting-ai-controls-bar">
                <div className="meeting-ai-lang-selector">
                  <label htmlFor="summary-lang">Language:</label>
                  <select
                    id="summary-lang"
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value as any)}
                    disabled={loadingSummary}
                  >
                    <option value="en">🇬🇧 English</option>
                    <option value="hi">🇮🇳 Hindi (हिन्दी)</option>
                    <option value="same">🌐 Same as Meeting</option>
                  </select>
                </div>

                <button
                  className="meeting-ai-regen-btn"
                  onClick={() => loadSummary(selectedLanguage, true)}
                  disabled={loadingSummary}
                >
                  <RefreshCw size={14} className={loadingSummary ? 'spin' : ''} />
                  <span>{loadingSummary ? 'Analyzing...' : 'Regenerate Summary'}</span>
                </button>
              </div>

              {loadingSummary && (
                <div className="meeting-ai-loading">
                  <div className="ai-pulse-ring">
                    <Sparkles size={24} />
                  </div>
                  <p>Nemotron 30B is analyzing meeting discussion and extracting insights...</p>
                </div>
              )}

              {summaryError && !loadingSummary && (
                <div className="meeting-ai-error-box">
                  <AlertOctagon size={18} />
                  <span>{summaryError}</span>
                  <button onClick={() => loadSummary(selectedLanguage, true)}>Try Again</button>
                </div>
              )}

              {!loadingSummary && summary && (
                <div className="meeting-ai-summary-content">
                  {/* Executive Summary Card */}
                  <div className="meeting-ai-card summary-card">
                    <div className="meeting-ai-card-header">
                      <Sparkles size={16} />
                      <h3>Executive Summary</h3>
                    </div>
                    <p className="summary-paragraph">{cleanText(summary.summary_text)}</p>
                  </div>

                  {/* Two-column layout for Action Items & Decisions */}
                  <div className="meeting-ai-grid-2">
                    {/* Decisions */}
                    <div className="meeting-ai-card">
                      <div className="meeting-ai-card-header text-success">
                        <CheckCircle2 size={16} />
                        <h3>Decisions</h3>
                      </div>
                      {summary.decisions && summary.decisions.length > 0 ? (
                        <ul className="decisions-list">
                          {summary.decisions.map((dec, idx) => (
                            <li key={idx} className="decision-item">
                              <span className="bullet-dot">✓</span>
                              <span>{dec}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="empty-category-text">No decisions recorded.</p>
                      )}
                    </div>

                    {/* Action Items */}
                    <div className="meeting-ai-card">
                      <div className="meeting-ai-card-header text-primary">
                        <ListTodo size={16} />
                        <h3>Action Items</h3>
                      </div>
                      {summary.action_items && summary.action_items.length > 0 ? (
                        <div className="action-items-list">
                          {summary.action_items.map((item, idx) => {
                            const isCreated = createdActionTitles.has(item.title);
                            return (
                              <div key={idx} className="action-item-card">
                                <div className="action-item-main">
                                  <div className="action-item-title-row">
                                    <span className="action-item-title">{item.title}</span>
                                  </div>
                                  <div className="action-item-pills">
                                    {item.assignee && (
                                      <span className="action-pill assignee">
                                        <User size={12} />
                                        {item.assignee}
                                      </span>
                                    )}
                                    {item.deadline && (
                                      <span className="action-pill deadline">
                                        <Clock size={12} />
                                        {item.deadline}
                                      </span>
                                    )}
                                  </div>
                                  {item.source && (
                                    <p className="action-item-source">"{item.source}"</p>
                                  )}
                                </div>
                                <button
                                  className={`action-create-task-btn ${isCreated ? 'created' : ''}`}
                                  onClick={() => !isCreated && openTaskModal(item)}
                                  disabled={isCreated}
                                >
                                  {isCreated ? (
                                    <>
                                      <Check size={13} />
                                      <span>Task Created</span>
                                    </>
                                  ) : (
                                    <>
                                      <Plus size={13} />
                                      <span>Create Task</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="empty-category-text">No action items identified.</p>
                      )}
                    </div>
                  </div>

                  {/* Two-column layout for Blockers & Deadlines */}
                  <div className="meeting-ai-grid-2">
                    {/* Blockers */}
                    <div className="meeting-ai-card">
                      <div className="meeting-ai-card-header text-warning">
                        <AlertOctagon size={16} />
                        <h3>Blockers</h3>
                      </div>
                      {summary.blockers && summary.blockers.length > 0 ? (
                        <ul className="blockers-list">
                          {summary.blockers.map((blk, idx) => (
                            <li key={idx} className="blocker-item">
                              <span className="bullet-warning">!</span>
                              <span>{blk}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="empty-category-text">No blockers identified.</p>
                      )}
                    </div>

                    {/* Deadlines */}
                    <div className="meeting-ai-card">
                      <div className="meeting-ai-card-header text-info">
                        <Calendar size={16} />
                        <h3>Deadlines</h3>
                      </div>
                      {summary.deadlines && summary.deadlines.length > 0 ? (
                        <ul className="deadlines-list">
                          {summary.deadlines.map((dln, idx) => (
                            <li key={idx} className="deadline-item">
                              <span className="bullet-info">📅</span>
                              <span>{dln}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="empty-category-text">No deadlines recorded.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: TRANSCRIPT */}
          {activeTab === 'transcript' && (
            <div className="meeting-ai-transcript-tab">
              <div className="transcript-toolbar">
                <div className="transcript-search-box">
                  <Search size={15} />
                  <input
                    type="text"
                    placeholder="Search spoken words or speakers..."
                    value={transcriptSearch}
                    onChange={(e) => setTranscriptSearch(e.target.value)}
                  />
                </div>
                {transcript?.transcript_text && (
                  <button className="btn-copy-transcript" onClick={handleCopyTranscript}>
                    {copiedTranscript ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedTranscript ? 'Copied' : 'Copy All'}</span>
                  </button>
                )}
              </div>

              {loadingTranscript && (
                <div className="meeting-ai-loading">
                  <div className="ai-pulse-ring">
                    <FileText size={24} />
                  </div>
                  <p>Loading meeting transcript...</p>
                </div>
              )}

              {!loadingTranscript && (!transcript || !transcript.transcript_text) && (
                <div className="transcript-empty">
                  <FileText size={40} className="empty-icon" />
                  <h4>No Transcript Recorded</h4>
                  <p>
                    Transcripts are captured automatically from participants speaking in voice/video meetings.
                  </p>
                </div>
              )}

              {!loadingTranscript && transcript && transcript.transcript_text && (
                <div className="transcript-scroll-area">
                  {filteredSegments.length > 0 ? (
                    filteredSegments.map((seg, idx) => {
                      const timeDisplay = seg.timestamp
                        ? new Date(seg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '';
                      return (
                        <div key={idx} className="transcript-bubble">
                          <div className="speaker-avatar">
                            {(seg.speaker_name || 'S').charAt(0).toUpperCase()}
                          </div>
                          <div className="transcript-bubble-content">
                            <div className="speaker-header">
                              <span className="speaker-name">{seg.speaker_name || 'Speaker'}</span>
                              {timeDisplay && <span className="speaker-time">{timeDisplay}</span>}
                            </div>
                            <p className="spoken-text">{seg.text}</p>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="raw-transcript-box">
                      <pre>{transcript.transcript_text}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* SUB-MODAL: Action Item -> Task Confirmation */}
        {taskModalOpen && (
          <div className="task-confirm-overlay" onClick={() => setTaskModalOpen(false)}>
            <div className="task-confirm-modal" onClick={(e) => e.stopPropagation()}>
              <div className="task-confirm-header">
                <div className="task-confirm-title-icon">
                  <ListTodo size={18} />
                  <h3>Create Workspace Task</h3>
                </div>
                <button className="btn-icon-close" onClick={() => setTaskModalOpen(false)}>
                  <X size={16} />
                </button>
              </div>

              <div className="task-confirm-body">
                {taskSuccessMsg && (
                  <div className="task-success-banner">
                    <CheckCircle2 size={16} />
                    <span>{taskSuccessMsg}</span>
                  </div>
                )}

                <div className="form-group">
                  <label>Task Title *</label>
                  <input
                    type="text"
                    className="task-input"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="Task title"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Assignee</label>
                  <select
                    className="task-select"
                    value={taskAssigneeId || ''}
                    onChange={(e) => setTaskAssigneeId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name} ({m.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Priority</label>
                    <select
                      className="task-select"
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value as any)}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Due Date</label>
                    <input
                      type="date"
                      className="task-input"
                      value={taskDueDate}
                      onChange={(e) => setTaskDueDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Description & Context</label>
                  <textarea
                    className="task-textarea"
                    rows={3}
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    placeholder="Task details"
                  />
                </div>
              </div>

              <div className="task-confirm-footer">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setTaskModalOpen(false)}
                  disabled={creatingTask}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleConfirmCreateTask}
                  disabled={creatingTask || !taskTitle.trim()}
                >
                  {creatingTask ? 'Creating...' : 'Confirm & Create Task'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
