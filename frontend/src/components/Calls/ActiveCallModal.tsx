import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, AlertCircle, FileText, X } from 'lucide-react';
import { useCall } from '../../context/CallContext';
import { useAuth } from '../../context/AuthContext';
import {
  useDeepgramTranscription,
  DeepgramTranscriptEntry,
} from '../../hooks/useDeepgramTranscription';
import './CallModal.css';

export const ActiveCallModal: React.FC = () => {
  const { user } = useAuth();
  const {
    callId,
    callState,
    callType,
    remoteUser,
    localStream,
    remoteStream,
    isAudioMuted,
    isVideoOff,
    callDuration,
    callError,
    endCall,
    toggleMute,
    toggleVideo,
  } = useCall();

  const [showTranscript, setShowTranscript] = useState(false);
  const [finalTranscriptEntries, setFinalTranscriptEntries] = useState<DeepgramTranscriptEntry[]>([]);
  const [interimTranscriptMap, setInterimTranscriptMap] = useState<Map<string, DeepgramTranscriptEntry>>(new Map());
  const [transcriptionStatus, setTranscriptionStatus] = useState<'idle' | 'connecting' | 'active' | 'error' | 'muted'>('idle');

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const attemptPlay = useCallback((el: HTMLMediaElement | null, name: string) => {
    if (!el) return;
    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn(`[ActiveCallModal] ${name} play note:`, err);
      });
    }
  }, []);

  // Handle incoming transcripts
  const handleTranscriptUpdate = useCallback((entry: DeepgramTranscriptEntry) => {
    if (entry.isFinal) {
      setInterimTranscriptMap((prev) => {
        const next = new Map(prev);
        next.delete(entry.id);
        return next;
      });

      setFinalTranscriptEntries((prev) => {
        const isDuplicate = prev.some(
          (e) =>
            e.speakerName === entry.speakerName &&
            e.text.toLowerCase() === entry.text.toLowerCase() &&
            Math.abs(new Date(e.timestamp).getTime() - new Date(entry.timestamp).getTime()) < 2000
        );
        if (isDuplicate) return prev;
        return [...prev.slice(-100), entry];
      });
    } else {
      setInterimTranscriptMap((prev) => {
        const next = new Map(prev);
        next.set(entry.id, entry);
        return next;
      });
    }
  }, []);

  // Hook up Deepgram Nova-3 transcription
  useDeepgramTranscription({
    localStream,
    callId,
    userId: user?.user_id,
    userName: user?.name || 'You',
    isMuted: isAudioMuted,
    isActive: callState === 'connected',
    onTranscriptUpdate: handleTranscriptUpdate,
    onStatusChange: setTranscriptionStatus,
  });

  // Auto-scroll transcript on update
  useEffect(() => {
    if (showTranscript) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [finalTranscriptEntries, interimTranscriptMap, showTranscript]);

  // Reset transcript when call ends
  useEffect(() => {
    if (callState === 'idle') {
      setFinalTranscriptEntries([]);
      setInterimTranscriptMap(new Map());
      setShowTranscript(false);
    }
  }, [callState]);

  // Attach local media stream to local video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      attemptPlay(localVideoRef.current, 'Local preview');
    }
  }, [localStream, callState, attemptPlay]);

  // Attach remote media stream to remote video element for video calls
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      attemptPlay(remoteVideoRef.current, 'Remote video');
    }
  }, [remoteStream, callState, attemptPlay]);

  // Attach remote media stream to remote audio element (guarantees voice call audio playback)
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      if (remoteAudioRef.current.srcObject !== remoteStream) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
      attemptPlay(remoteAudioRef.current, 'Remote audio');
    }
  }, [remoteStream, callState, attemptPlay]);

  if (callState === 'idle' || callState === 'ringing') {
    return null;
  }

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  const getStatusLabel = () => {
    switch (callState) {
      case 'calling':
        return 'Calling...';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'ended':
        return 'Call Ended';
      case 'connected':
        return callDuration;
      default:
        return '';
    }
  };

  const formatMessageTime = (iso?: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const isVideoCall = callType === 'video';
  const hasRemoteVideo =
    isVideoCall &&
    !!remoteStream &&
    remoteStream.getVideoTracks().length > 0 &&
    remoteStream.getVideoTracks().some((t) => t.enabled);

  return (
    <div className="call-overlay active-call-overlay">
      {/* Hidden dedicated audio element for reliable remote voice playback */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div
        className={`active-call-window ${isVideoCall ? 'video-mode' : 'voice-mode'} ${
          showTranscript ? 'with-transcript' : ''
        }`}
      >
        {/* Top bar */}
        <div className="call-top-bar">
          <div className="call-participant-info">
            <span className="call-title">{remoteUser?.name || 'Syncora Call'}</span>
            <span className={`call-status-pill ${callState === 'connected' ? 'connected' : ''}`}>
              {callState === 'reconnecting' && <AlertCircle size={12} />}
              {getStatusLabel()}
            </span>
          </div>

          {/* Live transcription status badge in top bar */}
          {transcriptionStatus === 'active' && (
            <div className="call-live-transcription-indicator" title="Deepgram Nova-3 Live Transcription Active">
              <span className="live-dot-pulse" />
              <span>Live Subtitles</span>
            </div>
          )}
        </div>

        {/* Call Main Content Stage + Transcript Sidebar */}
        <div className="call-main-content">
          <div className="call-stage">
            {isVideoCall ? (
              <div className="video-stage">
                {/* Remote Video Container */}
                <div className="remote-video-container">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className={`remote-video ${hasRemoteVideo ? 'active' : 'hidden'}`}
                    onLoadedMetadata={() =>
                      attemptPlay(remoteVideoRef.current, 'Remote video (metadata loaded)')
                    }
                    onCanPlay={() => attemptPlay(remoteVideoRef.current, 'Remote video (canplay)')}
                  />
                  {!hasRemoteVideo && (
                    <div className="remote-video-placeholder">
                      <div className="video-avatar">{getInitials(remoteUser?.name)}</div>
                      <p className="video-remote-name">{remoteUser?.name || 'User'}</p>
                      <span className="subtle-status">
                        {callState === 'connected'
                          ? 'Camera is off or connecting...'
                          : getStatusLabel()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Local PiP Preview */}
                <div className={`local-video-pip ${isVideoOff ? 'video-off' : ''}`}>
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="local-video"
                    onLoadedMetadata={() =>
                      attemptPlay(localVideoRef.current, 'Local preview (metadata loaded)')
                    }
                    onCanPlay={() => attemptPlay(localVideoRef.current, 'Local preview (canplay)')}
                    style={{ display: isVideoOff ? 'none' : 'block' }}
                  />
                  {isVideoOff && (
                    <div className="local-video-placeholder">
                      <VideoOff size={18} />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="voice-stage">
                <div className="voice-avatar-wrap">
                  {callState === 'connected' && <div className="voice-pulse-ring" />}
                  {callState === 'connected' && <div className="voice-pulse-ring delay-1" />}
                  <div className="voice-avatar">{getInitials(remoteUser?.name)}</div>
                </div>
                <h2 className="voice-user-name">{remoteUser?.name || 'User'}</h2>
                <p className="voice-call-status">{getStatusLabel()}</p>
              </div>
            )}

            {/* Error / Alert banner */}
            {callError && (
              <div className="call-error-banner">
                <AlertCircle size={15} />
                <span>{callError}</span>
              </div>
            )}
          </div>

          {/* Live Transcript Sidebar Panel */}
          {showTranscript && (
            <aside className="call-transcript-sidebar">
              <div className="call-transcript-header">
                <div className="transcript-title-group">
                  <FileText size={16} />
                  <div>
                    <h3>Live Transcript</h3>
                    <span className="transcript-status-subtext">
                      {transcriptionStatus === 'active' && (
                        <span className="status-badge-active">
                          <span className="status-live-dot" /> Live · Deepgram Nova-3
                        </span>
                      )}
                      {transcriptionStatus === 'connecting' && 'Connecting to Deepgram...'}
                      {transcriptionStatus === 'muted' && 'Transcription paused (mic muted)'}
                      {transcriptionStatus === 'error' && (
                        <span className="status-badge-error">
                          <AlertCircle size={11} /> Service unavailable
                        </span>
                      )}
                      {transcriptionStatus === 'idle' && 'Waiting for audio...'}
                    </span>
                  </div>
                </div>
                <button
                  className="call-transcript-close-btn"
                  onClick={() => setShowTranscript(false)}
                  title="Close Transcript"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="call-transcript-body">
                {finalTranscriptEntries.length === 0 && interimTranscriptMap.size === 0 ? (
                  <div className="call-transcript-empty">
                    <FileText size={32} className="empty-transcript-icon" />
                    <p className="empty-title">No transcript yet</p>
                    <span className="empty-desc">
                      Speak into your microphone to see live subtitles powered by Deepgram Nova-3.
                    </span>
                  </div>
                ) : (
                  <div className="call-transcript-messages">
                    {/* Final committed transcript turns */}
                    {finalTranscriptEntries.map((entry, idx) => {
                      const isMine =
                        entry.speakerId === user?.user_id ||
                        entry.speakerName.toLowerCase() === (user?.name || '').toLowerCase() ||
                        entry.speakerName === 'You';

                      return (
                        <div
                          key={`final_${entry.id}_${idx}`}
                          className={`call-transcript-bubble ${isMine ? 'mine' : 'remote'}`}
                        >
                          <div className="call-transcript-bubble-header">
                            <span className="speaker-name">{entry.speakerName}</span>
                            {isMine && <span className="you-tag">You</span>}
                            <span className="speaker-time">{formatMessageTime(entry.timestamp)}</span>
                          </div>
                          <div className="call-transcript-bubble-text">
                            <p>{entry.text}</p>
                          </div>
                        </div>
                      );
                    })}

                    {/* Real-time interim preview per speaker */}
                    {Array.from(interimTranscriptMap.values()).map((entry) => {
                      const isMine =
                        entry.speakerId === user?.user_id ||
                        entry.speakerName.toLowerCase() === (user?.name || '').toLowerCase() ||
                        entry.speakerName === 'You';

                      return (
                        <div
                          key={`interim_${entry.id}`}
                          className={`call-transcript-bubble interim ${isMine ? 'mine' : 'remote'}`}
                        >
                          <div className="call-transcript-bubble-header">
                            <span className="speaker-name">{entry.speakerName}</span>
                            {isMine && <span className="you-tag">You</span>}
                            <span className="live-tag">speaking...</span>
                          </div>
                          <div className="call-transcript-bubble-text">
                            <p className="interim-text-content">{entry.text}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={transcriptEndRef} />
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>

        {/* Floating Call Controls */}
        <div className="call-controls-bar">
          {/* Mute button */}
          <button
            className={`call-ctrl-btn ${isAudioMuted ? 'active-off' : ''}`}
            onClick={toggleMute}
            title={isAudioMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          >
            {isAudioMuted ? <MicOff size={20} /> : <Mic size={20} />}
            <span className="ctrl-label">{isAudioMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          {/* Video Toggle button (for video calls) */}
          {isVideoCall && (
            <button
              className={`call-ctrl-btn ${isVideoOff ? 'active-off' : ''}`}
              onClick={toggleVideo}
              title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
              <span className="ctrl-label">{isVideoOff ? 'Camera On' : 'Camera Off'}</span>
            </button>
          )}

          {/* Transcript Toggle button */}
          <button
            className={`call-ctrl-btn ${showTranscript ? 'active' : ''}`}
            onClick={() => setShowTranscript((prev) => !prev)}
            title="Toggle Live Transcript (Deepgram Nova-3)"
          >
            <div className="call-ctrl-icon-wrap">
              <FileText size={20} />
              {transcriptionStatus === 'active' && <span className="ctrl-live-dot" />}
            </div>
            <span className="ctrl-label">Transcript</span>
          </button>

          {/* End Call button */}
          <button className="call-ctrl-btn end-btn" onClick={endCall} title="End Call">
            <PhoneOff size={22} />
            <span className="ctrl-label">End Call</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActiveCallModal;
