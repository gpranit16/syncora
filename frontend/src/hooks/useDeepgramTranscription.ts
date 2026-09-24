/**
 * useDeepgramTranscription.ts
 *
 * Real-time transcription hook using Deepgram Nova-3 via backend WebSocket relay.
 *
 * Architecture:
 *   Existing WebRTC localStream (microphone)
 *       |
 *       +─── AudioContext (ScriptProcessorNode) → Float32 PCM
 *       |                                            |
 *       |                              Convert to 16-bit PCM Int16 (16kHz)
 *       |                                            |
 *       |                              Socket.IO binary emit (deepgram_audio_chunk)
 *       |                                            |
 *       |                              Backend Deepgram WebSocket (Nova-3)
 *       |                                            |
 *       |                              meeting_transcript_live event
 *       |                                            |
 *       |                              Interim/Final transcript state
 *
 * The WebRTC call continues independently — we only READ audio from the stream.
 * We do NOT create a second getUserMedia call.
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  getSocket,
  emitDeepgramStart,
  emitDeepgramAudioChunk,
  emitDeepgramStop,
} from '../socket/socketManager';

// Audio pipeline constants
const TARGET_SAMPLE_RATE = 16000; // Deepgram expects 16kHz
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096; // ~85ms at 48kHz

export interface DeepgramTranscriptEntry {
  id: string;           // unique per utterance
  speakerId?: number;
  speakerName: string;
  text: string;
  isFinal: boolean;
  timestamp: string;
  language?: string;
}

interface UseDeepgramTranscriptionOptions {
  localStream: MediaStream | null;
  meetingCode: string | null | undefined;
  userId?: number;
  userName?: string;
  isMuted: boolean;
  isInMeeting: boolean;
  onTranscriptUpdate: (entry: DeepgramTranscriptEntry) => void;
  onStatusChange?: (status: 'idle' | 'connecting' | 'active' | 'error' | 'muted') => void;
}

export function useDeepgramTranscription({
  localStream,
  meetingCode,
  userId,
  userName,
  isMuted,
  isInMeeting,
  onTranscriptUpdate,
  onStatusChange,
}: UseDeepgramTranscriptionOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const isDeepgramReadyRef = useRef<boolean>(false);
  const isStreamingRef = useRef<boolean>(false);
  const meetingCodeRef = useRef<string | null | undefined>(null);
  const isMutedRef = useRef<boolean>(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isComponentMountedRef = useRef<boolean>(true);
  const chunkCounterRef = useRef<number>(0);

  // Keep refs in sync with props
  meetingCodeRef.current = meetingCode;
  isMutedRef.current = isMuted;
  localStreamRef.current = localStream;

  const notifyStatus = useCallback(
    (status: 'idle' | 'connecting' | 'active' | 'error' | 'muted') => {
      onStatusChange?.(status);
    },
    [onStatusChange]
  );

  // Tear down audio processing pipeline
  const stopAudioPipeline = useCallback(() => {
    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      try {
        processorNodeRef.current.disconnect();
      } catch (_) {}
      processorNodeRef.current = null;
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

  // Stop Deepgram and audio pipeline
  const stopTranscription = useCallback(() => {
    stopAudioPipeline();
    isDeepgramReadyRef.current = false;
    emitDeepgramStop();
    notifyStatus('idle');
    console.log('[Deepgram Hook] Transcription stopped');
  }, [stopAudioPipeline, notifyStatus]);

  // Start audio capture from the existing local stream
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
        // Create AudioContext — we read at native browser rate (usually 44.1 or 48kHz), resample to 16kHz
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        // Ensure AudioContext is active (browsers can start it suspended)
        if (ctx.state === 'suspended') {
          ctx.resume().catch((err) => {
            console.warn('[Deepgram Hook] AudioContext resume failed:', err);
          });
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

          // If AudioContext got suspended, try to resume
          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }

          const inputBuffer = event.inputBuffer.getChannelData(0); // Float32Array, mono

          // Downsample to 16kHz
          const outputLength = Math.floor(inputBuffer.length / resampleRatio);
          const int16Buffer = new Int16Array(outputLength);

          for (let i = 0; i < outputLength; i++) {
            const srcIdx = Math.floor(i * resampleRatio);
            // Clamp float32 to [-1, 1] then convert to int16 range [-32768, 32767]
            const sample = Math.max(-1, Math.min(1, inputBuffer[srcIdx]));
            int16Buffer[i] = sample < 0 ? sample * 32768 : sample * 32767;
          }

          emitDeepgramAudioChunk(int16Buffer.buffer);

          chunkCounterRef.current += 1;
          if (chunkCounterRef.current === 1) {
            console.log('[Deepgram Hook] Streaming first audio chunk to Deepgram (16kHz PCM)');
          } else if (chunkCounterRef.current % 100 === 0) {
            console.log(`[Deepgram Hook] Streamed ${chunkCounterRef.current} chunks`);
          }
        };

        // Connect: source → processor → SILENT destination
        // IMPORTANT: Route to MediaStreamDestination (silent), NOT ctx.destination (speakers)
        // to avoid any mic feedback/echo!
        const silentDest = ctx.createMediaStreamDestination();
        source.connect(processor);
        processor.connect(silentDest);

        isStreamingRef.current = true;
        console.log(
          `[Deepgram Hook] Audio pipeline started: ${ctx.sampleRate}Hz → 16kHz resample`
        );
      } catch (err: any) {
        console.error('[Deepgram Hook] Failed to start audio pipeline:', err.message);
        stopAudioPipeline();
        notifyStatus('error');
      }
    },
    [stopAudioPipeline, notifyStatus]
  );

  // Initialize Deepgram session on backend
  const startTranscription = useCallback(
    (code: string) => {
      if (!isComponentMountedRef.current) return;

      notifyStatus('connecting');

      emitDeepgramStart({
        meeting_code: code,
        user_id: userId,
        user_name: userName || 'Speaker',
      });

      console.log(`[Deepgram Hook] Requested Deepgram session for meeting=${code}`);
    },
    [userId, userName, notifyStatus]
  );

  // Setup user interaction listeners to resume suspended AudioContext
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

  // Listen for Deepgram backend events
  useEffect(() => {
    isComponentMountedRef.current = true;
    const socket = getSocket();

    const onReady = () => {
      if (!isComponentMountedRef.current) return;
      console.log('[Deepgram Hook] deepgram_ready received — Deepgram session is active');
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

      console.log(`[Deepgram Hook] Transcript from "${speakerName}" (${isFinal ? 'FINAL' : 'interim'}): "${text}"`);

      // Each speaker gets a stable entryId for interim replacement
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
      console.warn('[Deepgram Hook] deepgram_error:', data?.message);
      isDeepgramReadyRef.current = false;
      notifyStatus('error');
    };

    socket.on('deepgram_ready', onReady);
    socket.on('meeting_transcript_live', onTranscript);
    socket.on('deepgram_error', onError);

    return () => {
      socket.off('deepgram_ready', onReady);
      socket.off('meeting_transcript_live', onTranscript);
      socket.off('deepgram_error', onError);
    };
  }, [startAudioPipeline, onTranscriptUpdate, notifyStatus]);

  // Main effect: start/stop transcription based on meeting state & mute
  useEffect(() => {
    if (!isInMeeting || !meetingCode || !localStream) {
      stopTranscription();
      return;
    }

    if (isMuted) {
      // Pause audio sending when muted, but keep Deepgram session open
      stopAudioPipeline();
      notifyStatus('muted');
      console.log('[Deepgram Hook] Muted — audio pipeline paused');
      return;
    }

    // Unmuted & in meeting: start transcription
    if (!isDeepgramReadyRef.current) {
      startTranscription(meetingCode);
    } else if (!isStreamingRef.current) {
      // Deepgram already connected (e.g. unmuted)
      startAudioPipeline(localStream);
      notifyStatus('active');
    }
  }, [
    isInMeeting,
    meetingCode,
    localStream,
    isMuted,
    startTranscription,
    startAudioPipeline,
    stopAudioPipeline,
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
