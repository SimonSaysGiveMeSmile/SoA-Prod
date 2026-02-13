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
    this.levels = new Array(this.barCount).fill(0);
    this.levelIndex = 0;
    this.displayLevels = new Array(this.barCount).fill(0); // sustain buffer
  }

  _createDOM() {
    this.container = document.createElement('div');
    this.container.className = 'voice-waveform';
    this.container.innerHTML = `
      <div class="voice-waveform__label">VOICE INPUT</div>
      <div class="voice-waveform__bars"></div>
      <div class="voice-waveform__status">Recording...</div>
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

    const terminalSelector = `#terminal${terminalIndex}`;
    const terminalEl = document.querySelector(terminalSelector);

    if (!terminalEl) {
      const termWrapper = document.querySelector('#main_shell_innercontainer') ||
                          document.querySelector('#main_shell');
      if (termWrapper) {
        if (!this.container) this._createDOM();
        termWrapper.appendChild(this.container);
      } else {
        console.warn('[WaveformVisualizer] Cannot find terminal container');
        return;
      }
    } else {
      if (!this.container) this._createDOM();
      terminalEl.appendChild(this.container);
    }

    this.container.classList.add('voice-waveform--visible');
    this.isVisible = true;
    this._startAnimation();

    console.log('[WaveformVisualizer] Shown at terminal', terminalIndex);
  }

  hide() {
    if (!this.isVisible) return;

    this._stopAnimation();

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

  updateLevel(level) {
    this.levels[this.levelIndex] = level;
    this.levelIndex = (this.levelIndex + 1) % this.barCount;
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

  /**
   * Show interim transcription text - KEY LINK for Web Speech API
   * @param {string} text - Interim transcription from Web Speech API
   */
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
      this._renderBars();
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
    const decay = 0.92; // sustain factor — bars decay slowly
    for (let i = 0; i < this.barCount; i++) {
      const levelIdx = (this.levelIndex + i) % this.barCount;
      const level = this.levels[levelIdx];
      const jitter = Math.random() * 0.1;
      const target = Math.max(0.05, Math.min(1, level + jitter));

      // Sustain: only decay slowly, jump up instantly
      this.displayLevels[i] = target >= this.displayLevels[i]
        ? target
        : Math.max(target, this.displayLevels[i] * decay);

      const h = this.displayLevels[i];
      this.bars[i].style.height = `${h * 100}%`;

      const intensity = Math.floor(200 + h * 55);
      this.bars[i].style.backgroundColor = `rgb(${intensity}, ${intensity}, ${intensity})`;
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
