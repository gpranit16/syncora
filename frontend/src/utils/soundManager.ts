// ============================================================================
// Syncora Web Audio API Sound Synthesizer Engine
// Provides zero-latency, cross-browser synthesised sounds for messages,
// calls, tasks, meetings, and notifications without requiring external audio files.
// Includes active-cancellation and event debouncing to eliminate duplicate sounds.
// ============================================================================

class SoundManager {
  private audioCtx: AudioContext | null = null;
  private ringtoneInterval: number | null = null;
  private ringtoneOscillators: { osc: OscillatorNode; gain: GainNode }[] = [];
  private ringbackInterval: number | null = null;
  private ringbackOscillators: { osc: OscillatorNode; gain: GainNode }[] = [];
  private isMuted: boolean = false;
  private isUnlocked: boolean = false;
  private isRingtoneActive: boolean = false;
  private lastSoundTimestamps: Map<string, number> = new Map();

  constructor() {
    // Check localStorage preference
    try {
      const savedMute = localStorage.getItem('syncora_sound_muted');
      if (savedMute !== null) {
        this.isMuted = savedMute === 'true';
      }
    } catch {}

    // Unlock AudioContext on first user interaction anywhere on the document
    this.setupUnlockListeners();
  }

  private setupUnlockListeners() {
    if (typeof window === 'undefined') return;

    const unlockHandler = () => {
      this.initAudioContext();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      this.isUnlocked = true;
      window.removeEventListener('click', unlockHandler);
      window.removeEventListener('keydown', unlockHandler);
      window.removeEventListener('touchstart', unlockHandler);
    };

    window.addEventListener('click', unlockHandler, { once: true, passive: true });
    window.addEventListener('keydown', unlockHandler, { once: true, passive: true });
    window.addEventListener('touchstart', unlockHandler, { once: true, passive: true });
  }

