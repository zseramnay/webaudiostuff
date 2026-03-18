class KarplusStrongProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.maxVoices = 8;

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'pluck') {
        this.addVoice(msg);
      } else if (msg.type === 'panic') {
        this.voices = [];
      }
    };
  }

  addVoice(params) {
    const freq = Math.max(30, Math.min(2000, Number(params.freq) || 110));
    const decay = Math.max(0.9, Math.min(0.998, Number(params.decay) || 0.965));
    const dampingHz = Math.max(100, Math.min(12000, Number(params.dampingHz) || 2500));
    const brightnessHz = Math.max(100, Math.min(12000, Number(params.brightnessHz) || 3500));
    const level = Math.max(0.01, Math.min(1, Number(params.level) || 0.3));

    const delaySamples = Math.max(2, Math.floor(sampleRate / freq));
    const buffer = new Float32Array(delaySamples);

    // Pick excitation: white noise filtered by brightness.
    let pickState = 0;
    const pickAlpha = this.hzToAlpha(brightnessHz);
    for (let i = 0; i < delaySamples; i++) {
      const white = Math.random() * 2 - 1;
      pickState = pickState + pickAlpha * (white - pickState);
      buffer[i] = pickState;
    }

    const voice = {
      buffer,
      index: 0,
      decay,
      level,
      dampingAlpha: this.hzToAlpha(dampingHz),
      lpState: 0,
      life: 0,
      maxLife: Math.floor(sampleRate * 8),
      silentCount: 0,
    };

    this.voices.push(voice);
    if (this.voices.length > this.maxVoices) {
      this.voices.shift();
    }
  }

  hzToAlpha(hz) {
    const rc = 1 / (2 * Math.PI * hz);
    const dt = 1 / sampleRate;
    return dt / (rc + dt);
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;

    for (let i = 0; i < output.length; i++) {
      let mixed = 0;

      for (let v = this.voices.length - 1; v >= 0; v--) {
        const voice = this.voices[v];
        const buf = voice.buffer;

        const idx = voice.index;
        const nextIdx = (idx + 1) % buf.length;

        const current = buf[idx];
        const avg = 0.5 * (buf[idx] + buf[nextIdx]);

        // Low-pass in feedback loop: higher dampingHz keeps more highs.
        voice.lpState = voice.lpState + voice.dampingAlpha * (avg - voice.lpState);
        buf[idx] = voice.lpState * voice.decay;

        voice.index = nextIdx;
        voice.life += 1;

        const out = current * voice.level;
        mixed += out;

        if (Math.abs(out) < 1e-5) {
          voice.silentCount += 1;
        } else {
          voice.silentCount = 0;
        }

        if (voice.silentCount > sampleRate * 0.2 || voice.life > voice.maxLife) {
          this.voices.splice(v, 1);
        }
      }

      // Soft limiting to avoid harsh peaks.
      output[i] = Math.tanh(mixed * 0.8);
    }

    return true;
  }
}

registerProcessor('karplus-strong-processor', KarplusStrongProcessor);
