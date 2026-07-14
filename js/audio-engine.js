import { PitchShifter } from '../vendor/soundtouch.js?v=2';

function dbToGain(db) { return Math.pow(10, db / 20); }

function buildImpulseResponse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.shifter = null;
    this.buffer = null;
    this.playing = false;
    this.keyLock = true;
    this.pitchSemitones = 0;
    this.fineCents = 0;
    this.tempoPercent = 100;
    this.onEndedCb = null;

    this._buildGraph();

    this.fftSize = 2048;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.frequencyBinCount);

    this._bassAvg = 0;
    this._lastBeatTime = 0;
    this._beatIntervals = [];
    this.bpm = 0;
    this.isBeat = false;
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.preGain = ctx.createGain();
    this.preGain.gain.value = 0.5;

    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 20;

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;

    this.bassShelf = ctx.createBiquadFilter();
    this.bassShelf.type = 'lowshelf';
    this.bassShelf.frequency.value = 150;
    this.bassShelf.gain.value = 0;

    this.trebleShelf = ctx.createBiquadFilter();
    this.trebleShelf.type = 'highshelf';
    this.trebleShelf.frequency.value = 4000;
    this.trebleShelf.gain.value = 0;

    this.formantLow = ctx.createBiquadFilter();
    this.formantLow.type = 'lowshelf';
    this.formantLow.frequency.value = 300;
    this.formantLow.gain.value = 0;

    this.formantHigh = ctx.createBiquadFilter();
    this.formantHigh.type = 'highshelf';
    this.formantHigh.frequency.value = 2500;
    this.formantHigh.gain.value = 0;

    // --- Stereo widener (mid/side) ---
    this.splitter = ctx.createChannelSplitter(2);
    this.gL = ctx.createGain(); this.gL.gain.value = 0.5;
    this.gR = ctx.createGain(); this.gR.gain.value = 0.5;
    this.mid = ctx.createGain(); this.mid.gain.value = 1;
    this.gLside = ctx.createGain(); this.gLside.gain.value = 0.5;
    this.gRnegside = ctx.createGain(); this.gRnegside.gain.value = -0.5;
    this.side = ctx.createGain(); this.side.gain.value = 1;
    this.sideNeg = ctx.createGain(); this.sideNeg.gain.value = -1;
    this.outL = ctx.createGain();
    this.outR = ctx.createGain();
    this.merger = ctx.createChannelMerger(2);

    this.splitter.connect(this.gL, 0);
    this.splitter.connect(this.gR, 1);
    this.gL.connect(this.mid); this.gR.connect(this.mid);
    this.splitter.connect(this.gLside, 0);
    this.splitter.connect(this.gRnegside, 1);
    this.gLside.connect(this.side); this.gRnegside.connect(this.side);
    this.mid.connect(this.outL); this.side.connect(this.outL);
    this.mid.connect(this.outR); this.side.connect(this.sideNeg); this.sideNeg.connect(this.outR);
    this.outL.connect(this.merger, 0, 0);
    this.outR.connect(this.merger, 0, 1);

    // --- Reverb (wet/dry) ---
    this.reverbDry = ctx.createGain(); this.reverbDry.gain.value = 1;
    this.reverbWet = ctx.createGain(); this.reverbWet.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = buildImpulseResponse(ctx, 2.5, 3.2);
    this.reverbSum = ctx.createGain();

    // --- Echo (wet/dry + feedback) ---
    this.echoDry = ctx.createGain(); this.echoDry.gain.value = 1;
    this.echoWet = ctx.createGain(); this.echoWet.gain.value = 0;
    this.delay = ctx.createDelay(2.0); this.delay.delayTime.value = 0.32;
    this.delayFeedback = ctx.createGain(); this.delayFeedback.gain.value = 0.35;
    this.echoSum = ctx.createGain();

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = 0;
    this.compressor.ratio.value = 1;
    this.compressor.knee.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = 0;
    this.limiter.ratio.value = 1;
    this.limiter.knee.value = 0;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.1;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;

    // wire the fixed (non-shifter-dependent) chain
    this.preGain.connect(this.highpass);
    this.highpass.connect(this.lowpass);
    this.lowpass.connect(this.bassShelf);
    this.bassShelf.connect(this.trebleShelf);
    this.trebleShelf.connect(this.formantLow);
    this.formantLow.connect(this.formantHigh);
    this.formantHigh.connect(this.splitter);

    this.merger.connect(this.reverbDry);
    this.merger.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbDry.connect(this.reverbSum);
    this.reverbWet.connect(this.reverbSum);

    this.reverbSum.connect(this.echoDry);
    this.reverbSum.connect(this.delay);
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.delay.connect(this.echoWet);
    this.echoDry.connect(this.echoSum);
    this.echoWet.connect(this.echoSum);

    this.echoSum.connect(this.compressor);
    this.compressor.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);
  }

  // decodeAudioData rejects some real-world MP3s over oversized/malformed ID3v2
  // blocks or junk before the first frame; retry at increasing offsets.
  // Note: decodeAudioData detaches the buffer it's given even on failure, so
  // every attempt gets its own copy sliced from a master that is never handed over.
  async _decode(arrayBuffer) {
    const src = new Uint8Array(arrayBuffer.slice(0));
    const tryDecode = (offset) => this.ctx.decodeAudioData(src.slice(offset).buffer);
    let firstErr;
    try { return await tryDecode(0); } catch (e) { firstErr = e; }

    // skip a declared ID3v2 tag block
    let off = 0;
    if (src.length > 10 && src[0] === 0x49 && src[1] === 0x44 && src[2] === 0x33) {
      const size = ((src[6] & 0x7f) << 21) | ((src[7] & 0x7f) << 14) | ((src[8] & 0x7f) << 7) | (src[9] & 0x7f);
      off = 10 + size + ((src[5] & 0x10) ? 10 : 0);
      if (off > 0 && off < src.length) {
        try { return await tryDecode(off); } catch (e) {}
      }
    }

    // scan for an MPEG frame sync (0xFF 0xEx), retrying a bounded number of times
    let attempts = 0;
    let i = 0;
    while (i < src.length - 1 && attempts < 32) {
      if (src[i] === 0xff && (src[i + 1] & 0xe0) === 0xe0) {
        attempts++;
        try { return await tryDecode(i); } catch (e) {}
        i += 8192;
      } else {
        i++;
      }
    }
    throw firstErr;
  }

  async loadArrayBuffer(arrayBuffer) {
    // decodeAudioData works on a suspended context; never block loading on
    // resume() — without user activation it can stay pending forever
    this._teardownShifter();
    const audioBuffer = await this._decode(arrayBuffer);
    this.buffer = audioBuffer;
    this.shifter = new PitchShifter(this.ctx, audioBuffer, 4096, () => {
      this.playing = false;
      if (this.onEndedCb) this.onEndedCb();
    });
    this._applyPitchTempo();
    this._connected = false;
    this.playing = false;
    return { duration: audioBuffer.duration };
  }

  _teardownShifter() {
    if (this.shifter) {
      try { this.shifter.disconnect(); } catch (e) {}
      this.shifter = null;
    }
  }

  async play() {
    if (!this.shifter) return;
    if (this.ctx.state === 'suspended') {
      // resume() never settles without user activation — don't let it hang playback
      await Promise.race([
        this.ctx.resume(),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
    if (!this._connected) {
      this.shifter.connect(this.preGain);
      this._connected = true;
    }
    this.playing = true;
    return this.ctx.state === 'running';
  }

  pause() {
    if (!this.shifter) return;
    if (this._connected) {
      try { this.shifter.disconnect(); } catch (e) {}
      this._connected = false;
    }
    this.playing = false;
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  seekFraction(frac) {
    if (!this.shifter) return;
    this.shifter.percentagePlayed = Math.min(0.999, Math.max(0, frac));
  }

  get currentTime() { return this.shifter ? this.shifter.timePlayed : 0; }
  get duration() { return this.buffer ? this.buffer.duration : 0; }

  setVolume(v) { this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01); }

  _applyPitchTempo() {
    if (!this.shifter) return;
    const totalSemis = this.pitchSemitones + this.fineCents / 100;
    if (this.keyLock) {
      this.shifter.pitchSemitones = totalSemis;
      this.shifter.tempo = this.tempoPercent / 100;
      this.shifter.rate = 1;
    } else {
      this.shifter.tempo = 1;
      this.shifter.rate = this.tempoPercent / 100;
      this.shifter.pitchSemitones = totalSemis;
    }
  }

  setPitchSemitones(n) { this.pitchSemitones = n; this._applyPitchTempo(); }
  setFineCents(n) { this.fineCents = n; this._applyPitchTempo(); }
  setTempoPercent(p) { this.tempoPercent = p; this._applyPitchTempo(); }
  setKeyLock(on) { this.keyLock = on; this._applyPitchTempo(); }

  setFormant(v) {
    this.formantLow.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    this.formantHigh.gain.setTargetAtTime(-v, this.ctx.currentTime, 0.02);
  }
  setBass(db) { this.bassShelf.gain.setTargetAtTime(db, this.ctx.currentTime, 0.02); }
  setTreble(db) { this.trebleShelf.gain.setTargetAtTime(db, this.ctx.currentTime, 0.02); }
  setWidth(percent) {
    const w = percent / 100;
    this.gLside.gain.setTargetAtTime(0.5 * w, this.ctx.currentTime, 0.02);
    this.gRnegside.gain.setTargetAtTime(-0.5 * w, this.ctx.currentTime, 0.02);
  }
  setReverb(percent) {
    const w = percent / 100;
    this.reverbWet.gain.setTargetAtTime(w * 0.9, this.ctx.currentTime, 0.02);
    this.reverbDry.gain.setTargetAtTime(1 - w * 0.5, this.ctx.currentTime, 0.02);
  }
  setEcho(percent) {
    const w = percent / 100;
    this.echoWet.gain.setTargetAtTime(w * 0.6, this.ctx.currentTime, 0.02);
    this.delayFeedback.gain.setTargetAtTime(0.2 + w * 0.35, this.ctx.currentTime, 0.02);
  }
  setLowpass(freq) { this.lowpass.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02); }
  setHighpass(freq) { this.highpass.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.02); }
  setCompressor(percent) {
    const t = percent / 100;
    this.compressor.threshold.setTargetAtTime(-t * 40, this.ctx.currentTime, 0.02);
    this.compressor.ratio.setTargetAtTime(1 + t * 11, this.ctx.currentTime, 0.02);
  }
  setLimiter(on) {
    this.limiter.threshold.setTargetAtTime(on ? -1 : 0, this.ctx.currentTime, 0.02);
    this.limiter.ratio.setTargetAtTime(on ? 20 : 1, this.ctx.currentTime, 0.02);
  }

  async enableMic() {
    if (this.micSource) return true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.pause();
    this.micStream = stream;
    this.micSource = this.ctx.createMediaStreamSource(stream);
    // feed the mic through the same FX chain (pitch/tempo need a full buffer, so those don't apply)
    this.micSource.connect(this.preGain);
    return true;
  }

  disableMic() {
    if (!this.micSource) return;
    try { this.micSource.disconnect(); } catch (e) {}
    this.micStream.getTracks().forEach((t) => t.stop());
    this.micSource = null;
    this.micStream = null;
  }

  get micActive() { return !!this.micSource; }

  analyze() {
    const a = this.analyser;
    a.getByteFrequencyData(this.freqData);
    a.getByteTimeDomainData(this.timeData);
    const n = this.freqData.length;
    const bassEnd = Math.floor(n * 0.08);
    const midEnd = Math.floor(n * 0.35);
    let bass = 0, mid = 0, treble = 0;
    for (let i = 0; i < bassEnd; i++) bass += this.freqData[i];
    for (let i = bassEnd; i < midEnd; i++) mid += this.freqData[i];
    for (let i = midEnd; i < n; i++) treble += this.freqData[i];
    bass = bass / bassEnd / 255;
    mid = mid / (midEnd - bassEnd) / 255;
    treble = treble / (n - midEnd) / 255;

    this._bassAvg = this._bassAvg * 0.95 + bass * 0.05;
    const now = performance.now();
    this.isBeat = false;
    if (bass > this._bassAvg * 1.35 && bass > 0.15 && now - this._lastBeatTime > 220) {
      this.isBeat = true;
      const interval = now - this._lastBeatTime;
      if (this._lastBeatTime > 0 && interval < 2000) {
        this._beatIntervals.push(interval);
        if (this._beatIntervals.length > 8) this._beatIntervals.shift();
        const avgInterval = this._beatIntervals.reduce((a, b) => a + b, 0) / this._beatIntervals.length;
        this.bpm = Math.round(60000 / avgInterval);
      }
      this._lastBeatTime = now;
    }

    const energy = (bass * 1.4 + mid + treble * 0.8) / 3;
    return { freqData: this.freqData, timeData: this.timeData, bass, mid, treble, energy, isBeat: this.isBeat, bpm: this.bpm };
  }
}
