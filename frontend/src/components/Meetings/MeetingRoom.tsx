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
  onMute?: (socketId: string) => void;
  onUnmute?: (socketId: string) => void;
  onRemove?: (socketId: string) => void;
}> = ({ participant, stream, isVideoMeeting, isHostUser, onMute, onUnmute, onRemove }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (stream) {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
      }
    }
  }, [stream]);

  const hasVideo = isVideoMeeting && !participant.isCameraOff && stream && stream.getVideoTracks().length > 0;

  return (
    <div className={`meeting-tile ${hasVideo ? 'has-video' : 'avatar-only'}`}>
      {/* Remote Audio Track is always active in background for audible playback */}
      <audio ref={audioRef} autoPlay playsInline />

      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="participant-video-elem"
        />
      ) : (
        <div className="participant-avatar-container">
          <div className="participant-avatar-circle">
            {participant.userAvatar ? (
              <img src={participant.userAvatar} alt={participant.userName} />
            ) : (
              <span>{participant.userName ? participant.userName[0].toUpperCase() : 'U'}</span>
            )}
          </div>
          <span className="participant-avatar-name">{participant.userName}</span>
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
}> = ({ stream, userName, userAvatar, isHost, isMuted, isCameraOff, isVideoMeeting }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && stream && !isCameraOff) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, isCameraOff]);

  const hasVideo = isVideoMeeting && !isCameraOff && stream && stream.getVideoTracks().length > 0;

  return (
    <div className={`meeting-tile local-tile ${hasVideo ? 'has-video' : 'avatar-only'}`}>
      {hasVideo ? (
        <video
          ref={videoRef}
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
          <span className="participant-avatar-name">{userName} (You)</span>
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

export const MeetingRoom: React.FC = () => {
  const { user } = useAuth();
  const {
    meeting,
    localStream,
    remoteStreams,
    participants,
    isMuted,
    isCameraOff,
    isHost,
    toggleMute,
    toggleCamera,
    leaveMeeting,
    endMeetingForEveryone,
    hostMuteParticipant,
    hostUnmuteParticipant,
    hostRemoveParticipant,
  } = useMeeting();

  const [copiedLink, setCopiedLink] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

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

    // Active Watchdog Heartbeat: ensures recognition never stalls or dies during long meetings
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
        </div>

        <div className="header-right">
          <button className="copy-code-btn" onClick={handleCopyLink}>
            {copiedLink ? <Check size={14} className="copied-icon" /> : <Copy size={14} />}
            <span>{copiedLink ? 'Link Copied' : meeting?.meeting_code}</span>
          </button>

          <button
            className={`roster-toggle-btn ${showRoster ? 'active' : ''}`}
            onClick={() => setShowRoster(!showRoster)}
            title="Toggle Participants"
          >
            <Users size={16} />
            <span className="participant-count-badge">{totalCount}</span>
          </button>
        </div>
      </header>

      {/* Main Grid Stage */}
      <main className="meeting-stage-layout">
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
          />

          {/* Remote Participants Tiles */}
          {participantsList.map((peer) => (
            <ParticipantTile
              key={peer.socketId}
              participant={peer}
              stream={remoteStreams.get(peer.socketId)}
              isVideoMeeting={isVideoMeeting}
              isHostUser={isHost}
              onMute={hostMuteParticipant}
              onUnmute={hostUnmuteParticipant}
              onRemove={hostRemoveParticipant}
            />
          ))}
        </div>

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
                </div>
                <div className="roster-status-icons">
                  {isMuted ? <MicOff size={14} className="muted-icon" /> : <Mic size={14} />}
                  {isVideoMeeting && (isCameraOff ? <VideoOff size={14} className="muted-icon" /> : <Video size={14} />)}
                </div>
              </div>

              {/* Remote Participants in Roster */}
              {participantsList.map((peer) => (
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
                  </div>
                  <div className="roster-status-icons">
                    {peer.isMuted ? <MicOff size={14} className="muted-icon" /> : <Mic size={14} />}
                    {isVideoMeeting && (peer.isCameraOff ? <VideoOff size={14} className="muted-icon" /> : <Video size={14} />)}
                  </div>

                  {/* Host Action Controls in Roster */}
                  {isHost && peer.role !== 'host' && (
                    <div className="roster-host-actions">
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
              ))}
            </div>

            <div className="roster-footer">
              <button className="roster-invite-btn" onClick={() => setShowInviteModal(true)}>
                <UserPlus size={15} /> Invite People
              </button>
            </div>
          </aside>
        )}
      </main>

      {/* Floating Bottom Controls Dock */}
      <footer className="meeting-controls-dock">
        <div className="dock-group">
          {/* Mic Toggle */}
          <button
            className={`dock-btn ${isMuted ? 'danger-active' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>

          {/* Camera Toggle (Video meeting only) */}
          {isVideoMeeting && (
            <button
              className={`dock-btn ${isCameraOff ? 'danger-active' : ''}`}
              onClick={toggleCamera}
              title={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
            >
              {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
            </button>
          )}

          {/* Invite Button */}
          <button
            className="dock-btn"
            onClick={() => setShowInviteModal(true)}
            title="Invite participants"
          >
            <UserPlus size={20} />
          </button>

          {/* Participants Toggle */}
          <button
            className={`dock-btn ${showRoster ? 'active' : ''}`}
            onClick={() => setShowRoster(!showRoster)}
            title="Participants"
          >
            <Users size={20} />
          </button>
        </div>

        <div className="dock-group">
          {/* Leave Meeting (Individual) */}
          <button className="dock-btn leave-btn" onClick={leaveMeeting} title="Leave meeting">
            <PhoneOff size={20} />
            <span>Leave</span>
          </button>

          {/* Host End for Everyone */}
          {isHost && (
            <button
              className="dock-btn end-all-btn"
              onClick={endMeetingForEveryone}
              title="End meeting for all participants"
            >
              <Shield size={16} />
              <span>End All</span>
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
