import React, { useState, useEffect, useRef } from 'react';
import { useMeeting, MeetingParticipantPeer } from '../../context/MeetingContext';
import { useAuth } from '../../context/AuthContext';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Users,
  UserPlus,
  Copy,
  Check,
  Shield,
  Volume2,
  X,
  Search,
  CheckCircle2,
  Loader2,
  MonitorUp,
  MonitorOff,
  MessageSquare,
  Send,
} from 'lucide-react';
import client from '../../api/client';
import { inviteToMeeting } from '../../api/meetings';
import { emitMeetingTranscriptChunk } from '../../socket/socketManager';
import './MeetingRoom.css';

// Individual Participant Tile (Handles remote stream binding & audio playback)
const ParticipantTile: React.FC<{
  participant: MeetingParticipantPeer;
  stream?: MediaStream;
  isVideoMeeting: boolean;
  isHostUser: boolean;
  isPresenter?: boolean;
  onMute?: (socketId: string) => void;
  onUnmute?: (socketId: string) => void;
  onRemove?: (socketId: string) => void;
  onStopScreenShare?: (socketId: string) => void;
}> = ({
  participant,
  stream,
  isVideoMeeting,
  isHostUser,
  isPresenter,
  onMute,
  onUnmute,
  onRemove,
  onStopScreenShare,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const videoTracks = stream ? stream.getVideoTracks() : [];
  const hasLiveVideoTrack = videoTracks.length > 0 && videoTracks.some((t) => t.readyState === 'live');

  // Video is shown if we have a live video track OR remote participant has camera on with track
  const showVideo = isVideoMeeting && (hasLiveVideoTrack || (!participant.isCameraOff && videoTracks.length > 0));

  // Sync stream to video element whenever stream changes or mounts
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && stream) {
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }
      videoEl.play().catch((err) => {
        console.warn('[WebRTC] Participant video play note:', err);
      });
    }
  }, [stream]);

  // Sync stream to audio element
  useEffect(() => {
    const audioEl = audioRef.current;
    if (audioEl && stream) {
      if (audioEl.srcObject !== stream) {
        audioEl.srcObject = stream;
      }
      audioEl.play().catch(() => {});
    }
  }, [stream]);

  return (
    <div className={`meeting-tile ${showVideo ? 'has-video' : 'avatar-only'} ${isPresenter ? 'is-presenter' : ''}`}>
      {/* Remote Audio Track */}
      <audio ref={audioRef} autoPlay playsInline />

      {/* Remote Video Track: ALWAYS in DOM like Google Meet & WhatsApp so pipeline stays hot */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ display: showVideo ? 'block' : 'none' }}
        onLoadedMetadata={(e) => {
          (e.target as HTMLVideoElement).play().catch(() => {});
        }}
        className="participant-video-elem"
      />

      {/* Avatar Display when video is not visible */}
      {!showVideo && (
        <div className="participant-avatar-container">
          <div className="participant-avatar-circle">
            {participant.userAvatar ? (
              <img src={participant.userAvatar} alt={participant.userName} />
            ) : (
              <span>{participant.userName ? participant.userName[0].toUpperCase() : 'U'}</span>
            )}
          </div>
        </div>
      )}

      {/* Tile Overlay Meta */}
      <div className="tile-overlay-bottom">
        <div className="tile-user-info">
          <span className="tile-user-name">{participant.userName}</span>
          {participant.role === 'host' && (
            <span className="tile-role-badge">
              <Shield size={10} /> Host
            </span>
          )}
          {isPresenter && (
            <span className="tile-presenting-badge">
              <MonitorUp size={10} /> Presenting
            </span>
          )}
        </div>

        <div className="tile-indicators">
          {participant.isMuted ? (
            <span className="tile-icon-indicator muted" title="Muted">
              <MicOff size={13} />
            </span>
          ) : (
            <span className="tile-icon-indicator unmuted" title="Speaking / Mic Active">
              <Volume2 size={13} />
            </span>
          )}
        </div>
      </div>

      {/* Host Quick Actions Menu on Hover */}
      {isHostUser && participant.role !== 'host' && (
        <div className="tile-host-controls">
          {isPresenter && onStopScreenShare && (
            <button
              className="tile-action-btn stop-share"
              onClick={() => onStopScreenShare(participant.socketId)}
              title="Stop participant's screen share"
            >
              <MonitorOff size={13} /> Stop Share
            </button>
          )}
          {participant.isMuted ? (
            onUnmute && (
              <button
                className="tile-action-btn unmute"
                onClick={() => onUnmute(participant.socketId)}
                title="Unmute participant"
              >
                <Mic size={13} /> Unmute
              </button>
            )
          ) : (
            onMute && (
              <button
                className="tile-action-btn"
                onClick={() => onMute(participant.socketId)}
                title="Mute participant"
              >
                <MicOff size={13} /> Mute
              </button>
            )
          )}
          {onRemove && (
            <button
              className="tile-action-btn remove"
              onClick={() => onRemove(participant.socketId)}
              title="Remove from meeting"
            >
              <X size={13} /> Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Local Participant Tile (You)
const LocalTile: React.FC<{
  stream: MediaStream | null;
  userName: string;
  userAvatar?: string | null;
  isHost: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  isVideoMeeting: boolean;
  isScreenSharing?: boolean;
}> = ({ stream, userName, userAvatar, isHost, isMuted, isCameraOff, isVideoMeeting, isScreenSharing }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const hasVideoTrack = Boolean(
    stream &&
    stream.getVideoTracks().length > 0 &&
    stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled !== false)
  );

  const showVideo = isVideoMeeting && !isCameraOff && hasVideoTrack;

  const setLocalVideoNode = React.useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      if (node && stream && !isCameraOff) {
        if (node.srcObject !== stream) {
          node.srcObject = stream;
        }
        node.play().catch(() => {});
      }
    },
    [stream, isCameraOff]
  );

  useEffect(() => {
    if (videoRef.current && stream && showVideo) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [stream, showVideo]);

  return (
    <div className={`meeting-tile local-tile ${showVideo ? 'has-video' : 'avatar-only'} ${isScreenSharing ? 'is-presenter' : ''}`}>
      {showVideo ? (
        <video
          ref={setLocalVideoNode}
          autoPlay
          playsInline
          muted
          className="participant-video-elem mirrored"
        />
      ) : (
        <div className="participant-avatar-container">
          <div className="participant-avatar-circle local-avatar">
            {userAvatar ? (
              <img src={userAvatar} alt={userName} />
            ) : (
              <span>{userName ? userName[0].toUpperCase() : 'Y'}</span>
            )}
          </div>
        </div>
      )}

      <div className="tile-overlay-bottom">
        <div className="tile-user-info">
          <span className="tile-user-name">{userName} (You)</span>
          {isHost && (
            <span className="tile-role-badge">
              <Shield size={10} /> Host
            </span>
          )}
          {isScreenSharing && (
            <span className="tile-presenting-badge">
              <MonitorUp size={10} /> Presenting
            </span>
          )}
        </div>

        <div className="tile-indicators">
          {isMuted ? (
            <span className="tile-icon-indicator muted" title="Your mic is muted">
              <MicOff size={13} />
            </span>
          ) : (
            <span className="tile-icon-indicator unmuted" title="Your mic is active">
              <Mic size={13} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// Google Meet Spotlight Presentation View
const PresentationStage: React.FC<{
  stream?: MediaStream | null;
  presenterName: string;
  isLocalPresenter: boolean;
  isHostUser: boolean;
  targetSocketId?: string;
  onStopSelfSharing?: () => void;
  onHostStopSharing?: (socketId: string) => void;
}> = ({
  stream,
  presenterName,
  isLocalPresenter,
  isHostUser,
  targetSocketId,
  onStopSelfSharing,
  onHostStopSharing,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && stream) {
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
      }
      videoEl.play().catch((err) => {
        console.warn('[ScreenShare] Presentation video play error:', err);
      });
    }
  }, [stream]);

  const hasVideoTrack = Boolean(
    stream &&
    stream.getVideoTracks().length > 0 &&
    stream.getVideoTracks().some((t) => t.readyState === 'live')
  );

  return (
    <div className="presentation-spotlight-box">
      {hasVideoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocalPresenter}
          className="presentation-video-element"
        />
      ) : (
        <div className="presentation-placeholder">
          <MonitorUp size={44} className="presentation-pulse-icon" />
          <h3>{isLocalPresenter ? 'You are sharing your screen' : `${presenterName} is sharing their screen`}</h3>
          <p>Live display stream is active and broadcasting to everyone in the room.</p>
        </div>
      )}

      {/* Presentation Top Control Bar */}
      <div className="presentation-stage-header">
        <div className="presentation-presenter-pill">
          <MonitorUp size={14} className="screen-active-icon" />
          <span>{isLocalPresenter ? 'You are presenting to everyone' : `${presenterName} is presenting`}</span>
        </div>

        <div className="presentation-actions">
          {isLocalPresenter ? (
            <button
              className="stop-presenting-pill-btn"
              onClick={onStopSelfSharing}
              title="Stop sharing your screen"
            >
              <MonitorOff size={14} /> Stop Presenting
            </button>
          ) : (
            isHostUser && targetSocketId && (
              <button
                className="stop-presenting-pill-btn host-action"
                onClick={() => onHostStopSharing && onHostStopSharing(targetSocketId)}
                title="Stop participant's screen share (Host Control)"
              >
                <MonitorOff size={14} /> Stop Screen Share (Host)
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export const MeetingRoom: React.FC = () => {
  const { user } = useAuth();
  const {
    meeting,
    localStream,
    remoteStreams,
    participants,
    isMuted,
    isCameraOff,
    isScreenSharing,
    isScreenShareLocked,
    screenPresenter,
    meetingMessages,
    isHost,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    toggleScreenShareLock,
    hostStopParticipantScreenShare,
    sendMeetingChatMessage,
    leaveMeeting,
    endMeetingForEveryone,
    hostMuteParticipant,
    hostUnmuteParticipant,
    hostRemoveParticipant,
  } = useMeeting();

  const [copiedLink, setCopiedLink] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // In-Meeting Chat state
  const [chatInputText, setChatInputText] = useState('');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  // In-Meeting Invite state
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([]);
  const [selectedInviteIds, setSelectedInviteIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteSuccessMsg, setInviteSuccessMsg] = useState<string | null>(null);

  const isVideoMeeting = meeting ? (meeting.mode || meeting.meeting_type) === 'video' : true;

  // Meeting duration timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Track unread chat messages & auto-scroll
  useEffect(() => {
    if (showChat) {
      setUnreadChatCount(0);
      chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (meetingMessages.length > 0) {
      setUnreadChatCount((prev) => prev + 1);
    }
  }, [meetingMessages, showChat]);

  // Reset unread counter when opening chat
  const handleToggleChat = () => {
    const nextState = !showChat;
    setShowChat(nextState);
    if (nextState) {
      setUnreadChatCount(0);
      setShowRoster(false); // Clean panel toggle
    }
  };

  const handleToggleRoster = () => {
    const nextState = !showRoster;
    setShowRoster(nextState);
    if (nextState) {
      setShowChat(false);
    }
  };

  const handleSendChatMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInputText.trim()) return;
    sendMeetingChatMessage(chatInputText);
    setChatInputText('');
  };

  // Persistent refs to avoid effect re-triggers on every 1-second render tick
  const meetingCodeRef = useRef<string | null>(null);
  meetingCodeRef.current = meeting?.meeting_code || null;

  const isMutedRef = useRef<boolean>(isMuted);
  isMutedRef.current = isMuted;

  const userRef = useRef(user);
  userRef.current = user;

  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isComponentMountedRef = useRef<boolean>(true);
  const isRecognizingRef = useRef<boolean>(false);
  const sessionSeqRef = useRef<number>(0);
  const totalUtterancesRef = useRef<number>(0);
  const pendingSpeechBufferRef = useRef<string>('');

  // Unified Live Speech Recognition Engine with Watchdog & Fresh Session Recycling
  useEffect(() => {
    isComponentMountedRef.current = true;
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      console.warn('[STT Engine] SpeechRecognition API is not supported in this browser.');
      return;
    }

    const cleanupActiveInstance = () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onstart = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.onaudiostart = null;
          recognitionRef.current.onspeechstart = null;
          recognitionRef.current.abort();
        } catch (_) {}
        recognitionRef.current = null;
      }
      isRecognizingRef.current = false;
    };

    const spawnFreshRecognitionSession = () => {
      if (!isComponentMountedRef.current) return;
      if (isMutedRef.current) {
        return;
      }
      if (!meetingCodeRef.current) {
        return;
      }

      cleanupActiveInstance();

      sessionSeqRef.current += 1;
      const currentSessionId = sessionSeqRef.current;

      try {
        const rec = new SpeechRecognitionClass();
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.lang = navigator.language || 'en-US';

        rec.onstart = () => {
          isRecognizingRef.current = true;
          console.log(`[STT Engine Session #${currentSessionId}] Active & listening for meeting ${meetingCodeRef.current}`);
        };

        rec.onresult = (event: any) => {
          let latestInterim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcriptSegment = event.results[i][0]?.transcript?.trim();
            if (event.results[i].isFinal) {
              if (transcriptSegment) {
                totalUtterancesRef.current += 1;
                console.log(
                  `[STT Engine Session #${currentSessionId}] Utterance #${totalUtterancesRef.current}: "${transcriptSegment}"`
                );
                if (meetingCodeRef.current) {
                  emitMeetingTranscriptChunk({
                    meeting_code: meetingCodeRef.current,
                    text: transcriptSegment,
                    user_id: userRef.current?.user_id,
                    user_name: userRef.current?.name || 'Speaker',
                    timestamp: new Date().toISOString(),
                  });
                }
                pendingSpeechBufferRef.current = '';
              }
            } else {
              latestInterim = transcriptSegment;
            }
          }
          if (latestInterim) {
            pendingSpeechBufferRef.current = latestInterim;
          }
        };

        rec.onerror = (event: any) => {
          const errType = event.error || 'unknown';
          if (errType !== 'no-speech' && errType !== 'aborted') {
            console.warn(`[STT Engine Session #${currentSessionId}] Error: ${errType}`);
          }
        };

        rec.onend = () => {
          isRecognizingRef.current = false;
          // Flush any pending interim speech buffer
          if (pendingSpeechBufferRef.current && pendingSpeechBufferRef.current.trim()) {
            const flushText = pendingSpeechBufferRef.current.trim();
            console.log(`[STT Engine Session #${currentSessionId}] Flushing buffer on end: "${flushText}"`);
            if (meetingCodeRef.current) {
              emitMeetingTranscriptChunk({
                meeting_code: meetingCodeRef.current,
                text: flushText,
                user_id: userRef.current?.user_id,
                user_name: userRef.current?.name || 'Speaker',
                timestamp: new Date().toISOString(),
              });
            }
            pendingSpeechBufferRef.current = '';
          }

          // Automatically restart a fresh session if still active, unmuted, and mounted
          if (isComponentMountedRef.current && !isMutedRef.current && meetingCodeRef.current) {
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              spawnFreshRecognitionSession();
            }, 200);
          }
        };

        recognitionRef.current = rec;
        rec.start();
      } catch (err: any) {
        console.warn(`[STT Engine Session #${currentSessionId}] Start failed:`, err.message);
        isRecognizingRef.current = false;
        if (isComponentMountedRef.current && !isMutedRef.current && meetingCodeRef.current) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            spawnFreshRecognitionSession();
          }, 600);
        }
      }
    };

    // If unmuted and in a meeting, start immediately
    if (!isMuted && meeting?.meeting_code) {
      spawnFreshRecognitionSession();
    } else {
      cleanupActiveInstance();
    }

    // Active Watchdog Heartbeat
    if (watchdogTimerRef.current) clearInterval(watchdogTimerRef.current);
    watchdogTimerRef.current = setInterval(() => {
      if (
        isComponentMountedRef.current &&
        !isMutedRef.current &&
        meetingCodeRef.current &&
        !isRecognizingRef.current
      ) {
        console.log('[STT Engine Watchdog] Inactive session detected while unmuted, restoring fresh session...');
        spawnFreshRecognitionSession();
      }
    }, 2500);

    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (watchdogTimerRef.current) {
        clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      cleanupActiveInstance();
    };
  }, [isMuted, meeting?.meeting_code]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatMessageTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const handleCopyLink = () => {
    if (!meeting) return;
    const url = `${window.location.origin}/meet/${meeting.meeting_code}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Load workspace members for invite modal
  useEffect(() => {
    if (showInviteModal && meeting?.workspace_id) {
      client
        .get(`/workspaces/${meeting.workspace_id}/members`)
        .then((res) => {
          const members = res.data.members || res.data.data || [];
          setWorkspaceMembers(members);
        })
        .catch((err) => console.error('Failed to load workspace members:', err));
    }
  }, [showInviteModal, meeting?.workspace_id]);

  const handleSendInvites = async () => {
    if (!meeting || selectedInviteIds.length === 0) return;
    setIsInviting(true);
    setInviteSuccessMsg(null);

    try {
      await inviteToMeeting(meeting.meeting_id, selectedInviteIds);
      setInviteSuccessMsg('Invitations sent!');
      setSelectedInviteIds([]);
      setTimeout(() => {
        setShowInviteModal(false);
        setInviteSuccessMsg(null);
      }, 1500);
    } catch (err) {
      console.error('Failed to invite:', err);
    } finally {
      setIsInviting(false);
    }
  };

  const participantsList = Array.from(participants.values());
  const totalCount = participantsList.length + 1; // +1 for local user

  // Determine active presentation stream
  const isLocalPresenter = isScreenSharing || (Boolean(screenPresenter && user && screenPresenter.userId === user.user_id));
  const activePresentationStream = isLocalPresenter
    ? localStream
    : (screenPresenter ? remoteStreams.get(screenPresenter.socketId) : null);

  return (
    <div className="meeting-room-container">
      {/* Top Header Bar */}
      <header className="meeting-header-bar">
        <div className="header-left">
          <h2 className="meeting-title">{meeting?.title || 'Syncora Meeting'}</h2>
          <span className={`meeting-mode-pill ${isVideoMeeting ? 'video' : 'voice'}`}>
            {isVideoMeeting ? <Video size={12} /> : <Mic size={12} />}
            {isVideoMeeting ? 'Video' : 'Voice'}
          </span>
          <span className="meeting-timer-badge">{formatDuration(callDuration)}</span>

          {screenPresenter && (
            <span className="meeting-presenting-pill">
              <MonitorUp size={12} />
              {isLocalPresenter ? 'You are sharing screen' : `${screenPresenter.userName} is presenting`}
            </span>
          )}
        </div>

        <div className="header-right">
          <button className="copy-code-btn" onClick={handleCopyLink}>
            {copiedLink ? <Check size={14} className="copied-icon" /> : <Copy size={14} />}
            <span>{copiedLink ? 'Link Copied' : meeting?.meeting_code}</span>
          </button>

          {/* Chat Toggle Header Button */}
          <button
            className={`roster-toggle-btn ${showChat ? 'active' : ''}`}
            onClick={handleToggleChat}
            title="In-call messages"
          >
            <MessageSquare size={16} />
            {unreadChatCount > 0 && <span className="participant-count-badge chat-unread">{unreadChatCount}</span>}
          </button>

          {/* Participants Toggle Header Button */}
          <button
            className={`roster-toggle-btn ${showRoster ? 'active' : ''}`}
            onClick={handleToggleRoster}
            title="Toggle Participants"
          >
            <Users size={16} />
            <span className="participant-count-badge">{totalCount}</span>
          </button>
        </div>
      </header>

      {/* Main Stage Layout */}
      <main className="meeting-stage-layout">
        {screenPresenter ? (
          /* Spotlight Presentation View Mode */
          <div className="presentation-layout-container">
            <div className="presentation-main-stage">
              <PresentationStage
                stream={activePresentationStream}
                presenterName={screenPresenter.userName}
                isLocalPresenter={isLocalPresenter}
                isHostUser={isHost}
                targetSocketId={screenPresenter.socketId}
                onStopSelfSharing={stopScreenShare}
                onHostStopSharing={hostStopParticipantScreenShare}
              />
            </div>

            {/* Participant Filmstrip alongside Presentation */}
            <div className="presentation-filmstrip">
              <LocalTile
                stream={localStream}
                userName={user?.name || 'You'}
                userAvatar={(user as any)?.avatar || null}
                isHost={isHost}
                isMuted={isMuted}
                isCameraOff={isCameraOff}
                isVideoMeeting={isVideoMeeting}
                isScreenSharing={isLocalPresenter}
              />

              {participantsList.map((peer) => (
                <ParticipantTile
                  key={peer.socketId}
                  participant={peer}
                  stream={remoteStreams.get(peer.socketId)}
                  isVideoMeeting={isVideoMeeting}
                  isHostUser={isHost}
                  isPresenter={screenPresenter?.socketId === peer.socketId}
                  onMute={hostMuteParticipant}
                  onUnmute={hostUnmuteParticipant}
                  onRemove={hostRemoveParticipant}
                  onStopScreenShare={hostStopParticipantScreenShare}
                />
              ))}
            </div>
          </div>
        ) : (
          /* Standard Multi-Participant Grid Mode */
          <div className={`meeting-tiles-grid grid-count-${Math.min(totalCount, 12)}`}>
            {/* Local User Tile */}
            <LocalTile
              stream={localStream}
              userName={user?.name || 'You'}
              userAvatar={(user as any)?.avatar || null}
              isHost={isHost}
              isMuted={isMuted}
              isCameraOff={isCameraOff}
              isVideoMeeting={isVideoMeeting}
              isScreenSharing={isScreenSharing}
            />

            {/* Remote Participants Tiles */}
            {participantsList.map((peer) => (
              <ParticipantTile
                key={peer.socketId}
                participant={peer}
                stream={remoteStreams.get(peer.socketId)}
                isVideoMeeting={isVideoMeeting}
                isHostUser={isHost}
                isPresenter={false}
                onMute={hostMuteParticipant}
                onUnmute={hostUnmuteParticipant}
                onRemove={hostRemoveParticipant}
                onStopScreenShare={hostStopParticipantScreenShare}
              />
            ))}
          </div>
        )}

        {/* In-Meeting Chat Drawer (Google Meet style) */}
        {showChat && (
          <aside className="meeting-chat-sidebar">
            <div className="chat-sidebar-header">
              <div className="chat-title-group">
                <MessageSquare size={16} />
                <div>
                  <h3>In-call messages</h3>
                  <span className="chat-disclaimer">Messages are visible to participants in this call</span>
                </div>
              </div>
              <button className="roster-close-btn" onClick={() => setShowChat(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="chat-messages-container">
              {meetingMessages.length === 0 ? (
                <div className="chat-empty-state">
                  <MessageSquare size={32} className="chat-empty-icon" />
                  <p className="chat-empty-text">No messages yet</p>
                  <span>Send a message to everyone in the call.</span>
                </div>
              ) : (
                meetingMessages.map((msg) => {
                  const isMine = user && msg.sender_id === user.user_id;

                  return (
                    <div key={msg.message_id} className={`chat-message-item ${isMine ? 'mine' : ''}`}>
                      <div className="chat-msg-header">
                        <div className="chat-msg-sender-info">
                          <span className="chat-sender-name">{msg.sender_name}</span>
                          {isMine && <span className="chat-tag-badge you">You</span>}
                          {msg.is_host && <span className="chat-tag-badge host">Host</span>}
                        </div>
                        <span className="chat-msg-time">{formatMessageTime(msg.created_at)}</span>
                      </div>
                      <div className="chat-msg-bubble">
                        <p>{msg.text}</p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatMessagesEndRef} />
            </div>

            <form className="chat-input-form" onSubmit={handleSendChatMessage}>
              <input
                type="text"
                placeholder="Send a message to everyone..."
                value={chatInputText}
                onChange={(e) => setChatInputText(e.target.value)}
                maxLength={500}
              />
              <button
                type="submit"
                className="chat-send-btn"
                disabled={!chatInputText.trim()}
                title="Send message"
              >
                <Send size={15} />
              </button>
            </form>
          </aside>
        )}

        {/* Participants Sidebar / Roster */}
        {showRoster && (
          <aside className="meeting-roster-sidebar">
            <div className="roster-header">
              <div className="roster-title-group">
                <Users size={16} />
                <h3>Participants ({totalCount})</h3>
              </div>
              <button className="roster-close-btn" onClick={() => setShowRoster(false)}>
                <X size={16} />
              </button>
            </div>

            {/* Host Meeting Controls */}
            {isHost && (
              <div className="roster-host-controls-banner">
                <div className="host-control-label-group">
                  <span className="host-control-heading">Participant Screen Sharing</span>
                  <span className="host-control-subtext">
                    {isScreenShareLocked ? 'Only host can present' : 'Everyone can share screen'}
                  </span>
                </div>
                <label className="syncora-toggle-switch" title="Toggle screen sharing permission for participants">
                  <input
                    type="checkbox"
                    checked={!isScreenShareLocked}
                    onChange={(e) => toggleScreenShareLock(!e.target.checked)}
                  />
                  <span className="syncora-toggle-slider" />
                </label>
              </div>
            )}

            <div className="roster-list">
              {/* Local User in Roster */}
              <div className="roster-item local-roster-item">
                <div className="roster-avatar">
                  {(user as any)?.avatar ? (
                    <img src={(user as any).avatar} alt={user?.name || 'You'} />
                  ) : (
                    <span>{user?.name ? user.name[0].toUpperCase() : 'Y'}</span>
                  )}
                </div>
                <div className="roster-user-details">
                  <span className="roster-name">{user?.name || 'You'} (You)</span>
                  {isHost && <span className="roster-role-tag host">Host</span>}
                  {isScreenSharing && <span className="roster-role-tag presenting">Sharing</span>}
                </div>
                <div className="roster-status-icons">
                  {isMuted ? <MicOff size={14} className="muted-icon" /> : <Mic size={14} />}
                  {isVideoMeeting && (isCameraOff ? <VideoOff size={14} className="muted-icon" /> : <Video size={14} />)}
                </div>
              </div>

              {/* Remote Participants in Roster */}
              {participantsList.map((peer) => {
                const isPeerPresenting = screenPresenter?.socketId === peer.socketId;

                return (
                  <div key={peer.socketId} className="roster-item">
                    <div className="roster-avatar">
                      {peer.userAvatar ? (
                        <img src={peer.userAvatar} alt={peer.userName} />
                      ) : (
                        <span>{peer.userName ? peer.userName[0].toUpperCase() : 'U'}</span>
                      )}
                    </div>
                    <div className="roster-user-details">
                      <span className="roster-name">{peer.userName}</span>
                      {peer.role === 'host' && <span className="roster-role-tag host">Host</span>}
                      {isPeerPresenting && <span className="roster-role-tag presenting">Sharing</span>}
                    </div>
                    <div className="roster-status-icons">
                      {peer.isMuted ? <MicOff size={14} className="muted-icon" /> : <Mic size={14} />}
                      {isVideoMeeting && (peer.isCameraOff ? <VideoOff size={14} className="muted-icon" /> : <Video size={14} />)}
                    </div>

                    {/* Host Action Controls in Roster */}
                    {isHost && peer.role !== 'host' && (
                      <div className="roster-host-actions">
                        {isPeerPresenting && (
                          <button
                            className="roster-action-btn stop-share"
                            onClick={() => hostStopParticipantScreenShare(peer.socketId)}
                            title="Stop screen share"
                          >
                            <MonitorOff size={13} />
                          </button>
                        )}
                        {peer.isMuted ? (
                          <button
                            className="roster-action-btn unmute"
                            onClick={() => hostUnmuteParticipant(peer.socketId)}
                            title="Unmute user"
                          >
                            <Mic size={13} />
                          </button>
                        ) : (
                          <button
                            className="roster-action-btn"
                            onClick={() => hostMuteParticipant(peer.socketId)}
                            title="Mute user"
                          >
                            <MicOff size={13} />
                          </button>
                        )}
                        <button
                          className="roster-action-btn remove"
                          onClick={() => hostRemoveParticipant(peer.socketId)}
                          title="Remove user"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="roster-footer">
              <button className="roster-invite-btn" onClick={() => setShowInviteModal(true)}>
                <UserPlus size={15} /> Invite People
              </button>
            </div>
          </aside>
        )}
      </main>

      {/* Floating Bottom Controls Dock (Google Meet Style) */}
      <footer className="meeting-controls-dock" role="toolbar" aria-label="Meeting controls">
        <div className="dock-actions-row">
          {/* Mic Toggle */}
          <button
            type="button"
            className={`dock-btn ${isMuted ? 'danger-active' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff size={19} /> : <Mic size={19} />}
            <span className="dock-btn-label">{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>

          {/* Camera Toggle (Video meeting only) */}
          {isVideoMeeting && (
            <button
              type="button"
              className={`dock-btn ${isCameraOff ? 'danger-active' : ''}`}
              onClick={toggleCamera}
              title={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
              aria-label={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
            >
              {isCameraOff ? <VideoOff size={19} /> : <Video size={19} />}
              <span className="dock-btn-label">{isCameraOff ? 'Start Video' : 'Stop Video'}</span>
            </button>
          )}

          {/* Live Screen Share Toggle Button (Both Video & Voice meets) */}
          <button
            type="button"
            className={`dock-btn ${isScreenSharing ? 'screen-share-active' : ''} ${isScreenShareLocked && !isHost && !isScreenSharing ? 'disabled-control' : ''}`}
            onClick={isScreenSharing ? stopScreenShare : startScreenShare}
            disabled={isScreenShareLocked && !isHost && !isScreenSharing}
            title={
              isScreenSharing
                ? 'Stop sharing screen'
                : isScreenShareLocked && !isHost
                ? 'Screen sharing is disabled by the host'
                : 'Share entire screen or window'
            }
            aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
          >
            {isScreenSharing ? <MonitorOff size={19} /> : <MonitorUp size={19} />}
            <span className="dock-btn-label">{isScreenSharing ? 'Stop Share' : 'Share Screen'}</span>
          </button>

          {/* In-Meeting Chat Toggle Button */}
          <button
            type="button"
            className={`dock-btn ${showChat ? 'active' : ''}`}
            onClick={handleToggleChat}
            title="In-call chat"
            aria-label="In-call chat"
          >
            <div className="dock-icon-with-badge">
              <MessageSquare size={19} />
              {unreadChatCount > 0 && <span className="dock-badge chat-badge">{unreadChatCount}</span>}
            </div>
            <span className="dock-btn-label">Chat</span>
          </button>

          {/* Participants Toggle */}
          <button
            type="button"
            className={`dock-btn ${showRoster ? 'active' : ''}`}
            onClick={handleToggleRoster}
            title="Participants"
            aria-label="Participants list"
          >
            <div className="dock-icon-with-badge">
              <Users size={19} />
              <span className="dock-badge">{totalCount}</span>
            </div>
            <span className="dock-btn-label">People</span>
          </button>

          {/* Invite Button */}
          <button
            type="button"
            className="dock-btn invite-btn-dock"
            onClick={() => setShowInviteModal(true)}
            title="Invite participants"
            aria-label="Invite participants"
          >
            <UserPlus size={19} />
            <span className="dock-btn-label">Invite</span>
          </button>

          {/* Leave Meeting (Cut Call) */}
          <button
            type="button"
            className="dock-btn leave-btn"
            onClick={leaveMeeting}
            title="Leave / Cut Call"
            aria-label="Leave meeting"
          >
            <PhoneOff size={19} />
            <span className="leave-text">Leave</span>
          </button>

          {/* Host End for Everyone */}
          {isHost && (
            <button
              type="button"
              className="dock-btn end-all-btn"
              onClick={endMeetingForEveryone}
              title="End meeting for all participants"
              aria-label="End meeting for all"
            >
              <Shield size={16} />
              <span className="end-text">End All</span>
            </button>
          )}
        </div>
      </footer>

      {/* In-Meeting Invite Modal */}
      {showInviteModal && (
        <div className="meeting-modal-backdrop" onClick={() => setShowInviteModal(false)}>
          <div className="meeting-modal-content invite-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="meeting-modal-header">
              <div className="meeting-modal-title-group">
                <div className="meeting-modal-icon-badge">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3>Invite Participants</h3>
                  <p className="meeting-modal-subtitle">Add members to this active meeting</p>
                </div>
              </div>
              <button className="meeting-modal-close" onClick={() => setShowInviteModal(false)}>
                <X size={18} />
              </button>
            </div>

            {inviteSuccessMsg && <div className="invite-success-banner">{inviteSuccessMsg}</div>}

            <div className="invite-share-link-box">
              <div className="share-link-info">
                <span className="share-link-label">Share link with teammates:</span>
                <code className="share-link-url">{window.location.origin}/meet/{meeting?.meeting_code}</code>
              </div>
              <button className="meeting-btn-secondary share-copy-btn" onClick={handleCopyLink}>
                {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                {copiedLink ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="invite-search-box">
              <Search size={16} className="search-icon" />
              <input
                type="text"
                placeholder="Search workspace members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="invite-members-list">
              {workspaceMembers
                .filter(
                  (m) =>
                    m.user_id !== user?.user_id &&
                    (m.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      m.email?.toLowerCase().includes(searchQuery.toLowerCase()))
                )
                .map((m) => {
                  const isSelected = selectedInviteIds.includes(m.user_id);
                  const isAlreadyInMeeting = participantsList.some((p) => p.userId === m.user_id);

                  return (
                    <div
                      key={m.user_id}
                      className={`invite-member-item ${isSelected ? 'selected' : ''} ${isAlreadyInMeeting ? 'in-meeting' : ''}`}
                      onClick={() => {
                        if (isAlreadyInMeeting) return;
                        if (isSelected) {
                          setSelectedInviteIds(selectedInviteIds.filter((id) => id !== m.user_id));
                        } else {
                          setSelectedInviteIds([...selectedInviteIds, m.user_id]);
                        }
                      }}
                    >
                      <div className="member-avatar-circle">
                        {m.avatar ? <img src={m.avatar} alt={m.name} /> : <span>{m.name ? m.name[0].toUpperCase() : 'U'}</span>}
                      </div>
                      <div className="member-meta">
                        <span className="member-name">{m.name}</span>
                        <span className="member-email">{m.email}</span>
                      </div>

                      {isAlreadyInMeeting ? (
                        <span className="already-joined-badge">In Call</span>
                      ) : (
                        <div className={`checkbox-circle ${isSelected ? 'checked' : ''}`}>
                          {isSelected && <CheckCircle2 size={16} />}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            <div className="meeting-modal-actions">
              <button
                type="button"
                className="meeting-btn-secondary"
                onClick={() => setShowInviteModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="meeting-btn-primary"
                onClick={handleSendInvites}
                disabled={isInviting || selectedInviteIds.length === 0}
              >
                {isInviting ? (
                  <>
                    <Loader2 size={16} className="spin-icon" /> Sending...
                  </>
                ) : (
                  `Invite (${selectedInviteIds.length})`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
