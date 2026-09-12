import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMeeting } from '../../api/meetings';
import { Mic, Video, X, Sparkles, Loader2 } from 'lucide-react';
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const meeting = await createMeeting({
        workspace_id: workspaceId,
        channel_id: channelId || null,
        title: title.trim(),
        mode,
      });

      const meetingCode = meeting?.meeting_code || (meeting as any)?.meetingCode;
      if (meetingCode) {
        onClose();
        navigate(`/meet/${meetingCode}`);
      } else {
        throw new Error('No meeting code returned from server');
      }
    } catch (err: any) {
      console.error('Failed to start meeting:', err);
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
              <h3>Start a Meeting</h3>
              <p className="meeting-modal-subtitle">
                {channelName ? `In #${channelName}` : 'Instant workspace meeting'}
              </p>
            </div>
          </div>
          <button className="meeting-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

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
                  <Loader2 size={16} className="spin-icon" /> Creating...
                </>
              ) : (
                'Start Meeting'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
