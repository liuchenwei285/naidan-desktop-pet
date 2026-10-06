/* ============================================================================
 *  audio.js —— 播放外部素材「Bubble_4」(纯 Web Audio,低延迟)
 * ----------------------------------------------------------------------------
 *  · 启动时预加载 + decodeAudioData 解码
 *  · AudioBufferSourceNode + playbackRate 调音高
 *  · 开头 5ms 淡入 / 结尾 30ms 淡出,防爆音
 *  · 自动裁掉音频开头的静音 + 响度自动归一
 *  · 每次触发 ±3% 随机音高扰动
 *  · 同时发声上限 4,超出淡出最早的一个
 *
 *  音源:Freesound「Bubble_4」by BenParamoreAudio
 *        https://freesound.org/people/BenParamoreAudio/sounds/868712/
 *        许可证 CC0 1.0(公共领域)— 详见 CREDITS.md
 * ========================================================================== */
(function (root) {
  'use strict';

  var CONFIG = root.Naidan.CONFIG;

  function SoundEngine(options) {
    options = options || {};
    this.ctx = options.context || null;
    this.offline = !!options.context;
    this.master = null;
    this.comp = null;
    this.buffer = null;
    this.ready = false;
    this.failed = false;
    this.loading = null;
    this.enabled = CONFIG.audio.enabled;
    this.muted = CONFIG.audio.muted;
    this.voices = [];
    this.lastAt = 0;
    if (this.ctx) this.buildGraph();
  }

  SoundEngine.prototype.buildGraph = function () {
    try {
      var ctx = this.ctx;
      var c = CONFIG.audio.compressor || { threshold: -8, knee: 4, ratio: 3, attack: 0.003, release: 0.2 };
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = c.threshold; comp.knee.value = c.knee; comp.ratio.value = c.ratio;
      comp.attack.value = c.attack; comp.release.value = c.release;
      var master = ctx.createGain();
      master.gain.value = this.muted ? 0 : CONFIG.audio.masterGain;
      comp.connect(master); master.connect(ctx.destination);
      this.comp = comp; this.master = master;
    } catch (e) { this.failed = true; console.warn('[audio] 母线建立失败:', e); }
  };

  SoundEngine.prototype.ensure = function () {
    if (this.ctx) { if (!this.comp) this.buildGraph(); return this.ctx; }
    if (this.failed) return null;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { this.failed = true; return null; }
    try { this.ctx = new AC(); this.buildGraph(); }
    catch (e) { this.failed = true; console.warn('[audio] 初始化失败:', e); }
    return this.ctx;
  };

  /* ------------------------------------------------------------------ */
  /* 读取素材:Electron 下 file:// 不能 fetch,走主进程 IPC              */
  /* ------------------------------------------------------------------ */
  SoundEngine.prototype.readBytes = function (file) {
    var key = file || CONFIG.audio.file;
    if (root.petAPI && root.petAPI.readAudio) {
      return root.petAPI.readAudio(key).then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'readAudio failed');
        return new Uint8Array(res.data).buffer;
      });
    }
    return fetch(key).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    });
  };

  SoundEngine.prototype.load = function () {
    if (this.loading) return this.loading;
    var ctx = this.ensure();
    if (!ctx) return Promise.resolve(false);
    var self = this;
    this.loading = this.readBytes()
      .then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (buf) {
        self.buffer = self.normalize(self.trimSilence(buf));
        self.ready = true;
        return true;
      })
      .catch(function (e) {
        self.failed = true;
        console.warn('[audio] 素材加载失败(' + CONFIG.audio.file + '):', e.message,
                     '—— 请把 Bubble_4 放到项目 audio/ 目录(文件名 bubble_4.mp3 / .wav)');
        return false;
      });
    return this.loading;
  };

  /** 去掉开头静音(保留 2ms 预滚) */
  SoundEngine.prototype.trimSilence = function (buf) {
    if (!CONFIG.audio.trimLeadingSilence) return buf;
    var th = CONFIG.audio.silenceThreshold || 0.01;
    var d = buf.getChannelData(0), start = -1;
    for (var i = 0; i < d.length; i++) { if (Math.abs(d[i]) > th) { start = i; break; } }
    if (start <= 0) return buf;
    var keep = Math.max(0, start - Math.floor(buf.sampleRate * 0.002));
    var out = this.ctx.createBuffer(buf.numberOfChannels, buf.length - keep, buf.sampleRate);
    for (var ch = 0; ch < buf.numberOfChannels; ch++) {
      out.getChannelData(ch).set(buf.getChannelData(ch).subarray(keep));
    }
    return out;
  };

  /** 响度归一(该素材峰值只有 0.04,不归一几乎听不见) */
  SoundEngine.prototype.normalize = function (buf) {
    var N = CONFIG.audio.normalize;
    if (!N || !N.enabled) return buf;
    var peak = 0, ch, d, i;
    for (ch = 0; ch < buf.numberOfChannels; ch++) {
      d = buf.getChannelData(ch);
      for (i = 0; i < d.length; i++) { var v = Math.abs(d[i]); if (v > peak) peak = v; }
    }
    if (peak < 1e-4 || peak >= N.targetPeak) return buf;
    var g = N.targetPeak / peak;
    for (ch = 0; ch < buf.numberOfChannels; ch++) {
      d = buf.getChannelData(ch);
      for (i = 0; i < d.length; i++) d[i] *= g;
    }
    return buf;
  };

  SoundEngine.prototype.unlock = function () {
    var ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    if (!this.ready && !this.loading) this.load();
  };

  SoundEngine.prototype.setMuted = function (m) {
    this.muted = !!m;
    if (this.master && this.ctx) {
      var now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : CONFIG.audio.masterGain, now, 0.02);
    }
  };
  SoundEngine.prototype.isMuted = function () { return this.muted; };

  /* ------------------------------------------------------------------ */
  /* 播放一声                                                            */
  /* ------------------------------------------------------------------ */
  SoundEngine.prototype.play = function (at, pitch, vol) {
    if (!this.enabled || this.failed) return;
    var ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    if (!this.ready) { this.load(); return; }

    var A = CONFIG.audio;
    pitch = (pitch || 1) * (1 + (Math.random() * 2 - 1) * (A.pitchJitter || 0));
    vol = (vol === undefined) ? 1 : vol;

    var t0 = at || (ctx.currentTime + 0.004);
    if (!this.offline) {
      if (t0 < this.lastAt + (A.minIntervalMs || 40) / 1000) t0 = this.lastAt + (A.minIntervalMs || 40) / 1000;
      this.lastAt = t0;
    }

    var src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = pitch;

    var g = ctx.createGain();
    var fi = A.fadeInSec === undefined ? 0.005 : A.fadeInSec;
    var fo = A.fadeOutSec === undefined ? 0.030 : A.fadeOutSec;
    var dur = this.buffer.duration / pitch;
    var peak = (A.voiceGain === undefined ? 1 : A.voiceGain) * vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + fi);
    g.gain.setValueAtTime(peak, t0 + Math.max(fi, dur - fo));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);

    var lp = null;
    if (A.lowpassHz) {
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = A.lowpassHz; lp.Q.value = 0.7;
    }
    src.connect(g);
    if (lp) { g.connect(lp); lp.connect(this.comp); } else { g.connect(this.comp); }
    src.start(t0);
    src.stop(t0 + dur + 0.01);

    var voice = { gain: g, src: src, stop: t0 + dur };
    this.voices.push(voice);
    var self = this;
    src.onended = function () {
      var i = self.voices.indexOf(voice);
      if (i >= 0) self.voices.splice(i, 1);
    };

    var maxV = A.maxVoices || 4;
    while (this.voices.length > maxV) {
      var old = this.voices.shift();
      try {
        var now = ctx.currentTime;
        old.gain.gain.cancelScheduledValues(now);
        old.gain.gain.setTargetAtTime(0.0001, now, 0.02);
        old.src.stop(now + 0.08);
      } catch (e) { /* ignore */ }
    }
  };

  SoundEngine.prototype.duang = function (at, pitch, vol) { this.play(at, pitch, vol); };
  SoundEngine.prototype.playBounce = function (at, pitch, vol) { this.play(at, pitch, vol); };

  /** 点击后按弹簧极点时刻排多次弹跳 */
  SoundEngine.prototype.duangSequence = function (nowSec, times) {
    var A = CONFIG.audio;
    for (var i = 0; i < times.length; i++) {
      this.play(nowSec + times[i],
                A.pitchSeq[i] === undefined ? 1 : A.pitchSeq[i],
                A.gainSeq[i] === undefined ? 0.2 : A.gainSeq[i]);
    }
  };

  /** 轻动作(小跳 / 落地回弹) */
  SoundEngine.prototype.light = function (at) {
    var L = CONFIG.audio.lightAction || { volume: 0.25, pitch: 1.15 };
    this.play(at, L.pitch, L.volume);
  };

  SoundEngine.prototype.dispose = function () {
    try {
      if (this.master) { this.master.disconnect(); this.master = null; }
      if (this.comp) { this.comp.disconnect(); this.comp = null; }
      if (this.ctx && !this.offline) { this.ctx.close(); this.ctx = null; }
    } catch (e) { /* ignore */ }
  };

  root.Naidan.SoundEngine = SoundEngine;
})(typeof window !== 'undefined' ? window : globalThis);
