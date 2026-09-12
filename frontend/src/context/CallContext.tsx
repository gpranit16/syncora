import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  getSocket,
  emitCallUser,
  emitCallAccept,
  emitCallReject,
  emitCallEnd,
  emitWebrtcSignal,
} from '../socket/socketManager';

export type CallType = 'voice' | 'video';
export type CallState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended';

export interface CallParticipant {
  user_id: number;
  name: string;
  avatar?: string | null;
}

export interface IncomingCallData {
  call_id: string;
  caller: CallParticipant;
  call_type: CallType;
  offer?: RTCSessionDescriptionInit | null;
}

interface CallContextType {
  callState: CallState;
  callType: CallType;
  callId: string | null;
  remoteUser: CallParticipant | null;
  incomingCall: IncomingCallData | null;
  isInitiator: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isAudioMuted: boolean;
  isVideoOff: boolean;
  callDuration: string;
  callError: string | null;
  startCall: (targetUser: CallParticipant, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: (reason?: 'declined' | 'busy') => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

const CallContext = createContext<CallContextType | undefined>(undefined);

// ── Centralized, Idempotent Audio Synthesizer Engine ────────────────────────
interface ToneEngineState {
  audioCtx: AudioContext | null;
  masterGain: GainNode | null;
  intervalId: number | null;
  scheduledTimeouts: number[];
  activeOscillators: { osc: OscillatorNode; gain: GainNode }[];
  currentMode: 'none' | 'ringback' | 'incoming' | 'ended';
}

const toneEngine: ToneEngineState = {
  audioCtx: null,
  masterGain: null,
  intervalId: null,
  scheduledTimeouts: [],
  activeOscillators: [],
  currentMode: 'none',
};

const getOrCreateAudioContext = (): { ctx: AudioContext; master: GainNode } | null => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!toneEngine.audioCtx || toneEngine.audioCtx.state === 'closed') {
      toneEngine.audioCtx = new AudioContextClass();
    }
    if (toneEngine.audioCtx.state === 'suspended') {
      toneEngine.audioCtx.resume().catch(() => {});
    }

    if (!toneEngine.masterGain) {
      toneEngine.masterGain = toneEngine.audioCtx.createGain();
      toneEngine.masterGain.connect(toneEngine.audioCtx.destination);
    }
    toneEngine.masterGain.gain.setValueAtTime(1, toneEngine.audioCtx.currentTime);
    return { ctx: toneEngine.audioCtx, master: toneEngine.masterGain };
  } catch (e) {
    console.warn('[ToneEngine] Could not initialize AudioContext:', e);
    return null;
  }
};

export const stopAllTones = () => {
  toneEngine.currentMode = 'none';

  // 1. Cancel recurring interval
  if (toneEngine.intervalId !== null) {
    clearInterval(toneEngine.intervalId);
    window.clearInterval(toneEngine.intervalId);
    toneEngine.intervalId = null;
  }

  // 2. Cancel all pending scheduled timeouts
  while (toneEngine.scheduledTimeouts.length > 0) {
    const tid = toneEngine.scheduledTimeouts.pop();
    if (tid !== undefined) {
      clearTimeout(tid);
      window.clearTimeout(tid);
    }
  }

  // 3. Immediately stop and disconnect all active oscillators and their gain nodes
  while (toneEngine.activeOscillators.length > 0) {
    const item = toneEngine.activeOscillators.pop();
    if (item) {
      try {
        item.gain.gain.setValueAtTime(0, 0);
        item.gain.disconnect();
      } catch {}
      try {
        item.osc.stop(0);
        item.osc.disconnect();
      } catch {}
    }
  }

  // 4. Mute and disconnect master gain
  if (toneEngine.masterGain) {
    try {
      toneEngine.masterGain.gain.setValueAtTime(0, 0);
      toneEngine.masterGain.disconnect();
    } catch {}
    toneEngine.masterGain = null;
  }

  // 5. Hard close AudioContext so no audio can linger in the hardware buffer
  if (toneEngine.audioCtx && toneEngine.audioCtx.state !== 'closed') {
    try {
      toneEngine.audioCtx.close().catch(() => {});
    } catch {}
  }
  toneEngine.audioCtx = null;
};

