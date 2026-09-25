import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMeeting } from '../../api/meetings';
import { Mic, Video, X, Sparkles, Loader2, Calendar, Clock, CheckCircle2 } from 'lucide-react';
import './MeetingModal.css';

interface StartMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: number;
  channelId?: number | null;
  channelName?: string;
}

export const StartMeetingModal: React.FC<StartMeetingModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  channelId,
  channelName,
}) => {
  const navigate = useNavigate();
  const [title, setTitle] = useState(channelName ? `#${channelName} Meeting` : 'Quick Team Sync');
  const [mode, setMode] = useState<'video' | 'voice'>('video');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState('');
  const [scheduledSuccess, setScheduledSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (isScheduled && !scheduledDateTime) {
      setError('Please select a date and time for the scheduled meeting');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const scheduledIso = isScheduled && scheduledDateTime ? new Date(scheduledDateTime).toISOString() : null;

      const meeting = await createMeeting({
        workspace_id: workspaceId,
        channel_id: channelId || null,
        title: title.trim(),
        mode,
        scheduled_start_time: scheduledIso,
      });

      const meetingCode = meeting?.meeting_code || (meeting as any)?.meetingCode;

      if (isScheduled) {
        setScheduledSuccess('Meeting scheduled and synced to Google Calendar!');
        setTimeout(() => {
          onClose();
        }, 1800);
      } else if (meetingCode) {
        onClose();
        navigate(`/meet/${meetingCode}`);
      } else {
        throw new Error('No meeting code returned from server');
      }
    } catch (err: any) {
      console.error('Failed to create meeting:', err);
      const serverMsg = err?.response?.data?.message || err?.message || 'Failed to create meeting';
      setError(serverMsg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="meeting-modal-backdrop" onClick={onClose}>
      <div className="meeting-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="meeting-modal-header">
          <div className="meeting-modal-title-group">
            <div className="meeting-modal-icon-badge">
              <Sparkles size={20} className="meeting-badge-sparkle" />
            </div>
            <div>
              <h3>{isScheduled ? 'Schedule a Meeting' : 'Start a Meeting'}</h3>
              <p className="meeting-modal-subtitle">
                {channelName ? `In #${channelName}` : 'Syncora workspace meeting'}
              </p>
            </div>
          </div>
          <button className="meeting-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {scheduledSuccess ? (
          <div style={{ textAlign: 'center', padding: '30px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <CheckCircle2 size={44} style={{ color: '#10b981' }} />
            <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#fff' }}>Meeting Scheduled!</h4>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#9ca3af', maxWidth: 320 }}>
              {scheduledSuccess}
            </p>
          </div>
        ) : (
          <form onSubmit={handleStart} className="meeting-modal-form">
            {error && <div className="meeting-modal-error">{error}</div>}

            <div className="meeting-form-group">
              <label htmlFor="meeting-title">Meeting Topic</label>
              <input
                id="meeting-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Design review, Sprint sync..."
                required
                autoFocus
              />
            </div>

            <div className="meeting-form-group">
              <label>Meeting Format</label>
              <div className="meeting-mode-selector">
                <button
                  type="button"
                  className={`mode-btn ${mode === 'video' ? 'active' : ''}`}
                  onClick={() => setMode('video')}
                >
                  <div className="mode-btn-icon video-icon">
                    <Video size={20} />
                  </div>
                  <div className="mode-btn-text">
                    <span className="mode-title">Video Meeting</span>
                    <span className="mode-desc">Video grid + high quality audio</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`mode-btn ${mode === 'voice' ? 'active' : ''}`}
                  onClick={() => setMode('voice')}
                >
                  <div className="mode-btn-icon voice-icon">
                    <Mic size={20} />
                  </div>
                  <div className="mode-btn-text">
                    <span className="mode-title">Voice Meeting</span>
                    <span className="mode-desc">Audio-only with avatar grid</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Schedule for later toggle */}
            <div className="meeting-form-group" style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Calendar size={16} style={{ color: isScheduled ? '#8b5cf6' : '#9ca3af' }} />
                  <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#f3f4f6' }}>Schedule for Later</span>
                </div>
                <label className="calendar-switch" style={{ width: 34, height: 20 }}>
                  <input
                    type="checkbox"
                    checked={isScheduled}
                    onChange={(e) => setIsScheduled(e.target.checked)}
                  />
                  <span className="calendar-slider" />
                </label>
              </div>

              {isScheduled && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.78rem', color: '#9ca3af', margin: 0 }}>Date & Time *</label>
                    <span style={{ fontSize: '0.72rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                      📅 Syncs to Google Calendar
                    </span>
                  </div>
                  <input
                    type="datetime-local"
                    value={scheduledDateTime}
                    onChange={(e) => setScheduledDateTime(e.target.value)}
                    required={isScheduled}
                    style={{
                      background: '#121216',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#fff',
                      borderRadius: 8,
                      padding: '8px 12px',
                      fontSize: '0.85rem',
                      outline: 'none',
                    }}
                  />
                </div>
              )}
            </div>

            <div className="meeting-modal-actions">
              <button
                type="button"
                className="meeting-btn-secondary"
                onClick={onClose}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="meeting-btn-primary"
                disabled={isLoading || !title.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="spin-icon" /> {isScheduled ? 'Scheduling...' : 'Creating...'}
                  </>
                ) : isScheduled ? (
                  'Schedule Meeting'
                ) : (
                  'Start Meeting'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
