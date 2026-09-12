import React, { useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, AlertCircle } from 'lucide-react';
import { useCall } from '../../context/CallContext';
import './CallModal.css';

export const ActiveCallModal: React.FC = () => {
  const {
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

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const attemptPlay = useCallback((el: HTMLMediaElement | null, name: string) => {
    if (!el) return;
    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn(`[ActiveCallModal] ${name} play note:`, err);
      });
    }
  }, []);

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

      <div className={`active-call-window ${isVideoCall ? 'video-mode' : 'voice-mode'}`}>
        {/* Top bar */}
        <div className="call-top-bar">
          <div className="call-participant-info">
            <span className="call-title">{remoteUser?.name || 'Syncora Call'}</span>
            <span className={`call-status-pill ${callState === 'connected' ? 'connected' : ''}`}>
              {callState === 'reconnecting' && <AlertCircle size={12} />}
              {getStatusLabel()}
            </span>
          </div>
        </div>

        {/* Call Body */}
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
                  onLoadedMetadata={() => attemptPlay(remoteVideoRef.current, 'Remote video (metadata loaded)')}
                  onCanPlay={() => attemptPlay(remoteVideoRef.current, 'Remote video (canplay)')}
                />
                {!hasRemoteVideo && (
                  <div className="remote-video-placeholder">
                    <div className="video-avatar">{getInitials(remoteUser?.name)}</div>
                    <p className="video-remote-name">{remoteUser?.name || 'User'}</p>
                    <span className="subtle-status">
                      {callState === 'connected' ? 'Camera is off or connecting...' : getStatusLabel()}
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
                  onLoadedMetadata={() => attemptPlay(localVideoRef.current, 'Local preview (metadata loaded)')}
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
