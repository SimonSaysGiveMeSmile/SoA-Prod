/**
 * Waveform Visualizer
 * Real-time audio waveform display at bottom of active terminal
 *
 * Context decisions implemented:
 * - Waveform visualization showing audio input levels in real-time
 * - Position: Bottom of active terminal (not floating)
 * - Shows interim transcription text
 */

class WaveformVisualizer {
  constructor(options = {}) {
    this.barCount = options.barCount || 32;
    this.container = null;
    this.bars = [];
    this.isVisible = false;
    this.targetTerminalIndex = null;
    this.animationFrame = null;
    this.freqLevels = new Float32Array(this.barCount);
    this.displayLevels = new Float32Array(this.barCount);
    this._isProcessing = false;
    this._progressInterval = null;
  }

  _createDOM() {
    this.container = document.createElement('div');
    this.container.className = 'voice-waveform';
    this.container.innerHTML = `
      <div class="voice-waveform__label">VOICE INPUT</div>
      <div class="voice-waveform__bars"></div>
      <div class="voice-waveform__status">Recording...</div>
      <div class="voice-waveform__processing" style="display:none;">
        <div class="voice-waveform__spinner"></div>
        <span class="voice-waveform__processing-text">Processing transcription...</span>
        <div class="voice-waveform__progress-track">
          <div class="voice-waveform__progress-fill"></div>
        </div>
        <span class="voice-waveform__progress-time"></span>
      </div>
    `;

    const barsContainer = this.container.querySelector('.voice-waveform__bars');
    for (let i = 0; i < this.barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-waveform__bar';
      barsContainer.appendChild(bar);
      this.bars.push(bar);
    }

    return this.container;
  }

  show(terminalIndex) {
    if (this.isVisible) {
      this.hide();
    }

    this.targetTerminalIndex = terminalIndex;
    this._isProcessing = false;

    if (!this.container) this._createDOM();
    document.body.appendChild(this.container);

    // Reset to recording view
    this.container.querySelector('.voice-waveform__bars').style.display = '';
    this.container.querySelector('.voice-waveform__status').style.display = '';
    this.container.querySelector('.voice-waveform__processing').style.display = 'none';
    this.container.querySelector('.voice-waveform__status').textContent = 'Recording...';

    this.container.classList.add('voice-waveform--visible');
    this.isVisible = true;
    this._startAnimation();

    console.log('[WaveformVisualizer] Shown at terminal', terminalIndex);
  }

  hide() {
    if (!this.isVisible) return;

    this._stopAnimation();
    this._isProcessing = false;
    if (this._progressInterval) {
      clearInterval(this._progressInterval);
      this._progressInterval = null;
    }

    if (this.container) {
      this.container.classList.remove('voice-waveform--visible');
      setTimeout(() => {
        if (this.container && this.container.parentNode) {
          this.container.parentNode.removeChild(this.container);
        }
      }, 300);
    }

    this.isVisible = false;
    this.targetTerminalIndex = null;
    console.log('[WaveformVisualizer] Hidden');
  }

  updateLevels(freqLevels) {
    if (freqLevels && freqLevels.length) {
      this.freqLevels = freqLevels;
    }
  }

  // Keep old method as fallback
  updateLevel(level) {
    this.freqLevels.fill(level);
  }

  showProcessing(recordingDurationMs) {
    if (!this.container) return;
    this._isProcessing = true;
    this.container.querySelector('.voice-waveform__bars').style.display = 'none';
    this.container.querySelector('.voice-waveform__status').style.display = 'none';
    this.container.querySelector('.voice-waveform__processing').style.display = '';

    // Estimate: processing ~half of recording time, minimum 2s
    const estimatedMs = Math.max(2000, (recordingDurationMs || 5000) * 0.5);
    const fill = this.container.querySelector('.voice-waveform__progress-fill');
    const timeEl = this.container.querySelector('.voice-waveform__progress-time');
    const startTime = Date.now();

    if (this._progressInterval) clearInterval(this._progressInterval);
    this._progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      // Ease out — slows down as it approaches 95%
      const raw = elapsed / estimatedMs;
      const pct = Math.min(95, raw * 100 / (1 + raw * 0.5));
      fill.style.width = `${pct}%`;
      const secsLeft = Math.max(0, Math.ceil((estimatedMs - elapsed) / 1000));
      timeEl.textContent = `~${secsLeft}s remaining`;
    }, 100);
  }

  setStatus(status) {
    if (this.container) {
      const statusEl = this.container.querySelector('.voice-waveform__status');
      if (statusEl) {
        statusEl.textContent = status;
        statusEl.classList.remove('voice-waveform__status--interim');
      }
    }
  }

  showInterim(text) {
    if (this.container) {
      const statusEl = this.container.querySelector('.voice-waveform__status');
      if (statusEl && text) {
        statusEl.textContent = text;
        statusEl.classList.add('voice-waveform__status--interim');
      }
    }
  }

  _startAnimation() {
    const animate = () => {
      if (!this._isProcessing) this._renderBars();
      this.animationFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  _stopAnimation() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  _renderBars() {
    const decay = 0.88;
    for (let i = 0; i < this.barCount; i++) {
      const level = this.freqLevels[i] || 0;
      const jitter = Math.random() * (0.04 + level * 0.1);
      const target = Math.max(0.03, Math.min(1, level * 5 + jitter));

      this.displayLevels[i] = target >= this.displayLevels[i]
        ? target
        : Math.max(target, this.displayLevels[i] * decay);

      const h = this.displayLevels[i];
      this.bars[i].style.height = `${h * 100}%`;

      const alpha = 0.4 + h * 0.6;
      this.bars[i].style.backgroundColor = `rgba(var(--color_r), var(--color_g), var(--color_b), ${alpha})`;
    }
  }

  release() {
    this.hide();
    this.container = null;
    this.bars = [];
    console.log('[WaveformVisualizer] Released');
  }
}

module.exports = { WaveformVisualizer };