  private initAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass) {
          this.audioCtx = new AudioCtxClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    } catch (err) {
      console.warn('[SoundManager] AudioContext initialization failed:', err);
      return null;
    }
  }

  private shouldDebounce(soundKey: string, cooldownMs = 280): boolean {
    const now = Date.now();
    const last = this.lastSoundTimestamps.get(soundKey) || 0;
    if (now - last < cooldownMs) {
      return true;
    }
    this.lastSoundTimestamps.set(soundKey, now);
    return false;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    try {
      localStorage.setItem('syncora_sound_muted', String(muted));
    } catch {}
    if (muted) {
      this.stopAllTones();
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  // --------------------------------------------------------------------------
  // 1. Channel Message Sound (Soft dual-tone Slack/Discord style)
  // --------------------------------------------------------------------------
  public playMessageSound() {
    if (this.isMuted || this.shouldDebounce('msg_sound', 280)) return;
    const ctx = this.initAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // First note (D5 - 587.33 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.2);

      // Second note (A5 - 880.00 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.00, now + 0.08);
      gain2.gain.setValueAtTime(0.001, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.14, now + 0.10);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.35);
    } catch (e) {
      console.warn('[SoundManager] playMessageSound error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 2. Direct Message (DM) Sound (Lively crystal pop chime)
  // --------------------------------------------------------------------------
  public playDmSound() {
    if (this.isMuted || this.shouldDebounce('dm_sound', 280)) return;
    const ctx = this.initAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.16);

      // Note 2: C6 (1046.50 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1046.50, now + 0.07);
      gain2.gain.setValueAtTime(0.001, now + 0.07);
      gain2.gain.exponentialRampToValueAtTime(0.16, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.07);
      osc2.stop(now + 0.38);
    } catch (e) {
      console.warn('[SoundManager] playDmSound error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 3. Task Assigned / Updated Sound (Ascending tri-tone chime C5-E5-G5)
  // --------------------------------------------------------------------------
  public playTaskSound() {
    if (this.isMuted || this.shouldDebounce('task_sound', 300)) return;
    const ctx = this.initAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [
        { freq: 523.25, time: 0.0, dur: 0.18, vol: 0.12 }, // C5
        { freq: 659.25, time: 0.09, dur: 0.18, vol: 0.14 }, // E5
        { freq: 783.99, time: 0.18, dur: 0.35, vol: 0.16 }, // G5
      ];

      notes.forEach(({ freq, time, dur, vol }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);
        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.exponentialRampToValueAtTime(vol, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + time);
        osc.stop(now + time + dur + 0.05);
      });
    } catch (e) {
      console.warn('[SoundManager] playTaskSound error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 4. Meeting Started / Meeting Invite Sound (Resonant double-chime)
  // --------------------------------------------------------------------------
  public playMeetingSound() {
    if (this.isMuted || this.shouldDebounce('meeting_sound', 300)) return;
    const ctx = this.initAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [
        { freq: 440.00, time: 0.0, dur: 0.22, vol: 0.14, type: 'triangle' as OscillatorType },
        { freq: 880.00, time: 0.14, dur: 0.40, vol: 0.15, type: 'sine' as OscillatorType },
      ];

      notes.forEach(({ freq, time, dur, vol, type }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + time);
        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.exponentialRampToValueAtTime(vol, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + time);
        osc.stop(now + time + dur + 0.05);
      });
    } catch (e) {
      console.warn('[SoundManager] playMeetingSound error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 5. General Notification Sound (Crisp bell chime)
  // --------------------------------------------------------------------------
  public playNotificationSound() {
    if (this.isMuted || this.shouldDebounce('notif_sound', 300)) return;
    const ctx = this.initAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(784.00, now);
      osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.12);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch (e) {
      console.warn('[SoundManager] playNotificationSound error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 6. Message Sent Tactile Pop Sound
  // --------------------------------------------------------------------------
  public playSendSound() {
    if (this.isMuted || this.shouldDebounce('send_sound', 120)) return;
    const ctx = this.initAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(720, now + 0.06);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch (e) {
      console.warn('[SoundManager] playSendSound error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 7. Incoming Call Ringtone (Polyphonic looping melody)
  // --------------------------------------------------------------------------
  public startIncomingCallRingtone() {
    if (this.isMuted) return;
    this.stopIncomingCallRingtone();
    this.stopRingbackTone();
    this.isRingtoneActive = true;

    const ctx = this.initAudioContext();
    if (!ctx) return;

    const playMelody = () => {
      if (!this.isRingtoneActive || this.isMuted || !this.audioCtx || this.audioCtx.state === 'closed') return;

      try {
        const baseNow = this.audioCtx.currentTime;
        // Harmonic melodic sequence for incoming call
        const notes = [
          { delay: 0.0, freq: 659.25, dur: 0.22, vol: 0.14 }, // E5
          { delay: 0.15, freq: 830.61, dur: 0.22, vol: 0.14 }, // G#5
          { delay: 0.30, freq: 987.77, dur: 0.28, vol: 0.16 }, // B5
          { delay: 0.55, freq: 830.61, dur: 0.20, vol: 0.12 }, // G#5
          { delay: 0.70, freq: 987.77, dur: 0.35, vol: 0.16 }, // B5
          { delay: 1.10, freq: 659.25, dur: 0.22, vol: 0.14 }, // E5
          { delay: 1.25, freq: 830.61, dur: 0.22, vol: 0.14 }, // G#5
          { delay: 1.40, freq: 1174.66, dur: 0.45, vol: 0.18 }, // D6
        ];

        notes.forEach(({ delay, freq, dur, vol }) => {
          if (!this.isRingtoneActive || !this.audioCtx) return;
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, baseNow + delay);
          gain.gain.setValueAtTime(0.001, baseNow + delay);
          gain.gain.exponentialRampToValueAtTime(vol, baseNow + delay + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, baseNow + delay + dur);

          osc.connect(gain);
          gain.connect(this.audioCtx.destination);

          this.ringtoneOscillators.push({ osc, gain });

          osc.onended = () => {
            this.ringtoneOscillators = this.ringtoneOscillators.filter((item) => item.osc !== osc);
            try {
              osc.disconnect();
              gain.disconnect();
            } catch {}
          };

          osc.start(baseNow + delay);
          osc.stop(baseNow + delay + dur + 0.05);
        });
      } catch (e) {
        console.warn('[SoundManager] Ringtone play error:', e);
      }
    };

    playMelody();
    this.ringtoneInterval = window.setInterval(playMelody, 2600);
  }

  public stopIncomingCallRingtone() {
    this.isRingtoneActive = false;
    if (this.ringtoneInterval !== null) {
      clearInterval(this.ringtoneInterval);
      window.clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }

    while (this.ringtoneOscillators.length > 0) {
      const item = this.ringtoneOscillators.pop();
      if (item) {
        try {
          item.gain.gain.cancelScheduledValues(0);
          item.gain.gain.setValueAtTime(0, 0);
          item.gain.disconnect();
        } catch {}
        try {
          item.osc.stop(0);
          item.osc.disconnect();
        } catch {}
      }
    }
  }

  // --------------------------------------------------------------------------
  // 8. Outgoing Call Ringback Tone (Traditional pulsing beep)
  // --------------------------------------------------------------------------
  public startRingbackTone() {
    if (this.isMuted) return;
    this.stopAllTones();

    const ctx = this.initAudioContext();
    if (!ctx) return;

    const playBeep = () => {
      if (this.isMuted || !this.audioCtx || this.audioCtx.state === 'closed') return;

      try {
        const now = this.audioCtx.currentTime;
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.05, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.audioCtx.destination);

        this.ringbackOscillators.push({ osc: osc1, gain }, { osc: osc2, gain });

        const cleanup = () => {
          this.ringbackOscillators = this.ringbackOscillators.filter(
            (o) => o.osc !== osc1 && o.osc !== osc2
          );
          try {
            osc1.disconnect();
            osc2.disconnect();
            gain.disconnect();
          } catch {}
        };

        osc1.onended = cleanup;
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.25);
        osc2.stop(now + 1.25);
      } catch (e) {
        console.warn('[SoundManager] Ringback tone error:', e);
      }
    };

    playBeep();
    this.ringbackInterval = window.setInterval(playBeep, 3500);
  }

  public stopRingbackTone() {
    if (this.ringbackInterval !== null) {
      clearInterval(this.ringbackInterval);
      window.clearInterval(this.ringbackInterval);
      this.ringbackInterval = null;
    }

    while (this.ringbackOscillators.length > 0) {
      const item = this.ringbackOscillators.pop();
      if (item) {
        try {
          item.gain.gain.cancelScheduledValues(0);
          item.gain.gain.setValueAtTime(0, 0);
          item.gain.disconnect();
        } catch {}
        try {
          item.osc.stop(0);
          item.osc.disconnect();
        } catch {}
      }
    }
  }

  // --------------------------------------------------------------------------
  // 9. Call Ended Sound (Soft descending tone)
  // --------------------------------------------------------------------------
  public playCallEndedSound() {
    if (this.isMuted) return;
    this.stopAllTones();

    const ctx = this.initAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.35);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.38);
    } catch (e) {
      console.warn('[SoundManager] playCallEndedSound error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // Stop all active looping tones
  // --------------------------------------------------------------------------
  public stopAllTones() {
    this.stopIncomingCallRingtone();
    this.stopRingbackTone();
  }
}

export const soundManager = new SoundManager();
