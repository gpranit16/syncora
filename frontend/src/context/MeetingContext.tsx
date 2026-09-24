import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import {
  getSocket,
  emitMeetingJoin,
  emitMeetingSignal,
  emitMeetingToggleMedia,
  emitMeetingMuteParticipant,
  emitMeetingUnmuteParticipant,
  emitMeetingRemoveParticipant,
  emitMeetingEnd,
  emitMeetingLeave,
  emitMeetingScreenShareStatus,
  emitMeetingStopScreenShare,
  emitMeetingSendMessage,
  emitMeetingToggleScreenShareLock,
} from '../socket/socketManager';
import { Meeting, getMeetingByCode } from '../api/meetings';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelay',
      credential: 'openrelay',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelay',
      credential: 'openrelay',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelay',
      credential: 'openrelay',
    },
  ],
  iceCandidatePoolSize: 10,
};

export interface MeetingParticipantPeer {
  socketId: string;
  userId: number;
  userName: string;
  userAvatar?: string | null;
  userEmail?: string | null;
  role: 'host' | 'participant';
  isMuted: boolean;
  isCameraOff: boolean;
  joinedAt?: string;
}

export interface InMeetingChatMessage {
  message_id: string;
  meeting_code: string;
  sender_socket_id: string;
  sender_id: number;
  sender_name: string;
  sender_avatar?: string | null;
  is_host: boolean;
  text: string;
  created_at: string;
}

export interface ScreenPresenter {
  socketId: string;
  userId: number;
  userName: string;
}

export type MeetingStatus = 'idle' | 'prejoin' | 'joining' | 'in_meeting' | 'ended' | 'error';

interface MeetingContextType {
  meeting: Meeting | null;
  meetingStatus: MeetingStatus;
  errorMessage: string | null;
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  participants: Map<string, MeetingParticipantPeer>;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  isScreenShareLocked: boolean;
  screenPresenter: ScreenPresenter | null;
  meetingMessages: InMeetingChatMessage[];
  isHost: boolean;
  mySocketId: string | null;
  prepareMeeting: (meetingCode: string) => Promise<boolean>;
  joinMeeting: (initialMuted?: boolean, initialCameraOff?: boolean) => Promise<void>;
  leaveMeeting: () => void;
  endMeetingForEveryone: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  toggleScreenShareLock: (locked: boolean) => void;
  hostStopParticipantScreenShare: (targetSocketId: string) => void;
  sendMeetingChatMessage: (text: string) => void;
  hostMuteParticipant: (socketId: string) => void;
  hostUnmuteParticipant: (socketId: string) => void;
  hostRemoveParticipant: (socketId: string) => void;
}

const MeetingContext = createContext<MeetingContextType | undefined>(undefined);

