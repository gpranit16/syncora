/**
 * deepgramService.js
 *
 * Manages per-socket Deepgram live streaming connections using @deepgram/sdk v5.
 * The Deepgram API key is NEVER sent to the frontend.
 * Frontend sends raw PCM audio chunks via Socket.IO binary events.
 * This service pipes them into a Deepgram WebSocket and
 * emits transcript results back to the meeting room.
 */

const { DeepgramClient } = require('@deepgram/sdk');

// Map<socketId, { liveSocket, meetingCode, userId, userName, isAlive }>
const activeConnections = new Map();

/**
 * Start a Deepgram live transcription session for a socket.
 * Supports both multi-user channel meetings (meetingCode) and 1-on-1 direct calls (callId).
 *
 * @param {object} io                     - Socket.IO server instance
 * @param {object} socket                 - The client Socket.IO socket
 * @param {string|object} optionsOrCode   - meetingCode string OR options object:
 *                                          { meetingCode, callId, userId, userName, onFinalSegment }
 * @param {number} [maybeUserId]
 * @param {string} [maybeUserName]
 * @param {function} [maybeOnFinalSegment]
 */
async function startDeepgramSession(io, socket, optionsOrCode, maybeUserId, maybeUserName, maybeOnFinalSegment) {
  let meetingCode = null;
  let callId = null;
  let userId = null;
  let userName = 'Speaker';
  let onFinalSegment = null;

  if (optionsOrCode && typeof optionsOrCode === 'object') {
    meetingCode = optionsOrCode.meetingCode || null;
    callId = optionsOrCode.callId || null;
    userId = optionsOrCode.userId || null;
    userName = optionsOrCode.userName || 'Speaker';
    onFinalSegment = optionsOrCode.onFinalSegment || null;
  } else {
    meetingCode = optionsOrCode || null;
    userId = maybeUserId || null;
    userName = maybeUserName || 'Speaker';
    onFinalSegment = maybeOnFinalSegment || null;
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;

  if (!apiKey) {
    console.error('[Deepgram] DEEPGRAM_API_KEY is not set in environment variables.');
    socket.emit('deepgram_error', { message: 'Transcription service is not configured.' });
    return;
  }

  // Close any existing session for this socket first
  await stopDeepgramSession(socket.id);

  try {
    const deepgram = new DeepgramClient({ apiKey });

    // Nova-3 streaming configuration matching standalone test
    const liveSocket = await deepgram.listen.v1.connect({
      model: 'nova-3',
      language: 'multi',
      smart_format: true,
      interim_results: true,
      endpointing: 300,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    });

    const connectionEntry = {
      liveSocket,
      meetingCode,
      callId,
      userId,
      userName,
      isAlive: false,
    };

    activeConnections.set(socket.id, connectionEntry);

    const sessionLabel = meetingCode ? `meeting=${meetingCode}` : `call=${callId}`;

    liveSocket.on('open', () => {
      connectionEntry.isAlive = true;
      console.log(
        `[Deepgram] Session OPEN — socket=${socket.id} user="${userName}" ${sessionLabel}`
      );
      socket.emit('deepgram_ready', {
        status: 'connected',
        meetingCode,
        callId,
      });
    });

    liveSocket.on('message', (data) => {
      if (data?.type !== 'Results') return;
      const channel = data?.channel;
      const alternatives = channel?.alternatives;
      if (!alternatives || alternatives.length === 0) return;

      const transcript = alternatives[0]?.transcript;
      if (!transcript || !transcript.trim()) return;

      const isFinal = data.is_final === true;
      const speechFinal = data.speech_final === true;
      const confidence = alternatives[0]?.confidence || 0;

      const payload = {
        meetingCode,
        callId,
        speakerId: userId,
        speakerName: userName,
        text: transcript.trim(),
        isFinal: isFinal || speechFinal,
        confidence,
        timestamp: new Date().toISOString(),
        language: data.metadata?.language || 'multi',
      };

      // Broadcast live transcript to the respective meeting or call room
      if (meetingCode) {
        io.to(`meeting_${meetingCode}`).emit('meeting_transcript_live', payload);
        io.to(`meeting_${meetingCode}`).emit('transcript_live', payload);
      }

      if (callId) {
        io.to(`call_${callId}`).emit('call_transcript_live', payload);
        io.to(`call_${callId}`).emit('transcript_live', payload);
      }

      // Persist final segments via direct callback (NO socket round-trip)
      if ((isFinal || speechFinal) && typeof onFinalSegment === 'function') {
        console.log(
          `[Deepgram] FINAL from "${userName}" (${sessionLabel}): "${transcript.trim().slice(0, 80)}"`
        );
        onFinalSegment(payload).catch((err) =>
          console.error('[Deepgram] onFinalSegment persist error:', err.message)
        );
      }
    });

    liveSocket.on('error', (err) => {
      console.error(`[Deepgram] Error for socket=${socket.id}:`, err?.message || err);
      socket.emit('deepgram_error', { message: 'Transcription error. Will attempt to reconnect.' });
      connectionEntry.isAlive = false;
    });

    liveSocket.on('close', (event) => {
      console.log(`[Deepgram] Closed socket=${socket.id}`, event?.code);
      connectionEntry.isAlive = false;
      if (activeConnections.get(socket.id) === connectionEntry) {
        activeConnections.delete(socket.id);
      }
    });

    // Initiate connection
    liveSocket.connect();
  } catch (err) {
    console.error(`[Deepgram] Failed to start session socket=${socket.id}:`, err.message);
    socket.emit('deepgram_error', { message: 'Failed to start transcription session.' });
    activeConnections.delete(socket.id);
  }
}

/**
 * Send raw PCM audio data to an active Deepgram session.
 */
function sendAudioToDeepgram(socketId, audioData) {
  const entry = activeConnections.get(socketId);
  if (!entry || !entry.isAlive || !entry.liveSocket) return;

  try {
    entry.liveSocket.sendMedia(audioData);
  } catch (err) {
    console.warn(`[Deepgram] Failed to send audio socket=${socketId}:`, err.message);
  }
}

/**
 * Close and clean up the Deepgram session for a socket.
 */
async function stopDeepgramSession(socketId) {
  const entry = activeConnections.get(socketId);
  if (!entry) return;

  activeConnections.delete(socketId);
  entry.isAlive = false;

  try {
    if (entry.liveSocket) {
      try {
        entry.liveSocket.sendCloseStream({});
      } catch (_) {}
      entry.liveSocket.close();
    }
  } catch (_) {}

  console.log(`[Deepgram] Session stopped socket=${socketId}`);
}

function getActiveConnectionCount() {
  return activeConnections.size;
}

module.exports = {
  startDeepgramSession,
  sendAudioToDeepgram,
  stopDeepgramSession,
  getActiveConnectionCount,
};