export const terminateAudioContext = () => {
  stopAllTones();
};

const startRingbackTone = () => {
  stopAllTones();
  toneEngine.currentMode = 'ringback';
  const audio = getOrCreateAudioContext();
  if (!audio) return;
  const { ctx, master } = audio;

  const playBeep = () => {
    if (toneEngine.currentMode !== 'ringback') return;
    if (!toneEngine.audioCtx || toneEngine.audioCtx.state === 'closed') return;

    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(master);

      const oscEntry1 = { osc: osc1, gain };
      const oscEntry2 = { osc: osc2, gain };
      toneEngine.activeOscillators.push(oscEntry1, oscEntry2);

      const cleanupOsc = () => {
        toneEngine.activeOscillators = toneEngine.activeOscillators.filter(
          (o) => o.osc !== osc1 && o.osc !== osc2
        );
        try {
          osc1.disconnect();
          osc2.disconnect();
          gain.disconnect();
        } catch {}
      };

      osc1.onended = cleanupOsc;

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.2);
      osc2.stop(now + 1.2);
    } catch {}
  };

  playBeep();
  toneEngine.intervalId = window.setInterval(playBeep, 3500);
};

const startIncomingRingtone = () => {
  stopAllTones();
  toneEngine.currentMode = 'incoming';
  const audio = getOrCreateAudioContext();
  if (!audio) return;
  const { ctx, master } = audio;

  const playChime = () => {
    if (toneEngine.currentMode !== 'incoming') return;
    if (!toneEngine.audioCtx || toneEngine.audioCtx.state === 'closed') return;

    try {
      const baseNow = ctx.currentTime;
      const notes = [
        { delay: 0.0, freq: 659.25, dur: 0.35 },
        { delay: 0.2, freq: 830.61, dur: 0.35 },
        { delay: 0.4, freq: 987.77, dur: 0.45 },
      ];

      notes.forEach(({ delay, freq, dur }) => {
        if (toneEngine.currentMode !== 'incoming') return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.frequency.setValueAtTime(freq, baseNow + delay);
        gain.gain.setValueAtTime(0.08, baseNow + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, baseNow + delay + dur);

        osc.connect(gain);
        gain.connect(master);

        const oscEntry = { osc, gain };
        toneEngine.activeOscillators.push(oscEntry);

        osc.onended = () => {
          toneEngine.activeOscillators = toneEngine.activeOscillators.filter((o) => o.osc !== osc);
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {}
        };

        osc.start(baseNow + delay);
        osc.stop(baseNow + delay + dur);
      });
    } catch {}
  };

  playChime();
  toneEngine.intervalId = window.setInterval(playChime, 2200);
};