export const MeetingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [meetingStatus, setMeetingStatus] = useState<MeetingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [participants, setParticipants] = useState<Map<string, MeetingParticipantPeer>>(new Map());
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isCameraOff, setIsCameraOff] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isScreenShareLocked, setIsScreenShareLocked] = useState<boolean>(false);
  const [screenPresenter, setScreenPresenter] = useState<ScreenPresenter | null>(null);
  const [meetingMessages, setMeetingMessages] = useState<InMeetingChatMessage[]>([]);
  const [mySocketId, setMySocketId] = useState<string | null>(null);

  const isHost = Boolean(
    meeting && user && (Number(meeting.host_id) === Number(user.user_id) || Number(meeting.host_user_id) === Number(user.user_id))
  );

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const candidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteStreamMapRef = useRef<Map<string, MediaStream>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const savedCameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const meetingRef = useRef<Meeting | null>(null);
  meetingRef.current = meeting;

  // Cleanup helper
  const cleanUpMediaAndPeers = useCallback(() => {
    // Stop screen share tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      screenStreamRef.current = null;
    }
    savedCameraTrackRef.current = null;
    setIsScreenSharing(false);
    setScreenPresenter(null);
    setMeetingMessages([]);

    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);

    // Close all peer connections
    peerConnectionsRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch (_) {}
    });
    peerConnectionsRef.current.clear();
    candidateQueueRef.current.clear();
    remoteStreamMapRef.current.clear();

    setRemoteStreams(new Map());
    setParticipants(new Map());
  }, []);

  // Pre-join: Fetch meeting details and verify access
  const prepareMeeting = useCallback(async (meetingCode: string): Promise<boolean> => {
    try {
      setMeetingStatus('prejoin');
      setErrorMessage(null);
      const data = await getMeetingByCode(meetingCode);
      setMeeting(data);

      if (data.status === 'ended') {
        setMeetingStatus('ended');
        setErrorMessage('This meeting has already ended.');
        return false;
      }
      return true;
    } catch (err: any) {
      console.error('Failed to prepare meeting:', err);
      setMeetingStatus('error');
      setErrorMessage(err?.response?.data?.message || 'Failed to load meeting details');
      return false;
    }
  }, []);

  // Create a peer connection for a remote participant
  const createPeerConnection = useCallback((remoteSocketId: string, currentLocalStream: MediaStream | null, isOfferer = false): RTCPeerConnection => {
    if (peerConnectionsRef.current.has(remoteSocketId)) {
      return peerConnectionsRef.current.get(remoteSocketId)!;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionsRef.current.set(remoteSocketId, pc);

    const activeStream = currentLocalStream || localStreamRef.current;

    // For the offerer, prepare audio & video transceivers with 'sendrecv' direction
    if (isOfferer) {
      let audioTransceiver: RTCRtpTransceiver | null = null;
      let videoTransceiver: RTCRtpTransceiver | null = null;

      try {
        audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      } catch (tErr) {
        console.warn('[WebRTC] addTransceiver audio error:', tErr);
      }

      try {
        videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
      } catch (tErr) {
        console.warn('[WebRTC] addTransceiver video error:', tErr);
      }

      if (activeStream) {
        const audioTrack = activeStream.getAudioTracks()[0];
        const videoTrack = activeStream.getVideoTracks()[0];

        if (audioTransceiver) {
          if (audioTrack && audioTransceiver.sender) {
            audioTransceiver.sender.replaceTrack(audioTrack).catch((e) => {
              console.warn(`[WebRTC] replaceTrack audio error for ${remoteSocketId}:`, e);
            });
            audioTransceiver.direction = 'sendrecv';
          } else {
            audioTransceiver.direction = 'recvonly';
          }
        }

        if (videoTransceiver) {
          if (videoTrack && videoTransceiver.sender) {
            videoTransceiver.sender.replaceTrack(videoTrack).catch((e) => {
              console.warn(`[WebRTC] replaceTrack video error for ${remoteSocketId}:`, e);
            });
            videoTransceiver.direction = 'sendrecv';
          } else {
            // Offerer has camera off, but explicitly wants to receive remote video
            videoTransceiver.direction = 'recvonly';
          }
        }
      }
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && meetingRef.current) {
        emitMeetingSignal({
          meeting_code: meetingRef.current.meeting_code,
          target_socket_id: remoteSocketId,
          signal: {
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
          },
        });
      }
    };

    // Handle remote tracks and accumulate in stream
    pc.ontrack = (event) => {
      console.log(`[WebRTC] ontrack received from ${remoteSocketId}: ${event.track.kind} (id: ${event.track.id})`, event.streams);

      let streamAccumulator = remoteStreamMapRef.current.get(remoteSocketId);
      if (!streamAccumulator) {
        streamAccumulator = new MediaStream();
        remoteStreamMapRef.current.set(remoteSocketId, streamAccumulator);
      }

      // Clean up ended or replaced tracks of the same kind
      streamAccumulator.getTracks().forEach((t) => {
        if (t.kind === event.track.kind && (t.readyState === 'ended' || t.id !== event.track.id)) {
          try {
            streamAccumulator!.removeTrack(t);
          } catch (_) {}
        }
      });

      // Add single track if not already in accumulator
      if (!streamAccumulator.getTracks().some((t) => t.id === event.track.id)) {
        streamAccumulator.addTrack(event.track);
      }

      // If stream was attached in event, also copy any additional tracks
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((t) => {
          if (!streamAccumulator!.getTracks().some((ex) => ex.id === t.id)) {
            streamAccumulator!.addTrack(t);
          }
        });
      }

      const syncRemoteStreamState = () => {
        const currentStream = remoteStreamMapRef.current.get(remoteSocketId);
        if (currentStream) {
          const fresh = new MediaStream(currentStream.getTracks());
          console.log(`[WebRTC] Synced remote stream for ${remoteSocketId}: [Audio: ${fresh.getAudioTracks().length}, Video: ${fresh.getVideoTracks().length}]`);
          setRemoteStreams((prev) => {
            const updated = new Map(prev);
            updated.set(remoteSocketId, fresh);
            return updated;
          });
        }
      };

      syncRemoteStreamState();

      event.track.onunmute = () => {
        console.log(`[WebRTC] Track onunmute from ${remoteSocketId}: ${event.track.kind}`);
        syncRemoteStreamState();
      };
      event.track.onmute = () => {
        console.log(`[WebRTC] Track onmute from ${remoteSocketId}: ${event.track.kind}`);
        syncRemoteStreamState();
      };
      event.track.onended = () => {
        console.log(`[WebRTC] Track onended from ${remoteSocketId}: ${event.track.kind}`);
        syncRemoteStreamState();
      };
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${remoteSocketId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        peerConnectionsRef.current.delete(remoteSocketId);
        remoteStreamMapRef.current.delete(remoteSocketId);
        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          updated.delete(remoteSocketId);
          return updated;
        });
      }
    };

    return pc;
  }, []);

  // Join the meeting with media setup
  const joinMeeting = useCallback(async (initialMuted = false, initialCameraOff = false) => {
    if (!meeting || !user) return;

    setMeetingStatus('joining');
    setIsMuted(initialMuted);
    setIsCameraOff(initialCameraOff);

    const isVideoMeeting = (meeting.mode || meeting.meeting_type) === 'video';

    let stream: MediaStream | null = null;
    try {
      if (isVideoMeeting) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: initialCameraOff ? false : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          });
        } catch (videoErr) {
          console.warn('Camera access denied or unavailable, falling back to audio only', videoErr);
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false,
          });
          initialCameraOff = true;
          setIsCameraOff(true);
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        initialCameraOff = true;
        setIsCameraOff(true);
      }

      // Apply initial mute
      if (initialMuted && stream) {
        stream.getAudioTracks().forEach((track) => (track.enabled = false));
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
    } catch (mediaErr: any) {
      console.error('Failed to get media devices:', mediaErr);
      setMeetingStatus('error');
      setErrorMessage('Could not access microphone or camera. Please check permissions.');
      return;
    }

    // Join via Socket
    emitMeetingJoin({
      meeting_code: meeting.meeting_code,
      user_id: user.user_id,
      user_name: user.name || 'User',
      user_avatar: (user as any).avatar || null,
      user_email: user.email || null,
      is_muted: initialMuted,
      is_camera_off: initialCameraOff,
    });
  }, [meeting, user]);

  // Socket event listeners for meeting room
  useEffect(() => {
    const socket = getSocket();

    const handleMeetingJoinedSuccess = async (data: any) => {
      setMeetingStatus('in_meeting');
      if (data.my_socket_id) setMySocketId(data.my_socket_id);
      if (data.screen_presenter) setScreenPresenter(data.screen_presenter);
      if (typeof data.screen_share_locked === 'boolean') setIsScreenShareLocked(data.screen_share_locked);
      if (data.chat_history && Array.isArray(data.chat_history)) setMeetingMessages(data.chat_history);

      const existingPeers: any[] = data.existing_participants || [];
      const newParticipantsMap = new Map<string, MeetingParticipantPeer>();

      existingPeers.forEach((p) => {
        newParticipantsMap.set(p.socket_id, {
          socketId: p.socket_id,
          userId: p.user_id,
          userName: p.user_name,
          userAvatar: p.user_avatar,
          userEmail: p.user_email,
          role: p.role,
          isMuted: p.is_muted,
          isCameraOff: p.is_camera_off,
          joinedAt: p.joined_at,
        });
      });

      setParticipants(newParticipantsMap);

      // We are the newly joined peer: create SDP offers to all existing participants in mesh
      for (const p of existingPeers) {
        try {
          const pc = createPeerConnection(p.socket_id, localStreamRef.current, true);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          emitMeetingSignal({
            meeting_code: meetingRef.current?.meeting_code || '',
            target_socket_id: p.socket_id,
            signal: {
              type: 'offer',
              sdp: offer.sdp,
            },
          });
        } catch (err) {
          console.error(`Failed to initiate offer to peer ${p.socket_id}:`, err);
        }
      }
    };

    const handleMeetingUserJoined = (data: any) => {
      setParticipants((prev) => {
        const updated = new Map(prev);
        updated.set(data.socket_id, {
          socketId: data.socket_id,
          userId: data.user_id,
          userName: data.user_name,
          userAvatar: data.user_avatar,
          userEmail: data.user_email,
          role: data.role,
          isMuted: data.is_muted,
          isCameraOff: data.is_camera_off,
          joinedAt: data.joined_at,
        });
        return updated;
      });
    };

    const handleMeetingSignal = async (data: any) => {
      const { sender_socket_id, signal } = data || {};
      if (!sender_socket_id || !signal) return;

      let pc = peerConnectionsRef.current.get(sender_socket_id);
      if (!pc) {
        pc = createPeerConnection(sender_socket_id, localStreamRef.current);
      }

      try {
        if (signal.type === 'offer') {
          // If we receive an offer while not in stable state, rollback to avoid glare collision
          if (pc.signalingState !== 'stable') {
            await Promise.all([
              pc.setLocalDescription({ type: 'rollback' }).catch(() => {}),
              pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp })),
            ]);
          } else {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          }

          // Ensure local tracks are attached to the matching transceivers after setting remote offer
          const activeStream = localStreamRef.current;
          const audioTrack = activeStream?.getAudioTracks()[0];
          const screenTrack = screenStreamRef.current?.getVideoTracks().find((t) => t.readyState === 'live');
          const cameraTrack = !isCameraOff ? activeStream?.getVideoTracks().find((t) => t.readyState === 'live') : null;
          const localVideoTrack = screenTrack || cameraTrack;
          const transceivers = pc.getTransceivers();

          const audioTransceiver = transceivers.find((t) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio');
          if (audioTransceiver) {
            if (audioTrack && audioTransceiver.sender) {
              await audioTransceiver.sender.replaceTrack(audioTrack);
              audioTransceiver.direction = 'sendrecv';
            } else {
              audioTransceiver.direction = 'recvonly';
            }
          }

          const videoTransceiver = transceivers.find((t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
          if (videoTransceiver) {
            if (localVideoTrack && videoTransceiver.sender) {
              await videoTransceiver.sender.replaceTrack(localVideoTrack);
              videoTransceiver.direction = 'sendrecv';
            } else {
              videoTransceiver.direction = 'recvonly';
            }
          }

          // Process queued ICE candidates safely
          const queued = candidateQueueRef.current.get(sender_socket_id) || [];
          for (const cand of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (candErr) {
              console.warn('[WebRTC] addIceCandidate error:', candErr);
            }
          }
          candidateQueueRef.current.delete(sender_socket_id);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          emitMeetingSignal({
            meeting_code: meetingRef.current?.meeting_code || '',
            target_socket_id: sender_socket_id,
            signal: {
              type: 'answer',
              sdp: answer.sdp,
            },
          });
        } else if (signal.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          }

          // Process queued ICE candidates safely
          const queued = candidateQueueRef.current.get(sender_socket_id) || [];
          for (const cand of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (candErr) {
              console.warn('[WebRTC] addIceCandidate error:', candErr);
            }
          }
          candidateQueueRef.current.delete(sender_socket_id);
        } else if (signal.type === 'ice-candidate') {
          if (signal.candidate) {
            if (pc.remoteDescription && pc.remoteDescription.type) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
              } catch (candErr) {
                console.warn('[WebRTC] addIceCandidate error:', candErr);
              }
            } else {
              const queue = candidateQueueRef.current.get(sender_socket_id) || [];
              queue.push(signal.candidate);
              candidateQueueRef.current.set(sender_socket_id, queue);
            }
          }
        }
      } catch (signalErr) {
        console.error(`Signaling error with peer ${sender_socket_id}:`, signalErr);
      }
    };

    const handleMeetingUserUpdated = (data: any) => {
      setParticipants((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(data.socket_id);
        if (existing) {
          updated.set(data.socket_id, {
            ...existing,
            isMuted: typeof data.is_muted === 'boolean' ? data.is_muted : existing.isMuted,
            isCameraOff: typeof data.is_camera_off === 'boolean' ? data.is_camera_off : existing.isCameraOff,
          });
        }
        return updated;
      });
    };

    const handleMeetingUserLeft = (data: any) => {
      const { socket_id } = data || {};
      if (socket_id) {
        const pc = peerConnectionsRef.current.get(socket_id);
        if (pc) {
          pc.close();
          peerConnectionsRef.current.delete(socket_id);
        }
        candidateQueueRef.current.delete(socket_id);
        remoteStreamMapRef.current.delete(socket_id);

        setRemoteStreams((prev) => {
          const updated = new Map(prev);
          updated.delete(socket_id);
          return updated;
        });

        setParticipants((prev) => {
          const updated = new Map(prev);
          updated.delete(socket_id);
          return updated;
        });
      }
    };

    const handleMeetingForcedMute = () => {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      setIsMuted(true);
      if (meetingRef.current) {
        emitMeetingToggleMedia({
          meeting_code: meetingRef.current.meeting_code,
          is_muted: true,
        });
      }
    };

    const handleMeetingForcedUnmute = () => {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
      }
      setIsMuted(false);
      if (meetingRef.current) {
        emitMeetingToggleMedia({
          meeting_code: meetingRef.current.meeting_code,
          is_muted: false,
        });
      }
    };

    const handleMeetingRemoved = (data: any) => {
      cleanUpMediaAndPeers();
      setMeetingStatus('ended');
      setErrorMessage(data?.reason || 'You were removed from the meeting by the host');
    };

    const handleMeetingEnded = (data: any) => {
      cleanUpMediaAndPeers();
      setMeetingStatus('ended');
      setErrorMessage(data?.reason || 'The meeting has ended');
    };

    const handleMeetingError = (data: any) => {
      setMeetingStatus('error');
      setErrorMessage(data?.message || 'Meeting error occurred');
    };

    const handleMeetingScreenShareStatus = (data: any) => {
      const { socket_id, user_id, user_name, is_sharing } = data || {};
      if (is_sharing) {
        setScreenPresenter({
          socketId: socket_id,
          userId: user_id,
          userName: user_name,
        });
      } else {
        setScreenPresenter((prev) => (prev?.socketId === socket_id ? null : prev));
      }
    };

    const handleMeetingForceStopScreenShare = () => {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_) {}
        });
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);

      // Restore camera if active
      if (localStreamRef.current) {
        const videoTracks = localStreamRef.current.getVideoTracks();
        videoTracks.forEach((t) => localStreamRef.current?.removeTrack(t));
        const cameraTrack = savedCameraTrackRef.current;
        if (!isCameraOff && cameraTrack && cameraTrack.readyState === 'live') {
          localStreamRef.current.addTrack(cameraTrack);
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
          peerConnectionsRef.current.forEach((pc) => {
            const transceivers = pc.getTransceivers();
            const videoTransceiver = transceivers.find(
              (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
            );
            if (videoTransceiver && videoTransceiver.sender) {
              videoTransceiver.sender.replaceTrack(cameraTrack).catch(() => {});
              videoTransceiver.direction = 'sendrecv';
            }
          });
        } else {
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
          peerConnectionsRef.current.forEach((pc) => {
            const transceivers = pc.getTransceivers();
            const videoTransceiver = transceivers.find(
              (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
            );
            if (videoTransceiver && videoTransceiver.sender) {
              videoTransceiver.sender.replaceTrack(null).catch(() => {});
              videoTransceiver.direction = 'recvonly';
            }
          });
        }
      }
      savedCameraTrackRef.current = null;
      setScreenPresenter((prev) => (prev?.userId === user?.user_id ? null : prev));
    };

    const handleMeetingNewMessage = (data: InMeetingChatMessage) => {
      setMeetingMessages((prev) => [...prev, data]);
    };

    const handleMeetingScreenShareLockUpdated = (data: any) => {
      if (typeof data?.is_locked === 'boolean') {
        setIsScreenShareLocked(data.is_locked);
      }
    };

    socket.on('meeting_joined_success', handleMeetingJoinedSuccess);
    socket.on('meeting_user_joined', handleMeetingUserJoined);
    socket.on('meeting_signal', handleMeetingSignal);
    socket.on('meeting_user_updated', handleMeetingUserUpdated);
    socket.on('meeting_user_left', handleMeetingUserLeft);
    socket.on('meeting_forced_mute', handleMeetingForcedMute);
    socket.on('meeting_forced_unmute', handleMeetingForcedUnmute);
    socket.on('meeting_screen_share_status', handleMeetingScreenShareStatus);
    socket.on('meeting_screen_share_lock_updated', handleMeetingScreenShareLockUpdated);
    socket.on('meeting_force_stop_screen_share', handleMeetingForceStopScreenShare);
    socket.on('meeting_new_message', handleMeetingNewMessage);
    socket.on('meeting_removed', handleMeetingRemoved);
    socket.on('meeting_ended', handleMeetingEnded);
    socket.on('meeting_error', handleMeetingError);

    return () => {
      socket.off('meeting_joined_success', handleMeetingJoinedSuccess);
      socket.off('meeting_user_joined', handleMeetingUserJoined);
      socket.off('meeting_signal', handleMeetingSignal);
      socket.off('meeting_user_updated', handleMeetingUserUpdated);
      socket.off('meeting_user_left', handleMeetingUserLeft);
      socket.off('meeting_forced_mute', handleMeetingForcedMute);
      socket.off('meeting_forced_unmute', handleMeetingForcedUnmute);
      socket.off('meeting_screen_share_status', handleMeetingScreenShareStatus);
      socket.off('meeting_screen_share_lock_updated', handleMeetingScreenShareLockUpdated);
      socket.off('meeting_force_stop_screen_share', handleMeetingForceStopScreenShare);
      socket.off('meeting_new_message', handleMeetingNewMessage);
      socket.off('meeting_removed', handleMeetingRemoved);
      socket.off('meeting_ended', handleMeetingEnded);
      socket.off('meeting_error', handleMeetingError);
    };
  }, [createPeerConnection, cleanUpMediaAndPeers]);

  // Toggle local microphone
  const toggleMute = useCallback(async () => {
    const nextMuted = !isMuted;

    if (!nextMuted) {
      // User is UNMUTING: make sure a valid live audio track exists and is enabled
      let hasLiveTrack = false;
      if (localStreamRef.current) {
        const audioTracks = localStreamRef.current.getAudioTracks();
        const liveTrack = audioTracks.find((t) => t.readyState === 'live');
        if (liveTrack) {
          liveTrack.enabled = true;
          hasLiveTrack = true;
        }
      }

      if (!hasLiveTrack) {
        // Track was lost or stopped; re-acquire fresh audio track
        try {
          const freshStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          const freshTrack = freshStream.getAudioTracks()[0];
          if (freshTrack) {
            freshTrack.enabled = true;
            if (!localStreamRef.current) {
              localStreamRef.current = new MediaStream([freshTrack]);
            } else {
              localStreamRef.current.getAudioTracks().forEach((t) => {
                if (t.readyState === 'ended') {
                  localStreamRef.current?.removeTrack(t);
                }
              });
              localStreamRef.current.addTrack(freshTrack);
            }
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

            // Replace or add track in peer connections
            peerConnectionsRef.current.forEach((pc) => {
              const transceivers = pc.getTransceivers();
              const audioTransceiver = transceivers.find(
                (t) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
              );
              if (audioTransceiver && audioTransceiver.sender) {
                audioTransceiver.sender.replaceTrack(freshTrack).catch(() => {});
              }
            });
          }
        } catch (err) {
          console.error('Failed to re-acquire microphone track on unmute:', err);
        }
      }
    } else {
      // User is MUTING: disable all audio tracks
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((t) => {
          t.enabled = false;
        });
      }
    }

    setIsMuted(nextMuted);

    if (meetingRef.current) {
      emitMeetingToggleMedia({
        meeting_code: meetingRef.current.meeting_code,
        is_muted: nextMuted,
      });
    }
  }, [isMuted]);

  // Toggle local camera
  const toggleCamera = useCallback(async () => {
    if (!meetingRef.current) return;
    const isVideoMeeting = (meetingRef.current.mode || meetingRef.current.meeting_type) === 'video';
    if (!isVideoMeeting) return;

    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0 && videoTracks[0].readyState === 'live') {
        const nextCameraOff = !isCameraOff;
        videoTracks.forEach((t) => (t.enabled = !nextCameraOff));
        setIsCameraOff(nextCameraOff);

        // Update sender track across peer connections
        peerConnectionsRef.current.forEach((pc) => {
          const transceivers = pc.getTransceivers();
          const videoTransceiver = transceivers.find(
            (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
          );
          if (videoTransceiver && videoTransceiver.sender) {
            videoTransceiver.sender.replaceTrack(nextCameraOff ? null : videoTracks[0]).catch(() => {});
          }
        });

        emitMeetingToggleMedia({
          meeting_code: meetingRef.current.meeting_code,
          is_camera_off: nextCameraOff,
        });
      } else {
        // No video track yet or ended: acquire fresh one and attach to transceivers
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          });
          const newVideoTrack = videoStream.getVideoTracks()[0];
          if (newVideoTrack) {
            localStreamRef.current.getVideoTracks().forEach((t) => {
              localStreamRef.current?.removeTrack(t);
            });
            localStreamRef.current.addTrack(newVideoTrack);

            // Add or replace in all peer connections and renegotiate
            for (const [remoteSocketId, pc] of peerConnectionsRef.current.entries()) {
              try {
                const transceivers = pc.getTransceivers();
                let videoTransceiver = transceivers.find(
                  (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
                );
                if (videoTransceiver && videoTransceiver.sender) {
                  await videoTransceiver.sender.replaceTrack(newVideoTrack);
                  videoTransceiver.direction = 'sendrecv';
                } else {
                  videoTransceiver = pc.addTransceiver(newVideoTrack, {
                    direction: 'sendrecv',
                    streams: [localStreamRef.current!],
                  });
                }

                if (pc.signalingState !== 'closed') {
                  const offer = await pc.createOffer();
                  await pc.setLocalDescription(offer);
                  emitMeetingSignal({
                    meeting_code: meetingRef.current?.meeting_code || '',
                    target_socket_id: remoteSocketId,
                    signal: { type: 'offer', sdp: offer.sdp },
                  });
                }
              } catch (camErr) {
                console.warn(`[WebRTC] Camera enable renegotiation error for ${remoteSocketId}:`, camErr);
              }
            }

            setIsCameraOff(false);
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

            emitMeetingToggleMedia({
              meeting_code: meetingRef.current.meeting_code,
              is_camera_off: false,
            });
          }
        } catch (err) {
          console.error('Failed to enable camera:', err);
        }
      }
    }
  }, [isCameraOff]);

  // Start Live Screen Share (Google Meet style with Mobile & Phone Fallbacks)
  const startScreenShare = useCallback(async () => {
    if (!meetingRef.current) return;

    if (isScreenShareLocked && !isHost) {
      alert('Screen sharing is currently disabled by the meeting host.');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('Screen sharing is not supported in this browser or environment. Please use Google Chrome, Edge, or a modern mobile browser.');
      return;
    }

    try {
      let displayStream: MediaStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 60 },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          } as any,
          audio: false,
        });
      } catch (constraintErr: any) {
        // Fallback for mobile phones / tablets with strict constraint parsers
        console.warn('[ScreenShare] Ideal constraints failed, attempting basic mobile fallback:', constraintErr);
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
      }

      const screenVideoTrack = displayStream.getVideoTracks()[0];
      if (!screenVideoTrack) return;

      screenStreamRef.current = displayStream;
      setIsScreenSharing(true);

      // Save current camera track if any
      if (localStreamRef.current) {
        const existingVideoTrack = localStreamRef.current.getVideoTracks().find((t) => t.readyState === 'live');
        if (existingVideoTrack) {
          savedCameraTrackRef.current = existingVideoTrack;
          localStreamRef.current.removeTrack(existingVideoTrack);
        }
        localStreamRef.current.addTrack(screenVideoTrack);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      } else {
        localStreamRef.current = new MediaStream([screenVideoTrack]);
        setLocalStream(new MediaStream([screenVideoTrack]));
      }

      // Replace video track in all peer connections and renegotiate so all peers receive the live screen
      for (const [remoteSocketId, pc] of peerConnectionsRef.current.entries()) {
        try {
          const transceivers = pc.getTransceivers();
          let videoTransceiver = transceivers.find(
            (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
          );

          if (videoTransceiver && videoTransceiver.sender) {
            await videoTransceiver.sender.replaceTrack(screenVideoTrack);
            videoTransceiver.direction = 'sendrecv';
          } else {
            videoTransceiver = pc.addTransceiver(screenVideoTrack, {
              direction: 'sendrecv',
              streams: [localStreamRef.current!],
            });
          }

          if (pc.signalingState !== 'closed') {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            emitMeetingSignal({
              meeting_code: meetingRef.current?.meeting_code || '',
              target_socket_id: remoteSocketId,
              signal: {
                type: 'offer',
                sdp: offer.sdp,
              },
            });
            console.log(`[ScreenShare] Renegotiation offer sent to ${remoteSocketId}`);
          }
        } catch (shareErr) {
          console.warn(`[ScreenShare] Failed to send screen offer to ${remoteSocketId}:`, shareErr);
        }
      }

      // Handle browser's native "Stop Sharing" floating bar button
      screenVideoTrack.onended = () => {
        stopScreenShare();
      };

      emitMeetingScreenShareStatus({
        meeting_code: meetingRef.current.meeting_code,
        is_sharing: true,
      });

      if (user) {
        setScreenPresenter({
          socketId: mySocketId || 'local',
          userId: user.user_id,
          userName: user.name || 'You',
        });
      }
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        console.error('Failed to start screen share:', err);
      }
    }
  }, [isScreenShareLocked, isHost, mySocketId, user]);

  // Stop Live Screen Share
  const stopScreenShare = useCallback(async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      screenStreamRef.current = null;
    }

    setIsScreenSharing(false);

    // Remove screen track from local stream
    let cameraTrackToRestore: MediaStreamTrack | null = null;
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach((t) => {
        localStreamRef.current?.removeTrack(t);
      });

      // Restore camera track if camera was active
      const cameraTrack = savedCameraTrackRef.current;
      if (!isCameraOff && cameraTrack && cameraTrack.readyState === 'live') {
        cameraTrackToRestore = cameraTrack;
        localStreamRef.current.addTrack(cameraTrack);
      }
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    }

    savedCameraTrackRef.current = null;

    // Renegotiate with peers so remote sides revert to camera or stop receiving video
    for (const [remoteSocketId, pc] of peerConnectionsRef.current.entries()) {
      try {
        const transceivers = pc.getTransceivers();
        const videoTransceiver = transceivers.find(
          (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
        );
        if (videoTransceiver && videoTransceiver.sender) {
          await videoTransceiver.sender.replaceTrack(cameraTrackToRestore);
          videoTransceiver.direction = cameraTrackToRestore ? 'sendrecv' : 'recvonly';
        }

        if (pc.signalingState !== 'closed') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          emitMeetingSignal({
            meeting_code: meetingRef.current?.meeting_code || '',
            target_socket_id: remoteSocketId,
            signal: {
              type: 'offer',
              sdp: offer.sdp,
            },
          });
        }
      } catch (stopErr) {
        console.warn(`[ScreenShare] Stop screen share renegotiation error for ${remoteSocketId}:`, stopErr);
      }
    }

    if (meetingRef.current) {
      emitMeetingScreenShareStatus({
        meeting_code: meetingRef.current.meeting_code,
        is_sharing: false,
      });
    }

    setScreenPresenter((prev) => (prev?.userId === user?.user_id ? null : prev));
  }, [isCameraOff, user]);

  // Host: Toggle screen share lock for all participants
  const toggleScreenShareLock = useCallback((locked: boolean) => {
    if (meetingRef.current && isHost) {
      setIsScreenShareLocked(locked);
      emitMeetingToggleScreenShareLock({
        meeting_code: meetingRef.current.meeting_code,
        is_locked: locked,
      });
    }
  }, [isHost]);

  // Host: Stop participant screen share
  const hostStopParticipantScreenShare = useCallback((targetSocketId: string) => {
    if (meetingRef.current && isHost) {
      emitMeetingStopScreenShare({
        meeting_code: meetingRef.current.meeting_code,
        target_socket_id: targetSocketId,
      });
    }
  }, [isHost]);

  // In-Meeting Chat: Send text message
  const sendMeetingChatMessage = useCallback((text: string) => {
    if (meetingRef.current && text.trim()) {
      emitMeetingSendMessage({
        meeting_code: meetingRef.current.meeting_code,
        message: text.trim(),
      });
    }
  }, []);

  // Leave meeting
  const leaveMeeting = useCallback(() => {
    if (meetingRef.current) {
      emitMeetingLeave({ meeting_code: meetingRef.current.meeting_code });
    }
    cleanUpMediaAndPeers();
    setMeetingStatus('idle');
    setMeeting(null);
    navigate('/dashboard');
  }, [cleanUpMediaAndPeers, navigate]);

  // End meeting for everyone (Host only)
  const endMeetingForEveryone = useCallback(async () => {
    if (meetingRef.current && isHost) {
      emitMeetingEnd({ meeting_code: meetingRef.current.meeting_code });
    }
    cleanUpMediaAndPeers();
    setMeetingStatus('idle');
    setMeeting(null);
    navigate('/dashboard');
  }, [isHost, cleanUpMediaAndPeers, navigate]);

  // Host: Mute participant
  const hostMuteParticipant = useCallback((targetSocketId: string) => {
    if (meetingRef.current && isHost) {
      emitMeetingMuteParticipant({
        meeting_code: meetingRef.current.meeting_code,
        target_socket_id: targetSocketId,
      });
    }
  }, [isHost]);

  // Host: Unmute participant
  const hostUnmuteParticipant = useCallback((targetSocketId: string) => {
    if (meetingRef.current && isHost) {
      emitMeetingUnmuteParticipant({
        meeting_code: meetingRef.current.meeting_code,
        target_socket_id: targetSocketId,
      });
    }
  }, [isHost]);

  // Host: Remove participant
  const hostRemoveParticipant = useCallback((targetSocketId: string) => {
    if (meetingRef.current && isHost) {
      emitMeetingRemoveParticipant({
        meeting_code: meetingRef.current.meeting_code,
        target_socket_id: targetSocketId,
      });
    }
  }, [isHost]);

  // Clean up on unmount or tab close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (meetingRef.current) {
        emitMeetingLeave({ meeting_code: meetingRef.current.meeting_code });
      }
      cleanUpMediaAndPeers();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanUpMediaAndPeers();
    };
  }, [cleanUpMediaAndPeers]);

  return (
    <MeetingContext.Provider
      value={{
        meeting,
        meetingStatus,
        errorMessage,
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
        mySocketId,
        prepareMeeting,
        joinMeeting,
        leaveMeeting,
        endMeetingForEveryone,
        toggleMute,
        toggleCamera,
        startScreenShare,
        stopScreenShare,
        toggleScreenShareLock,
        hostStopParticipantScreenShare,
        sendMeetingChatMessage,
        hostMuteParticipant,
        hostUnmuteParticipant,
        hostRemoveParticipant,
      }}
    >
      {children}
    </MeetingContext.Provider>
  );
};

export const useMeeting = () => {
  const context = useContext(MeetingContext);
  if (!context) {
    throw new Error('useMeeting must be used within a MeetingProvider');
  }
  return context;
};
