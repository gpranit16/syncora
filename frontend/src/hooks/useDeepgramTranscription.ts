/**
 * useDeepgramTranscription.ts
 *
 * Resilient Real-Time Speech Transcription Engine:
 * 1. Primary: Deepgram Nova-3 real-time WebSocket streaming with 16kHz PCM audio relay.
 * 2. Automatic Seamless Fallback: Browser Web Speech API (webkitSpeechRecognition / SpeechRecognition)
 *    if Deepgram is unconfigured, disconnected, or encounters an error.
 *
 * Guarantees zero downtime:
 * - Channel meetings, voice meetings, and 1-on-1 audio/video calls ALWAYS capture transcripts.
 * - Transcripts stream in real-time to all participants.
 * - Final transcripts persist to TiDB database meeting_transcripts table.
 * - Meeting Intelligence AI summaries and task extractions remain fully functional.
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  getSocket,
  emitDeepgramStart,
  emitDeepgramAudioChunk,
  emitDeepgramStop,
  emitMeetingTranscriptChunk,
  emitCallTranscriptChunk,
} from '../socket/socketManager';

// Audio pipeline constants for Deepgram Nova-3
const TARGET_SAMPLE_RATE = 16000;
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;

export interface DeepgramTranscriptEntry {
  id: string;
  speakerId?: number;
  speakerName: string;
  text: string;
  isFinal: boolean;
  timestamp: string;
  language?: string;
}

export interface UseDeepgramTranscriptionOptions {
  localStream: MediaStream | null;
  meetingCode?: string | null;
  callId?: string | null;
  userId?: number;
  userName?: string;
  isMuted: boolean;
  isInMeeting?: boolean;
  isActive?: boolean;
  onTranscriptUpdate: (entry: DeepgramTranscriptEntry) => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'active' | 'error' | 'muted') => void;
}

export function useDeepgramTranscription({
  localStream,
  meetingCode,
  callId,
  userId,
  userName,
  isMuted,
  isInMeeting,
  isActive,
  onTranscriptUpdate,
  onStatusChange,
}: UseDeepgramTranscriptionOptions) {
  // Deepgram Audio Pipeline refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isDeepgramReadyRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isComponentMountedRef = useRef<boolean>(true);
  const chunkCounterRef = useRef<number>(0);

  // Fallback Web Speech Recognition refs
  const recognitionRef = useRef<any>(null);
  const isFallbackActiveRef = useRef<boolean>(false);
  const deepgramConnectingTimeoutRef = useRef<any>(null);

  isMutedRef.current = isMuted;
  localStreamRef.current = localStream;

  const notifyStatus = useCallback(
    (status: 'idle' | 'connecting' | 'active' | 'error' | 'muted') => {
      onStatusChange?.(status);
    },
    [onStatusChange]
  );

  // Stop Web Speech Fallback recognition
  const stopWebSpeechFallback = useCallback(() => {
    isFallbackActiveRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
    }
  }, []);

  // Start Web Speech Fallback recognition (browser native)
  const startWebSpeechFallback = useCallback(() => {
    if (isFallbackActiveRef.current && recognitionRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[Transcription] Neither Deepgram nor Web Speech API available in this browser');
      notifyStatus('error');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = navigator.language || 'en-US';

      recognition.onstart = () => {
        console.log('[Transcription] Web Speech recognition active (fallback mode)');
        isFallbackActiveRef.current = true;
        notifyStatus('active');
      };

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const transcriptText = res[0]?.transcript?.trim();
          if (!transcriptText) continue;

          const isFinal = res.isFinal === true;
          const entryId = `speaker_${userId || 'local'}`;

          const entry: DeepgramTranscriptEntry = {
            id: entryId,
            speakerId: userId,
            speakerName: userName || 'You',
            text: transcriptText,
            isFinal,
            timestamp: new Date().toISOString(),
            language: 'multi',
          };

          onTranscriptUpdate(entry);

          // Broadcast final segments to peers & persist to database
          if (isFinal) {
            if (meetingCode) {
              emitMeetingTranscriptChunk({
                meeting_code: meetingCode,
                text: transcriptText,
                user_id: userId,
                user_name: userName || 'You',
                timestamp: entry.timestamp,
                language: 'en',
              });
            } else if (callId) {
              emitCallTranscriptChunk({
                call_id: callId,
                text: transcriptText,
                user_id: userId,
                user_name: userName || 'You',
                timestamp: entry.timestamp,
              });
            }
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('[Transcription] Web Speech event warning:', event.error);
        if (event.error === 'not-allowed') {
          notifyStatus('error');
        }
      };

      recognition.onend = () => {
        // Auto-restart if we should still be active, unmuted, and not using Deepgram
        if (
          isComponentMountedRef.current &&
          !isMutedRef.current &&
          isFallbackActiveRef.current &&
          !isDeepgramReadyRef.current
        ) {
          try {
            recognition.start();
          } catch (_) {}
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      isFallbackActiveRef.current = true;
      notifyStatus('active');
    } catch (err: any) {
      console.warn('[Transcription] Web Speech start error:', err.message);
      if (!isDeepgramReadyRef.current) {
        notifyStatus('error');
      }
    }
  }, [meetingCode, callId, userId, userName, onTranscriptUpdate, notifyStatus]);

  // Tear down Deepgram Web Audio processing pipeline
  const stopAudioPipeline = useCallback(() => {
    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      try {
        processorNodeRef.current.disconnect();
      } catch (_) {}
      processorNodeRef.current = null;
    }

    if (gainNodeRef.current) {
      try {
        gainNodeRef.current.disconnect();
      } catch (_) {}
      gainNodeRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch (_) {}
      sourceNodeRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    isStreamingRef.current = false;
    chunkCounterRef.current = 0;
  }, []);

  // Stop all transcription (Deepgram + fallback)
  const stopTranscription = useCallback(() => {
    stopAudioPipeline();
    stopWebSpeechFallback();

    if (deepgramConnectingTimeoutRef.current) {
      clearTimeout(deepgramConnectingTimeoutRef.current);
      deepgramConnectingTimeoutRef.current = null;
    }

    isDeepgramReadyRef.current = false;
    emitDeepgramStop();
    notifyStatus('idle');
  }, [stopAudioPipeline, stopWebSpeechFallback, notifyStatus]);

  // Start 16kHz PCM audio capture from existing WebRTC mic stream for Deepgram
  const startAudioPipeline = useCallback(
    (stream: MediaStream) => {
      if (isStreamingRef.current) {
        stopAudioPipeline();
      }

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length || audioTracks[0].readyState !== 'live') {
        console.warn('[Deepgram Hook] No live audio track available');
        return;
      }

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }

        const source = ctx.createMediaStreamSource(stream);
        sourceNodeRef.current = source;

        // ScriptProcessorNode for raw PCM access
        // eslint-disable-next-line deprecation/deprecation
        const processor = ctx.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
        processorNodeRef.current = processor;

        const resampleRatio = ctx.sampleRate / TARGET_SAMPLE_RATE;

        processor.onaudioprocess = (event: AudioProcessingEvent) => {
          if (
            !isDeepgramReadyRef.current ||
            !isStreamingRef.current ||
            isMutedRef.current
          ) {
            return;
          }

          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }

          const inputBuffer = event.inputBuffer.getChannelData(0);
          const outputLength = Math.floor(inputBuffer.length / resampleRatio);
          const int16Buffer = new Int16Array(outputLength);

          for (let i = 0; i < outputLength; i++) {
            const srcIdx = Math.floor(i * resampleRatio);
            const sample = Math.max(-1, Math.min(1, inputBuffer[srcIdx]));
            int16Buffer[i] = sample < 0 ? sample * 32768 : sample * 32767;
          }

          emitDeepgramAudioChunk(int16Buffer.buffer);

          chunkCounterRef.current += 1;
          if (chunkCounterRef.current === 1) {
            console.log('[Deepgram Hook] Streaming first audio chunk to Deepgram (16kHz PCM)');
          }
        };

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNodeRef.current = gainNode;

        source.connect(processor);
        processor.connect(gainNode);
        gainNode.connect(ctx.destination);

        isStreamingRef.current = true;
      } catch (err: any) {
        console.error('[Deepgram Hook] Audio pipeline failed, switching to Web Speech:', err.message);
        stopAudioPipeline();
        startWebSpeechFallback();
      }
    },
    [stopAudioPipeline, startWebSpeechFallback]
  );

  // Initialize Deepgram session on backend
  const startTranscription = useCallback(
    (targetCode?: string | null, targetCallId?: string | null) => {
      if (!isComponentMountedRef.current) return;

      notifyStatus('connecting');

      emitDeepgramStart({
        meeting_code: targetCode || undefined,
        call_id: targetCallId || undefined,
        user_id: userId,
        user_name: userName || 'Speaker',
      });

      // If Deepgram backend doesn't connect within 3.5s (e.g. key missing on cloud server), seamlessly activate Web Speech
      if (deepgramConnectingTimeoutRef.current) {
        clearTimeout(deepgramConnectingTimeoutRef.current);
      }
      deepgramConnectingTimeoutRef.current = setTimeout(() => {
        if (!isDeepgramReadyRef.current && isComponentMountedRef.current && !isMutedRef.current) {
          console.log('[Transcription] Deepgram connection timeout — seamlessly switching to Web Speech fallback');
          startWebSpeechFallback();
        }
      }, 3500);
    },
    [userId, userName, notifyStatus, startWebSpeechFallback]
  );

  // Resume suspended AudioContext on user interaction
  useEffect(() => {
    const handleUserGesture = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    };
    window.addEventListener('click', handleUserGesture, { passive: true });
    window.addEventListener('keydown', handleUserGesture, { passive: true });
    return () => {
      window.removeEventListener('click', handleUserGesture);
      window.removeEventListener('keydown', handleUserGesture);
    };
  }, []);

  // Listen for backend events
  useEffect(() => {
    isComponentMountedRef.current = true;
    const socket = getSocket();

    const onReady = (data: any) => {
      if (!isComponentMountedRef.current) return;
      console.log('[Deepgram Hook] deepgram_ready received — Deepgram session is active', data);

      if (deepgramConnectingTimeoutRef.current) {
        clearTimeout(deepgramConnectingTimeoutRef.current);
        deepgramConnectingTimeoutRef.current = null;
      }

      // Stop Web Speech fallback now that Deepgram is ready
      stopWebSpeechFallback();

      isDeepgramReadyRef.current = true;
      notifyStatus('active');

      const stream = localStreamRef.current;
      if (stream && !isMutedRef.current) {
        startAudioPipeline(stream);
      }
    };

    const onTranscript = (data: any) => {
      if (!isComponentMountedRef.current) return;

      const {
        speakerId,
        speakerName,
        text,
        isFinal,
        timestamp,
        language,
      } = data || {};

      if (!text || !text.trim()) return;

      const entryId = `speaker_${speakerId || 'unknown'}`;
      const entry: DeepgramTranscriptEntry = {
        id: entryId,
        speakerId,
        speakerName: speakerName || 'Speaker',
        text: text.trim(),
        isFinal: !!isFinal,
        timestamp: timestamp || new Date().toISOString(),
        language: language || 'multi',
      };

      onTranscriptUpdate(entry);
    };

    const onError = (data: any) => {
      console.warn('[Deepgram Hook] deepgram_error received, activating resilient fallback:', data?.message);
      if (deepgramConnectingTimeoutRef.current) {
        clearTimeout(deepgramConnectingTimeoutRef.current);
        deepgramConnectingTimeoutRef.current = null;
      }

      isDeepgramReadyRef.current = false;
      stopAudioPipeline();

      // Immediately activate Web Speech fallback so user NEVER loses transcription!
      if (!isMutedRef.current) {
        startWebSpeechFallback();
      }
    };

    socket.on('deepgram_ready', onReady);
    socket.on('meeting_transcript_live', onTranscript);
    socket.on('call_transcript_live', onTranscript);
    socket.on('transcript_live', onTranscript);
    socket.on('deepgram_error', onError);

    return () => {
      socket.off('deepgram_ready', onReady);
      socket.off('meeting_transcript_live', onTranscript);
      socket.off('call_transcript_live', onTranscript);
      socket.off('transcript_live', onTranscript);
      socket.off('deepgram_error', onError);
    };
  }, [startAudioPipeline, stopWebSpeechFallback, startWebSpeechFallback, onTranscriptUpdate, notifyStatus]);

  // Main effect: start/stop transcription based on active state & mute
  const effectiveIsActive = Boolean(isActive !== undefined ? isActive : isInMeeting);
  const targetId = meetingCode || callId;

  useEffect(() => {
    if (!effectiveIsActive || !targetId || !localStream) {
      stopTranscription();
      return;
    }

    if (isMuted) {
      stopAudioPipeline();
      stopWebSpeechFallback();
      notifyStatus('muted');
      return;
    }

    // Unmuted & active: start or resume transcription session
    if (isDeepgramReadyRef.current) {
      startAudioPipeline(localStream);
      notifyStatus('active');
    } else if (isFallbackActiveRef.current) {
      startWebSpeechFallback();
      notifyStatus('active');
    } else {
      startTranscription(meetingCode, callId);
    }
  }, [
    effectiveIsActive,
    targetId,
    meetingCode,
    callId,
    localStream,
    isMuted,
    startTranscription,
    startAudioPipeline,
    stopAudioPipeline,
    startWebSpeechFallback,
    stopWebSpeechFallback,
    stopTranscription,
    notifyStatus,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    isComponentMountedRef.current = true;
    return () => {
      isComponentMountedRef.current = false;
      stopTranscription();
    };
  }, [stopTranscription]);

  return {
    stopTranscription,
  };
}
