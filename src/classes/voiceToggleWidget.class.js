/**
 * Voice Toggle Widget
 * Button on right side of screen to enable/disable voice listening
 *
 * Context decisions implemented:
 * - UI button on RIGHT SIDE of screen (not settings)
 * - Toggle enables/disables voice listening
 */

class VoiceToggleWidget {
  constructor(voiceController) {
    this.voiceController = voiceController;
    this.element = null;
    this.isEnabled = false;
  }

  create(container) {
    this.element = document.createElement('div');
    this.element.id = 'mod_voiceToggle';
    this.element.className = 'voice-toggle';
    this.element.innerHTML = `
      <div class="voice-toggle__inner">
        <div class="voice-toggle__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </div>
        <div class="voice-toggle__label">VOICE</div>
        <div class="voice-toggle__status">OFF</div>
      </div>
    `;

    this.element.addEventListener('click', () => this._handleClick());

    if (container) {
      container.appendChild(this.element);
    }

    this._updateVisualState();
    console.log('[VoiceToggle] Widget created');
    return this.element;
  }

  async _handleClick() {
    if (!this.voiceController) {
      console.warn('[VoiceToggle] No voice controller');
      return;
    }

    const newState = await this.voiceController.toggle();
    this.isEnabled = newState;
    this._updateVisualState();

    console.log('[VoiceToggle] Toggled to:', newState ? 'ON' : 'OFF');
  }

  _updateVisualState() {
    if (!this.element) return;

    const statusEl = this.element.querySelector('.voice-toggle__status');

    if (this.isEnabled) {
      this.element.classList.add('voice-toggle--active');
      this.element.classList.remove('voice-toggle--inactive');
      if (statusEl) statusEl.textContent = 'ON';
    } else {
      this.element.classList.remove('voice-toggle--active');
      this.element.classList.add('voice-toggle--inactive');
      if (statusEl) statusEl.textContent = 'OFF';
    }
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    this._updateVisualState();
  }

  showRecording() {
    if (this.element) {
      this.element.classList.add('voice-toggle--recording');
      const statusEl = this.element.querySelector('.voice-toggle__status');
      if (statusEl) statusEl.textContent = 'REC';
    }
  }

  showProcessing() {
    if (this.element) {
      this.element.classList.remove('voice-toggle--recording');
      this.element.classList.add('voice-toggle--processing');
      const statusEl = this.element.querySelector('.voice-toggle__status');
      if (statusEl) statusEl.textContent = '...';
    }
  }

  resetState() {
    if (this.element) {
      this.element.classList.remove('voice-toggle--recording', 'voice-toggle--processing');
      this._updateVisualState();
    }
  }

  showUnavailable() {
    if (this.element) {
      this.element.classList.add('voice-toggle--unavailable');
      const statusEl = this.element.querySelector('.voice-toggle__status');
      if (statusEl) statusEl.textContent = 'N/A';
    }
  }

  release() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    console.log('[VoiceToggle] Released');
  }
}

module.exports = { VoiceToggleWidget };