const playEndCallTone = () => {
  stopAllTones();
  toneEngine.currentMode = 'ended';
  const audio = getOrCreateAudioContext();
  if (!audio) return;
  const { ctx, master } = audio;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.3);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(master);

    const oscEntry = { osc, gain };
    toneEngine.activeOscillators.push(oscEntry);

    osc.onended = () => {
      toneEngine.activeOscillators = toneEngine.activeOscillators.filter((o) => o.osc !== osc);
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {}
      stopAllTones();
    };

    osc.start(now);
    osc.stop(now + 0.3);
  } catch {}
};

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<CallType>('voice');
  const [callId, setCallId] = useState<string | null>(null);
  const [remoteUser, setRemoteUser] = useState<CallParticipant | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [isInitiator, setIsInitiator] = useState<boolean>(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);
  const [callError, setCallError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const remoteUserRef = useRef<CallParticipant | null>(null);
  const callStateRef = useRef<CallState>(callState);
  const earlyLocalCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const timerRef = useRef<number | null>(null);
  const remoteAudioElRef = useRef<HTMLAudioElement | null>(null);
  const isAcquiringMediaRef = useRef<boolean>(false);

  callIdRef.current = callId;
  remoteUserRef.current = remoteUser;
  localStreamRef.current = localStream;
  callStateRef.current = callState;

  // Safe diagnostics logger
  const logDiagnostics = useCallback((tag: string) => {
    const pc = pcRef.current;
    const localAudio = localStreamRef.current?.getAudioTracks().length || 0;
    const localVideo = localStreamRef.current?.getVideoTracks().length || 0;
    const remoteAudio = remoteStream?.getAudioTracks().length || 0;
    const remoteVideo = remoteStream?.getVideoTracks().length || 0;

    console.log(
      `[WebRTC Diagnostics - ${tag}] ` +
      `callType=${callType}, callState=${callStateRef.current}, ` +
      `localTracks=[Audio:${localAudio}, Video:${localVideo}], ` +
      `remoteTracks=[Audio:${remoteAudio}, Video:${remoteVideo}], ` +
      `signalingState=${pc?.signalingState || 'none'}, ` +
      `connectionState=${pc?.connectionState || 'none'}, ` +
      `iceConnectionState=${pc?.iceConnectionState || 'none'}`
    );
  }, [callType, remoteStream]);

  // Global background audio element for voice calls and uninterrupted remote audio
  useEffect(() => {
    const audio = new Audio();
    audio.autoplay = true;
    (audio as any).playsInline = true;
    remoteAudioElRef.current = audio;

    return () => {
      audio.srcObject = null;
      remoteAudioElRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (remoteAudioElRef.current) {
      if (remoteStream) {
        remoteAudioElRef.current.srcObject = remoteStream;
        remoteAudioElRef.current.play().catch((err) => {
          console.warn('[WebRTC Audio] CallProvider audio play note:', err);
        });
      } else {
        remoteAudioElRef.current.srcObject = null;
      }
    }
  }, [remoteStream]);

  // Cleanup helper: ensures all hardware tracks (audio & video) are immediately stopped and released
  const cleanUpMediaAndPeer = useCallback(() => {
    stopAllTones();

    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (localStreamRef.current) {
      console.log('[WebRTC Media] Stopping and releasing local hardware tracks...');
      localStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
          console.log(`[WebRTC Media] Track stopped: ${t.kind} (id: ${t.id})`);
        } catch (err) {
          console.warn('[WebRTC Media] Error stopping track:', err);
        }
      });
      setLocalStream(null);
      localStreamRef.current = null;
    }

    if (pcRef.current) {
      try {
        pcRef.current.getSenders().forEach((sender) => {
          if (sender.track) {
            try {
              sender.track.stop();
            } catch {}
          }
        });
      } catch {}
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (remoteAudioElRef.current) {
      remoteAudioElRef.current.srcObject = null;
    }

    setRemoteStream(null);
    earlyLocalCandidatesRef.current = [];
    pendingCandidatesRef.current = [];
    pendingOfferRef.current = null;
    setSecondsElapsed(0);
    setIsAudioMuted(false);
    setIsVideoOff(false);
    isAcquiringMediaRef.current = false;
  }, []);

  // Comprehensive page lifecycle handlers: ensures ringtones, sockets, and devices are killed on tab-close / reload
  useEffect(() => {
    const handleUnload = () => {
      terminateAudioContext();
      if (callIdRef.current || remoteUserRef.current) {
        emitCallEnd({
          call_id: callIdRef.current || undefined,
          target_user_id: remoteUserRef.current?.user_id,
          reason: 'hung_up',
        });
      }
      cleanUpMediaAndPeer();
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('unload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('unload', handleUnload);
      handleUnload();
    };
  }, [cleanUpMediaAndPeer]);

  // Duration timer
  useEffect(() => {
    if (callState === 'connected') {
      setSecondsElapsed(0);
      timerRef.current = window.setInterval(() => {
        setSecondsElapsed((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [callState]);

  // Guarantee immediate silence whenever call is idle
  useEffect(() => {
    if (callState === 'idle') {
      stopAllTones();
    }
  }, [callState]);

  const formatDuration = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Initialize RTCPeerConnection
  const createPeerConnection = useCallback(
    (targetUserId: number): RTCPeerConnection => {
      if (pcRef.current) {
        pcRef.current.close();
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;
      const remoteStreamAccumulator = new MediaStream();

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candidateJson = event.candidate.toJSON();
          if (callIdRef.current) {
            emitWebrtcSignal({
              call_id: callIdRef.current,
              target_user_id: targetUserId,
              signal: {
                type: 'ice-candidate',
                candidate: candidateJson,
              },
            });
          } else {
            // Buffer early local candidate until call_id is confirmed
            earlyLocalCandidatesRef.current.push(candidateJson);
          }
        }
      };

      pc.ontrack = (event) => {
        console.log(`[WebRTC] ontrack received: ${event.track.kind} (id: ${event.track.id}, readyState: ${event.track.readyState})`);
        if (!remoteStreamAccumulator.getTracks().some((t) => t.id === event.track.id)) {
          remoteStreamAccumulator.addTrack(event.track);
        }
        if (event.streams && event.streams[0]) {
          event.streams[0].getTracks().forEach((t) => {
            if (!remoteStreamAccumulator.getTracks().some((ex) => ex.id === t.id)) {
              remoteStreamAccumulator.addTrack(t);
            }
          });
        }
        const syncRemoteStream = () => {
          const freshStream = new MediaStream(remoteStreamAccumulator.getTracks());
          console.log(
            `[WebRTC Diagnostics] RemoteStream Synced -> Total Tracks: ${freshStream.getTracks().length} ` +
            `[Audio: ${freshStream.getAudioTracks().length}, Video: ${freshStream.getVideoTracks().length}]`
          );
          setRemoteStream(freshStream);
        };
        syncRemoteStream();
        event.track.onunmute = syncRemoteStream;
        event.track.onmute = syncRemoteStream;
        event.track.onended = syncRemoteStream;
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] connectionState changed: ${pc.connectionState}`);
        if (pc.connectionState === 'connected') {
          setCallState('connected');
          stopAllTones();
        } else if (pc.connectionState === 'failed') {
          setCallError('Connection lost. Please try again.');
          endCall();
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] iceConnectionState changed: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setCallState('connected');
          stopAllTones();
        } else if (pc.iceConnectionState === 'disconnected') {
          setCallState('reconnecting');
        } else if (pc.iceConnectionState === 'failed') {
          setCallError('Connection lost. Please try again.');
          endCall();
        }
      };

      return pc;
    },
    []
  );

  // ── Socket Events Listener ──────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    const handleIncomingCall = (data: IncomingCallData) => {
      // If already in an active or ringing call, auto-reject with busy
      if (callStateRef.current !== 'idle') {
        emitCallReject({ call_id: data.call_id, reason: 'busy' });
        return;
      }

      setIncomingCall(data);
      setCallId(data.call_id);
      callIdRef.current = data.call_id;
      setRemoteUser(data.caller);
      remoteUserRef.current = data.caller;
      setCallType(data.call_type);
      setIsInitiator(false);
      setCallState('ringing');
      pendingOfferRef.current = data.offer || null;
      startIncomingRingtone();
    };

    const handleCallRinging = (data: { call_id: string; receiver: CallParticipant; call_type: CallType }) => {
      setCallId(data.call_id);
      callIdRef.current = data.call_id;
      setCallState('calling');

      // Flush any buffered local ICE candidates that were created prior to call_id acknowledgment
      if (remoteUserRef.current) {
        const targetUserId = remoteUserRef.current.user_id;
        while (earlyLocalCandidatesRef.current.length > 0) {
          const cand = earlyLocalCandidatesRef.current.shift();
          if (cand) {
            emitWebrtcSignal({
              call_id: data.call_id,
              target_user_id: targetUserId,
              signal: {
                type: 'ice-candidate',
                candidate: cand,
              },
            });
          }
        }
      }
    };

    const handleCallAccepted = async (data: { call_id: string; receiver_id: number; answer?: RTCSessionDescriptionInit }) => {
      stopAllTones();
      setCallState('connected');

      if (data.answer && pcRef.current) {
        try {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          // Drain pending ICE candidates
          while (pendingCandidatesRef.current.length > 0) {
            const cand = pendingCandidatesRef.current.shift();
            if (cand) {
              try {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
              } catch (err) {
                console.warn('[WebRTC ICE] Candidate drain note:', err);
              }
            }
          }
          logDiagnostics('Caller - Remote Answer Applied');
        } catch (err) {
          console.error('[WebRTC SDP] Error applying remote answer SDP:', err);
        }
      }
    };

    const handleCallRejected = (data: { call_id?: string; reason?: string; message?: string }) => {
      stopAllTones();
      playEndCallTone();
      const reasonMsg =
        data.reason === 'busy'
          ? (data.message || 'User is busy on another call.')
          : 'Call declined.';
      setCallError(reasonMsg);
      setCallState('ended');

      setTimeout(() => {
        cleanUpMediaAndPeer();
        setCallState('idle');
        setCallError(null);
        setIncomingCall(null);
        setRemoteUser(null);
        setCallId(null);
      }, 2000);
    };

    const handleCallEnded = (data: { call_id?: string; reason?: string }) => {
      stopAllTones();
      playEndCallTone();
      const endMsg = data.reason === 'disconnected' ? 'User disconnected.' : 'Call ended.';
      setCallError(endMsg);
      setCallState('ended');

      setTimeout(() => {
        cleanUpMediaAndPeer();
        setCallState('idle');
        setCallError(null);
        setIncomingCall(null);
        setRemoteUser(null);
        setCallId(null);
      }, 1500);
    };

    const handleWebrtcSignal = async (data: { call_id: string; from_user_id: number; signal: any }) => {
      const { signal } = data;
      if (!signal) return;

      const pc = pcRef.current;

      if (signal.type === 'ice-candidate' && signal.candidate) {
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.warn('[WebRTC ICE] Error adding ICE candidate:', err);
          }
        } else {
          // Robust buffering: preserve candidates arriving before pc initialization or remote description setting
          pendingCandidatesRef.current.push(signal.candidate);
          console.log('[WebRTC ICE] Buffered remote candidate, queue length:', pendingCandidatesRef.current.length);
        }
      } else if (pc) {
        if (signal.type === 'offer' && signal.sdp) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            emitWebrtcSignal({
              call_id: data.call_id,
              target_user_id: data.from_user_id,
              signal: { type: 'answer', sdp: answer.sdp },
            });
            logDiagnostics('Receiver - Offer Processed and Answer Sent');
          } catch (err) {
            console.error('[WebRTC SDP] Error handling remote offer:', err);
          }
        } else if (signal.type === 'answer' && signal.sdp) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
            logDiagnostics('Remote Answer Processed');
          } catch (err) {
            console.error('[WebRTC SDP] Error handling remote answer:', err);
          }
        }
      }
    };

    const handleCallError = (data: { message: string }) => {
      stopAllTones();
      playEndCallTone();
      setCallError(data.message || 'Call failed.');
      setCallState('ended');

      setTimeout(() => {
        cleanUpMediaAndPeer();
        setCallState('idle');
        setCallError(null);
        setIncomingCall(null);
        setRemoteUser(null);
        setCallId(null);
      }, 2500);
    };

    const handleSocketDisconnect = () => {
      console.warn('[WebRTC Call] Socket disconnected, cleaning up call state...');
      stopAllTones();
      cleanUpMediaAndPeer();
      setCallState('idle');
      setIncomingCall(null);
      setRemoteUser(null);
      setCallId(null);
    };

    socket.on('incoming_call', handleIncomingCall);
    socket.on('call_ringing', handleCallRinging);
    socket.on('call_accepted', handleCallAccepted);
    socket.on('call_rejected', handleCallRejected);
    socket.on('call_ended', handleCallEnded);
    socket.on('webrtc_signal', handleWebrtcSignal);
    socket.on('call_error', handleCallError);
    socket.on('disconnect', handleSocketDisconnect);

    return () => {
      socket.off('incoming_call', handleIncomingCall);
      socket.off('call_ringing', handleCallRinging);
      socket.off('call_accepted', handleCallAccepted);
      socket.off('call_rejected', handleCallRejected);
      socket.off('call_ended', handleCallEnded);
      socket.off('webrtc_signal', handleWebrtcSignal);
      socket.off('call_error', handleCallError);
      socket.off('disconnect', handleSocketDisconnect);
    };
  }, [cleanUpMediaAndPeer, logDiagnostics]);

  // Helper to format media errors
  const getMediaErrorMessage = (err: any, type: CallType): string => {
    console.warn(`[WebRTC Media] getUserMedia failed for ${type}:`, err?.name, err?.message);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError') {
      return type === 'video'
        ? 'Camera/Microphone permission denied. Please allow camera and microphone access in your browser settings.'
        : 'Microphone permission denied. Please allow microphone access in your browser settings.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return type === 'video'
        ? 'No camera or microphone device detected on this system.'
        : 'No microphone detected on this system.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError' || err.name === 'AbortError') {
      return 'Your camera or microphone is currently being used by another application. Close other camera apps and try again.';
    }
    if (err.name === 'OverconstrainedError') {
      return 'Camera/Microphone constraints cannot be satisfied by available hardware.';
    }
    return err.message || `Could not access ${type === 'video' ? 'camera or microphone' : 'microphone'}.`;
  };

  // ── Initiate Call ──────────────────────────────────────────────────────────
  const startCall = async (targetUser: CallParticipant, type: CallType) => {
    if (!user) return;
    if (isAcquiringMediaRef.current) {
      console.warn('[WebRTC Media] startCall ignored: media acquisition already in progress.');
      return;
    }
    isAcquiringMediaRef.current = true;

    cleanUpMediaAndPeer();
    setCallError(null);

    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: type === 'video' ? true : false,
      };

      console.log(`[WebRTC Media] Requesting media stream for ${type} call...`);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log(`[WebRTC Media] getUserMedia succeeded with ${stream.getTracks().length} tracks.`);
      } catch (mediaErr: any) {
        isAcquiringMediaRef.current = false;
        setCallError(getMediaErrorMessage(mediaErr, type));
        cleanUpMediaAndPeer();
        setCallState('ended');
        setTimeout(() => {
          setCallState('idle');
          setCallError(null);
        }, 3500);
        return;
      }

      setLocalStream(stream);
      localStreamRef.current = stream;
      isAcquiringMediaRef.current = false;

      // 2. Initialize WebRTC peer
      const pc = createPeerConnection(targetUser.user_id);
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // 3. Create SDP Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const serializedOffer: RTCSessionDescriptionInit = {
        type: offer.type,
        sdp: offer.sdp,
      };

      // 4. Update state & emit call_user
      setRemoteUser(targetUser);
      remoteUserRef.current = targetUser;
      setCallType(type);
      setIsInitiator(true);
      setCallState('calling');
      startRingbackTone();

      emitCallUser({
        receiver_id: targetUser.user_id,
        call_type: type,
        offer: serializedOffer,
      });

      logDiagnostics('Caller - Offer Created & Sent');
    } catch (err: any) {
      isAcquiringMediaRef.current = false;
      console.error('[WebRTC Media] Failed to start call:', err);
      setCallError(err.message || 'Failed to start call.');
      cleanUpMediaAndPeer();
      setCallState('idle');
    }
  };

  // ── Accept Incoming Call ────────────────────────────────────────────────────
  const acceptCall = async () => {
    if (!incomingCall || !user) return;
    if (isAcquiringMediaRef.current) {
      console.warn('[WebRTC Media] acceptCall ignored: media acquisition already in progress.');
      return;
    }
    isAcquiringMediaRef.current = true;

    stopAllTones();
    setCallError(null);
    setCallState('connecting');

    const type = incomingCall.call_type;
    setCallType(type);

    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: type === 'video' ? true : false,
      };

      console.log(`[WebRTC Media] Accepting call, requesting media stream for ${type}...`);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log(`[WebRTC Media] getUserMedia on accept succeeded with ${stream.getTracks().length} tracks.`);
      } catch (mediaErr: any) {
        isAcquiringMediaRef.current = false;
        setCallError(getMediaErrorMessage(mediaErr, type));
        rejectCall('declined');
        return;
      }

      setLocalStream(stream);
      localStreamRef.current = stream;
      isAcquiringMediaRef.current = false;

      const pc = createPeerConnection(incomingCall.caller.user_id);
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      if (pendingOfferRef.current) {
        await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const serializedAnswer: RTCSessionDescriptionInit = {
        type: answer.type,
        sdp: answer.sdp,
      };

      // Drain queued ICE candidates
      while (pendingCandidatesRef.current.length > 0) {
        const cand = pendingCandidatesRef.current.shift();
        if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
      }

      emitCallAccept({
        call_id: incomingCall.call_id,
        answer: serializedAnswer,
      });

      setIncomingCall(null);
      logDiagnostics('Receiver - Call Accepted & Answer Sent');
    } catch (err: any) {
      isAcquiringMediaRef.current = false;
      console.error('[WebRTC Media] Failed to accept call:', err);
      setCallError('Failed to establish connection.');
      cleanUpMediaAndPeer();
      setCallState('idle');
    }
  };

  // ── Reject Call ────────────────────────────────────────────────────────────
  const rejectCall = (reason: 'declined' | 'busy' = 'declined') => {
    stopAllTones();
    if (incomingCall) {
      emitCallReject({ call_id: incomingCall.call_id, reason });
    }
    cleanUpMediaAndPeer();
    setIncomingCall(null);
    setCallState('idle');
    setRemoteUser(null);
    setCallId(null);
  };

  // ── End Active Call ─────────────────────────────────────────────────────────
  const endCall = () => {
    stopAllTones();
    playEndCallTone();

    emitCallEnd({
      call_id: callIdRef.current || undefined,
      target_user_id: remoteUserRef.current?.user_id,
      reason: 'hung_up',
    });

    setCallState('ended');
    setTimeout(() => {
      cleanUpMediaAndPeer();
      setCallState('idle');
      setIncomingCall(null);
      setRemoteUser(null);
      setCallId(null);
      setCallError(null);
    }, 800);
  };

  // ── Toggle Audio Track ──────────────────────────────────────────────────────
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextState = !audioTracks[0].enabled;
        audioTracks.forEach((t) => {
          t.enabled = nextState;
        });
        setIsAudioMuted(!nextState);
      }
    }
  };

  // ── Toggle Video Track ──────────────────────────────────────────────────────
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        const nextState = !videoTracks[0].enabled;
        videoTracks.forEach((t) => {
          t.enabled = nextState;
        });
        setIsVideoOff(!nextState);
      }
    }
  };

  return (
    <CallContext.Provider
      value={{
        callState,
        callType,
        callId,
        remoteUser,
        incomingCall,
        isInitiator,
        localStream,
        remoteStream,
        isAudioMuted,
        isVideoOff,
        callDuration: formatDuration(secondsElapsed),
        callError,
        startCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMute,
        toggleVideo,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};

export const useCall = (): CallContextType => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
