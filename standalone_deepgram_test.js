/**
 * standalone_deepgram_test.js
 *
 * Standalone Deepgram Nova-3 Real-Time Microphone Streaming Test.
 * Completely isolated from Syncora, WebRTC, React, Socket.IO, and Database.
 *
 * Usage:
 *   node standalone_deepgram_test.js
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// 1. Locate backend directory and load existing .env
const backendDir = fs.existsSync(path.join(__dirname, 'backend'))
  ? path.join(__dirname, 'backend')
  : __dirname;

const envPath = path.join(backendDir, '.env');
if (!fs.existsSync(envPath)) {
  console.error(`[Error] .env file not found at: ${envPath}`);
  process.exit(1);
}

// Load dotenv from backend node_modules
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'));
dotenv.config({ path: envPath, quiet: true });

const apiKey = process.env.DEEPGRAM_API_KEY;
if (!apiKey) {
  console.error('[Error] DEEPGRAM_API_KEY is not set in backend/.env');
  process.exit(1);
}

// Load Deepgram SDK and ws from backend node_modules
const { DeepgramClient } = require(path.join(backendDir, 'node_modules', '@deepgram/sdk'));
const { WebSocketServer, WebSocket } = require(path.join(backendDir, 'node_modules', 'ws'));

const PORT = 4321;

// 2. HTML UI to capture microphone audio directly via standard Web Audio API
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Deepgram Nova-3 Standalone Mic Test</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: #0c0f17; color: #e2e8f0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { background: #161c2c; border: 1px solid #2a3449; border-radius: 16px; padding: 32px; max-width: 640px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
    h1 { font-size: 22px; font-weight: 700; color: #f8fafc; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }
    p.subtitle { font-size: 14px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .status-badge { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 999px; background: #1e293b; color: #94a3b8; margin-bottom: 20px; }
    .status-badge.connected { background: #064e3b; color: #34d399; }
    .status-badge.streaming { background: #1e3a8a; color: #60a5fa; }
    .status-badge.error { background: #7f1d1d; color: #f87171; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .pulse { animation: pulse 1.5s infinite; }
    @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
    .btn-row { display: flex; gap: 12px; margin-bottom: 24px; }
    button { flex: 1; padding: 14px 20px; font-size: 15px; font-weight: 600; border-radius: 10px; border: none; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-start { background: #3b82f6; color: white; }
    .btn-start:hover:not(:disabled) { background: #2563eb; transform: translateY(-1px); }
    .btn-stop { background: #ef4444; color: white; }
    .btn-stop:hover:not(:disabled) { background: #dc2626; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    .meter-container { background: #0f172a; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; border: 1px solid #1e293b; }
    .meter-label { font-size: 12px; color: #64748b; margin-bottom: 6px; display: flex; justify-content: space-between; }
    .meter-bar { height: 8px; background: #1e293b; border-radius: 4px; overflow: hidden; }
    .meter-fill { height: 100%; width: 0%; background: #22c55e; transition: width 0.05s ease-out; }
    .terminal-box { background: #07090e; border: 1px solid #1e293b; border-radius: 10px; padding: 16px; min-height: 200px; max-height: 320px; overflow-y: auto; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.6; }
    .log-line { margin-bottom: 4px; word-break: break-word; }
    .log-interim { color: #facc15; }
    .log-final { color: #4ade80; font-weight: 600; }
    .log-system { color: #94a3b8; }
    .log-error { color: #f87171; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎙️ Deepgram Nova-3 Mic Test</h1>
    <p class="subtitle">Direct streaming from your microphone to Deepgram Nova-3. Results are logged both here and in your terminal.</p>

    <div id="status" class="status-badge">
      <span class="dot"></span>
      <span id="statusText">Ready to start</span>
    </div>

    <div class="btn-row">
      <button id="startBtn" class="btn-start">Start Microphone</button>
      <button id="stopBtn" class="btn-stop" disabled>Stop</button>
    </div>

    <div class="meter-container">
      <div class="meter-label">
        <span>Microphone Volume</span>
        <span id="volumePct">0%</span>
      </div>
      <div class="meter-bar">
        <div id="meterFill" class="meter-fill"></div>
      </div>
    </div>

    <div class="terminal-box" id="logs">
      <div class="log-line log-system">Click "Start Microphone" to begin testing...</div>
    </div>
  </div>

  <script>
    let ws = null;
    let audioCtx = null;
    let stream = null;
    let processor = null;
    let source = null;
    let animId = null;

    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusDiv = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const logsDiv = document.getElementById('logs');
    const meterFill = document.getElementById('meterFill');
    const volumePct = document.getElementById('volumePct');

    function appendLog(text, className) {
      const line = document.createElement('div');
      line.className = 'log-line ' + (className || 'log-system');
      line.textContent = text;
      logsDiv.appendChild(line);
      logsDiv.scrollTop = logsDiv.scrollHeight;
    }

    function setStatus(text, type) {
      statusText.textContent = text;
      statusDiv.className = 'status-badge ' + (type || '');
    }

    startBtn.onclick = async () => {
      try {
        startBtn.disabled = true;
        setStatus('Connecting to local server...', 'streaming');
        appendLog('Requesting microphone permission...', 'log-system');

        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });

        appendLog('Microphone permission granted.', 'log-system');

        // Connect WebSocket to local Node server
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(wsProtocol + '//' + window.location.host);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          appendLog('WebSocket to test server open. Initializing AudioContext...', 'log-system');
          startAudioPipeline(stream);
          stopBtn.disabled = false;
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'STATUS') {
              setStatus(msg.status, msg.variant);
              appendLog(msg.status, msg.variant === 'error' ? 'log-error' : 'log-system');
            } else if (msg.type === 'INTERIM') {
              appendLog('INTERIM: ' + msg.text, 'log-interim');
            } else if (msg.type === 'FINAL') {
              appendLog('FINAL:   ' + msg.text, 'log-final');
            }
          } catch (e) {
            appendLog(event.data, 'log-system');
          }
        };

        ws.onerror = (err) => {
          appendLog('WebSocket error', 'log-error');
          setStatus('Connection error', 'error');
        };

        ws.onclose = () => {
          appendLog('WebSocket closed', 'log-system');
          stopAudio();
        };

      } catch (err) {
        appendLog('Microphone error: ' + err.message, 'log-error');
        setStatus('Mic permission denied', 'error');
        startBtn.disabled = false;
      }
    };

    function startAudioPipeline(mediaStream) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();

      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      source = audioCtx.createMediaStreamSource(mediaStream);

      // Volume meter via AnalyserNode
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      function updateMeter() {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        const pct = Math.min(100, Math.round((avg / 128) * 100));
        meterFill.style.width = pct + '%';
        volumePct.textContent = pct + '%';
        animId = requestAnimationFrame(updateMeter);
      }
      updateMeter();

      // ScriptProcessorNode: sample browser audio, resample to 16kHz Int16 PCM
      const bufferSize = 4096;
      processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      const resampleRatio = audioCtx.sampleRate / 16000;

      processor.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);

        const outputLength = Math.floor(inputData.length / resampleRatio);
        const int16Buffer = new Int16Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
          const sample = Math.max(-1, Math.min(1, inputData[Math.floor(i * resampleRatio)]));
          int16Buffer[i] = sample < 0 ? sample * 32768 : sample * 32767;
        }

        ws.send(int16Buffer.buffer);
      };

      // Connect to silent destination to keep pipeline running without audio feedback
      const silentDest = audioCtx.createMediaStreamDestination();
      source.connect(processor);
      processor.connect(silentDest);

      setStatus('Streaming live audio to Deepgram', 'streaming');
      appendLog('Streaming 16kHz PCM audio to Deepgram Nova-3. Speak now!', 'log-system');
    }

    function stopAudio() {
      if (animId) cancelAnimationFrame(animId);
      if (processor) { processor.disconnect(); processor = null; }
      if (source) { source.disconnect(); source = null; }
      if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close(); audioCtx = null; }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (ws && ws.readyState === WebSocket.OPEN) { ws.close(); }
      startBtn.disabled = false;
      stopBtn.disabled = true;
      meterFill.style.width = '0%';
      volumePct.textContent = '0%';
      setStatus('Stopped', '');
    }

    stopBtn.onclick = () => {
      appendLog('Stopping microphone...', 'log-system');
      stopAudio();
    };
  </script>
</body>
</html>`;

// 3. Create HTTP Server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML_PAGE);
});

// 4. Create WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', async (wsClient) => {
  console.log('\\n[Client] Browser connected. Initializing Deepgram Nova-3 session...');

  let deepgramLive = null;
  let isDeepgramReady = false;

  try {
    const deepgram = new DeepgramClient({ apiKey });

    // Exact requested streaming parameters
    deepgramLive = await deepgram.listen.v1.connect({
      model: 'nova-3',
      language: 'multi',
      interim_results: true,
      endpointing: 300,
      smart_format: true,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    });

    deepgramLive.on('open', () => {
      isDeepgramReady = true;
      console.log('\\x1b[32m%s\\x1b[0m', '--------------------------------------------------');
      console.log('\\x1b[32m%s\\x1b[0m', 'DEEPGRAM CONNECTED');
      console.log('\\x1b[32m%s\\x1b[0m', '--------------------------------------------------');
      console.log('Speak into your microphone now (Hindi / English / Hinglish)...\\n');

      if (wsClient.readyState === WebSocket.OPEN) {
        wsClient.send(JSON.stringify({
          type: 'STATUS',
          status: 'DEEPGRAM CONNECTED — Listening...',
          variant: 'connected',
        }));
      }
    });

    deepgramLive.on('message', (data) => {
      if (data?.type !== 'Results') return;

      const alt = data?.channel?.alternatives?.[0];
      const transcript = alt?.transcript?.trim();
      if (!transcript) return;

      const isFinal = data.is_final === true || data.speech_final === true;

      if (isFinal) {
        console.log(`\\x1b[32mFINAL:\\x1b[0m   ${transcript}`);
        if (wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(JSON.stringify({ type: 'FINAL', text: transcript }));
        }
      } else {
        console.log(`\\x1b[33mINTERIM:\\x1b[0m ${transcript}`);
        if (wsClient.readyState === WebSocket.OPEN) {
          wsClient.send(JSON.stringify({ type: 'INTERIM', text: transcript }));
        }
      }
    });

    deepgramLive.on('error', (err) => {
      console.error('\\x1b[31mDEEPGRAM ERROR:\\x1b[0m', err?.message || err);
      if (wsClient.readyState === WebSocket.OPEN) {
        wsClient.send(JSON.stringify({
          type: 'STATUS',
          status: 'DEEPGRAM ERROR: ' + (err?.message || 'Error occurred'),
          variant: 'error',
        }));
      }
    });

    deepgramLive.on('close', (event) => {
      console.log('\\x1b[35mDEEPGRAM CLOSED\\x1b[0m', event?.code ? `(Code: ${event.code})` : '');
      if (wsClient.readyState === WebSocket.OPEN) {
        wsClient.send(JSON.stringify({
          type: 'STATUS',
          status: 'DEEPGRAM CLOSED',
          variant: '',
        }));
      }
    });

    deepgramLive.connect();

  } catch (err) {
    console.error('\\x1b[31mDEEPGRAM ERROR:\\x1b[0m Failed to initialize Deepgram:', err.message);
    if (wsClient.readyState === WebSocket.OPEN) {
      wsClient.send(JSON.stringify({
        type: 'STATUS',
        status: 'DEEPGRAM ERROR: ' + err.message,
        variant: 'error',
      }));
    }
  }

  // Receive binary PCM audio chunks from browser microphone and stream directly to Deepgram
  wsClient.on('message', (chunk, isBinary) => {
    if (isBinary && deepgramLive && isDeepgramReady) {
      try {
        deepgramLive.sendMedia(chunk);
      } catch (err) {
        console.error('[Error] Failed to forward audio chunk:', err.message);
      }
    }
  });

  wsClient.on('close', () => {
    console.log('[Client] Browser closed mic stream.');
    if (deepgramLive) {
      try {
        deepgramLive.sendCloseStream({});
      } catch (_) {}
      deepgramLive.close();
    }
  });
});

// 5. Start Server and launch browser
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('\\x1b[36m%s\\x1b[0m', '==================================================');
  console.log('\\x1b[36m%s\\x1b[0m', ' DEEPGRAM NOVA-3 STANDALONE MICROPHONE TEST');
  console.log('\\x1b[36m%s\\x1b[0m', '==================================================');
  console.log(`Backend .env: Loaded successfully (API Key present)`);
  console.log(`Model:        nova-3`);
  console.log(`Language:     multi`);
  console.log(`Endpointing:  300ms`);
  console.log(`Interim:      true`);
  console.log(`Server URL:   ${url}`);
  console.log('--------------------------------------------------');
  console.log('Opening browser to capture microphone...');
  console.log(`(If browser doesn't open automatically, open ${url} manually)`);
  console.log('--------------------------------------------------\\n');

  // Open browser on Windows
  exec(`start ${url}`, (err) => {
    if (err) {
      console.log(`Open your browser and navigate to: ${url}`);
    }
  });
});
