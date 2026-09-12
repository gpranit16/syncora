import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMeeting } from '../../context/MeetingContext';
import { useAuth } from '../../context/AuthContext';
import { Mic, MicOff, Video, VideoOff, ArrowLeft, Users, Shield, Loader2 } from 'lucide-react';
import './PreJoinScreen.css';

interface PreJoinScreenProps {
  meetingCode: string;
}

export const PreJoinScreen: React.FC<PreJoinScreenProps> = ({ meetingCode }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { meeting, meetingStatus, errorMessage, prepareMeeting, joinMeeting } = useMeeting();

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isMediaLoading, setIsMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    prepareMeeting(meetingCode);
  }, [meetingCode, prepareMeeting]);

  const isVideoMeeting = meeting ? (meeting.mode || meeting.meeting_type) === 'video' : true;

  // Initialize preview stream for pre-join setup
  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;

    const setupPreview = async () => {
      if (!meeting) return;
      setIsMediaLoading(true);
      setMediaError(null);

      try {
        if (isVideoMeeting) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            });
          } catch (vErr) {
            console.warn('Camera not available for preview, falling back to audio only', vErr);
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setIsCameraOff(true);
          }
        } else {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setIsCameraOff(true);
        }

        if (active && stream) {
          setPreviewStream(stream);
          if (videoPreviewRef.current && stream.getVideoTracks().length > 0) {
            videoPreviewRef.current.srcObject = stream;
          }
        }
      } catch (err: any) {
        if (active) {
          console.error('Preview stream error:', err);
          setMediaError('Could not access microphone or camera. You can still try joining.');
        }
      } finally {
        if (active) {
          setIsMediaLoading(false);
        }
      }
    };

    if (meetingStatus === 'prejoin' && meeting) {
      setupPreview();
    }

    return () => {
      active = false;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [meeting, meetingStatus, isVideoMeeting]);

  // Handle local video element binding
  useEffect(() => {
    if (videoPreviewRef.current && previewStream) {
      videoPreviewRef.current.srcObject = isCameraOff ? null : previewStream;
    }
  }, [previewStream, isCameraOff]);

  const handleToggleMute = () => {
    if (previewStream) {
      const audioTracks = previewStream.getAudioTracks();
      audioTracks.forEach((t) => (t.enabled = isMuted));
    }
    setIsMuted(!isMuted);
  };

  const handleToggleCamera = () => {
    if (previewStream) {
      const videoTracks = previewStream.getVideoTracks();
      videoTracks.forEach((t) => (t.enabled = isCameraOff));
    }
    setIsCameraOff(!isCameraOff);
  };

  const handleJoin = async () => {
    // Stop local preview tracks so joinMeeting can acquire clean stream
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
    }
    await joinMeeting(isMuted, isCameraOff);
  };

  if (meetingStatus === 'ended') {
    return (
      <div className="prejoin-container">
        <div className="prejoin-card prejoin-ended-card">
          <div className="prejoin-ended-icon">⚠️</div>
          <h2>Meeting Ended</h2>
          <p>{errorMessage || 'This meeting is no longer active.'}</p>
          <button className="prejoin-btn-primary" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (meetingStatus === 'error' && !meeting) {
    return (
      <div className="prejoin-container">
        <div className="prejoin-card prejoin-ended-card">
          <div className="prejoin-ended-icon">❌</div>
          <h2>Unable to Join Meeting</h2>
          <p>{errorMessage || 'Meeting not found or you do not have permission to join.'}</p>
          <button className="prejoin-btn-primary" onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="prejoin-container">
      <div className="prejoin-card">
        <button className="prejoin-back-btn" onClick={() => navigate('/dashboard')}>
          <ArrowLeft size={16} /> Back to Dashboard
        </button>

        <div className="prejoin-layout">
          {/* Preview Side */}
          <div className="prejoin-preview-section">
            <div className="prejoin-video-wrapper">
              {isVideoMeeting && !isCameraOff ? (
                <video
                  ref={videoPreviewRef}
                  autoPlay
                  playsInline
                  muted
                  className="prejoin-video-elem"
                />
              ) : (
                <div className="prejoin-avatar-placeholder">
                  <div className="prejoin-avatar-circle">
                    {user?.name ? user.name[0].toUpperCase() : 'U'}
                  </div>
                  <span className="prejoin-avatar-name">{user?.name || 'You'}</span>
                  {isVideoMeeting && <span className="prejoin-camera-state-badge">Camera Off</span>}
                </div>
              )}

              {/* Prejoin overlay media controls */}
              <div className="prejoin-media-controls">
                <button
                  type="button"
                  className={`prejoin-control-btn ${isMuted ? 'muted' : ''}`}
                  onClick={handleToggleMute}
                  title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                {isVideoMeeting && (
                  <button
                    type="button"
                    className={`prejoin-control-btn ${isCameraOff ? 'camera-off' : ''}`}
                    onClick={handleToggleCamera}
                    title={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
                  >
                    {isCameraOff ? <VideoOff size={18} /> : <Video size={18} />}
                  </button>
                )}
              </div>
            </div>

            {mediaError && <div className="prejoin-media-warning">{mediaError}</div>}
          </div>

          {/* Details & Actions Side */}
          <div className="prejoin-details-section">
            <div className="prejoin-meta-badges">
              <span className={`prejoin-mode-badge ${isVideoMeeting ? 'video-mode' : 'voice-mode'}`}>
                {isVideoMeeting ? <Video size={12} /> : <Mic size={12} />}
                {isVideoMeeting ? 'Video Meeting' : 'Voice Meeting'}
              </span>
              {meeting?.is_host && (
                <span className="prejoin-host-badge">
                  <Shield size={12} /> Host
                </span>
              )}
            </div>

            <h1 className="prejoin-meeting-title">{meeting?.title || 'Syncora Meeting'}</h1>

            <div className="prejoin-info-list">
              <div className="prejoin-info-item">
                <span className="info-label">Meeting Code:</span>
                <code className="prejoin-code-badge">{meetingCode}</code>
              </div>
              {meeting?.workspace_name && (
                <div className="prejoin-info-item">
                  <span className="info-label">Workspace:</span>
                  <span className="info-value">{meeting.workspace_name}</span>
                </div>
              )}
              {meeting?.host_name && (
                <div className="prejoin-info-item">
                  <span className="info-label">Host:</span>
                  <span className="info-value">{meeting.host_name}</span>
                </div>
              )}
              {meeting?.participants && meeting.participants.length > 0 && (
                <div className="prejoin-info-item">
                  <span className="info-label">In call:</span>
                  <span className="info-value">
                    <Users size={14} className="inline-icon" /> {meeting.participants.length} participant
                    {meeting.participants.length > 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="prejoin-actions">
              <button
                type="button"
                className="prejoin-btn-primary"
                onClick={handleJoin}
                disabled={meetingStatus === 'joining'}
              >
                {meetingStatus === 'joining' ? (
                  <>
                    <Loader2 size={18} className="spin-icon" /> Joining...
                  </>
                ) : (
                  'Join Now'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
