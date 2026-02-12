/**
 * AdOverlay - Displays ads during AI thinking time
 *
 * Three display modes:
 *   - 'fullscreen': Covers upper portion of terminal (leaves bottom visible), higher credits
 *   - 'corner': Small overlay in bottom-right corner, fewer credits
 *   - 'panel': Lives in a side column, only visible on mouse hover
 *
 * All modes include a close/dismiss button.
 * Listens to 'thinking-state-changed' events from ThinkingDetector.
 */
class AdOverlay {
    constructor(opts = {}) {
        this.enabled = opts.enabled !== false;
        this.mode = opts.mode || 'corner';
        this.placeholderUrl = opts.placeholderUrl || null;
        this.creditSystem = opts.creditSystem || null;
        this.panelParentId = opts.panelParentId || 'mod_column_right';

        // Image rotation support
        this._imageUrls = opts.imageUrls || [];   // Array of image paths to cycle through
        this._imageIndex = 0;
        this._imageRotateMs = opts.imageRotateMs || 8000;  // Rotate every 8 seconds
        this._imageRotateTimer = null;

        this._overlayEl = null;
        this._panelEl = null;
        this._containerEl = null;
        this._visible = false;
        this._dismissed = false;
        this._activeTerminal = null;

        this._creditRates = { fullscreen: 5, corner: 2, panel: 3 };
        this._creditInterval = null;
        this._manualMode = false;  // True when user manually triggered the ad

        this._onThinkingChanged = this._onThinkingChanged.bind(this);
        this._onCloseClick = this._onCloseClick.bind(this);
    }

    init() {
        // Always create DOM elements so manualToggle can enable and show later
        // Overlay element (fullscreen + corner modes)
        this._containerEl = document.getElementById('main_shell_innercontainer');
        if (this._containerEl) {
            this._containerEl.style.position = 'relative';
            this._overlayEl = document.createElement('div');
            this._overlayEl.id = 'ad_overlay';
            this._overlayEl.className = 'ad-overlay ad-overlay--hidden';
            this._overlayEl.innerHTML = this._buildOverlayHTML();
            this._containerEl.appendChild(this._overlayEl);
        }

        // Panel element (panel mode — lives in side column)
        const panelParent = document.getElementById(this.panelParentId);
        if (panelParent) {
            this._panelEl = document.createElement('div');
            this._panelEl.id = 'ad_panel';
            this._panelEl.className = 'ad-panel';
            // Force visible — column's staggered fade-in has already run
            this._panelEl.style.animationPlayState = 'running';
            this._panelEl.innerHTML = this._buildPanelHTML();
            panelParent.appendChild(this._panelEl);
        }

        window.addEventListener('thinking-state-changed', this._onThinkingChanged);
    }

    // ── HTML builders ──

    _buildOverlayHTML() {
        const label = this.mode === 'fullscreen' ? 'FULL SCREEN AD' : 'SPONSORED';
        const rate = this._creditRates[this.mode] || 2;
        return `
            <div class="ad-overlay__content">
                <div class="ad-overlay__close" title="Close ad">✕</div>
                <div class="ad-overlay__badge">${label}</div>
                <div class="ad-overlay__image-container">
                    ${this._imgHTML('ad-overlay')}
                </div>
                <div class="ad-overlay__info">
                    <span class="ad-overlay__earning">+${rate} credits/sec</span>
                    <span class="ad-overlay__status">AI IS THINKING...</span>
                </div>
            </div>`;
    }

    _buildPanelHTML() {
        const rate = this._creditRates.panel;
        return `
            <div class="ad-panel__inner">
                <div class="ad-panel__badge">SPONSORED</div>
                <div class="ad-panel__image-container">
                    ${this._imgHTML('ad-panel')}
                </div>
                <div class="ad-panel__info">
                    <span class="ad-panel__earning">+${rate} credits/sec</span>
                    <span class="ad-panel__status">EARNING...</span>
                </div>
                <div class="ad-panel__hover-hint">HOVER TO VIEW</div>
            </div>`;
    }

    _imgHTML(prefix) {
        const url = this._getCurrentImageUrl();
        if (url) {
            return `<img class="${prefix}__image" src="${url}" alt="Ad" />`;
        }
        return `<div class="${prefix}__placeholder">
                    <span class="${prefix}__placeholder-icon">🐱</span>
                    <span class="${prefix}__placeholder-text">AD SPACE</span>
                </div>`;
    }

    /**
     * Get the current image URL from rotation list or single placeholder
     * @returns {string|null}
     */
    _getCurrentImageUrl() {
        if (this._imageUrls.length > 0) {
            return this._imageUrls[this._imageIndex % this._imageUrls.length];
        }
        return this.placeholderUrl || null;
    }

    /**
     * Start rotating through images while overlay is visible
     */
    _startImageRotation() {
        this._stopImageRotation();
        if (this._imageUrls.length <= 1) return;
        this._imageRotateTimer = setInterval(() => {
            this._imageIndex = (this._imageIndex + 1) % this._imageUrls.length;
            this._updateImage();
        }, this._imageRotateMs);
    }

    _stopImageRotation() {
        if (this._imageRotateTimer) {
            clearInterval(this._imageRotateTimer);
            this._imageRotateTimer = null;
        }
    }

    /**
     * Update just the image element with a crossfade transition
     */
    _updateImage() {
        const url = this._getCurrentImageUrl();
        if (!url) return;
        const targets = [
            this._overlayEl && this._overlayEl.querySelector('.ad-overlay__image'),
            this._panelEl && this._panelEl.querySelector('.ad-panel__image')
        ];
        targets.forEach(img => {
            if (!img) return;
            img.style.opacity = '0';
            setTimeout(() => {
                img.src = url;
                img.onload = () => { img.style.opacity = '1'; };
            }, 300);
        });
    }

    /**
     * Load images from a directory (call from renderer with fs.readdirSync results)
     * @param {string[]} urls - Array of image file paths/URLs
     */
    setImageUrls(urls) {
        this._imageUrls = urls;
        this._imageIndex = 0;
    }

    // ── Events ──

    _onThinkingChanged(event) {
        if (!this.enabled) return;
        const { terminalIndex, isThinking } = event.detail;
        const active = typeof window.currentTerm !== 'undefined' ? window.currentTerm : 0;
        if (terminalIndex !== active) return;

        if (isThinking) {
            // Don't reset _dismissed here — respect user's dismiss for this thinking session.
            // _dismissed is only reset when thinking fully ENDS, so the next fresh session can show.
            if (!this._dismissed) {
                this.show(terminalIndex);
            }
        } else {
            // Thinking ended completely — reset dismissed for the next thinking session
            this._dismissed = false;
            if (!this._manualMode) {
                // Only auto-hide if user didn't manually trigger the ad
                this.hide();
            }
        }
    }

    _onCloseClick(e) {
        e.stopPropagation();
        this._dismissed = true;
        this._manualMode = false;
        this.hide();
    }

    // ── Manual toggle ──

    /**
     * User-initiated ad toggle. Shows ad if hidden, hides if visible.
     * Manual ads stay visible even when thinking ends.
     * @returns {boolean} Whether the ad is now visible
     */
    manualToggle() {
        if (this._visible) {
            this._manualMode = false;
            this._dismissed = false;
            this.hide();
            window.dispatchEvent(new CustomEvent('ad-manual-toggled', { detail: { active: false } }));
            return false;
        } else {
            this._manualMode = true;
            this._dismissed = false;
            this.enabled = true;
            const termIdx = typeof window.currentTerm !== 'undefined' ? window.currentTerm : 0;
            this.show(termIdx);
            window.dispatchEvent(new CustomEvent('ad-manual-toggled', { detail: { active: true } }));
            return true;
        }
    }

    // ── Show / Hide ──

    show(terminalIndex) {
        if (this._visible || this._dismissed) return;
        this._visible = true;
        this._activeTerminal = terminalIndex;

        if (this.mode === 'panel') {
            this._showPanel();
        } else {
            this._showOverlay();
        }
        this._startCredits();
        this._startImageRotation();
        this._dispatchVisibilityEvent(true);
    }

    hide() {
        if (!this._visible) return;
        this._visible = false;
        this._manualMode = false;
        this._activeTerminal = null;
        this._hideOverlay();
        this._hidePanel();
        this._stopCredits();
        this._stopImageRotation();
        this._dispatchVisibilityEvent(false);
    }

    /**
     * Notify other components (CreditDisplay) when ad visibility changes
     * @param {boolean} visible
     */
    _dispatchVisibilityEvent(visible) {
        window.dispatchEvent(new CustomEvent('ad-visibility-changed', {
            detail: { visible, mode: this.mode }
        }));
    }

    _showOverlay() {
        if (!this._overlayEl) return;
        this._overlayEl.innerHTML = this._buildOverlayHTML();
        this._overlayEl.className = `ad-overlay ad-overlay--${this.mode}`;
        const btn = this._overlayEl.querySelector('.ad-overlay__close');
        if (btn) btn.addEventListener('click', this._onCloseClick);
    }

    _hideOverlay() {
        if (!this._overlayEl) return;
        this._overlayEl.className = 'ad-overlay ad-overlay--hidden';
        const btn = this._overlayEl.querySelector('.ad-overlay__close');
        if (btn) btn.removeEventListener('click', this._onCloseClick);
    }

    _showPanel() {
        if (!this._panelEl) return;
        this._panelEl.innerHTML = this._buildPanelHTML();
        this._panelEl.className = 'ad-panel ad-panel--active';
    }

    _hidePanel() {
        if (!this._panelEl) return;
        this._panelEl.className = 'ad-panel';
    }

    // ── Credits ──

    _startCredits() {
        this._stopCredits();
        const rate = this._creditRates[this.mode] || 2;
        // Notify credit display that earning has started
        if (this.creditSystem && this.creditSystem.startEarning) {
            this.creditSystem.startEarning(rate, this.mode);
        }
        this._creditInterval = setInterval(() => {
            if (this.creditSystem) this.creditSystem.addCredits(rate, this.mode);
        }, 1000);
    }

    _stopCredits() {
        if (this._creditInterval) {
            clearInterval(this._creditInterval);
            this._creditInterval = null;
        }
        // Notify credit display that earning has stopped
        if (this.creditSystem && this.creditSystem.stopEarning) {
            this.creditSystem.stopEarning();
        }
    }

    // ── Config ──

    setMode(mode) {
        if (!['fullscreen', 'corner', 'panel'].includes(mode)) return;
        const wasVisible = this._visible;
        const savedTerminal = this._activeTerminal;
        if (wasVisible) this.hide();
        this.mode = mode;
        if (wasVisible) {
            this._dismissed = false;
            this.show(savedTerminal);
        }
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) this.hide();
    }

    configure(opts) {
        if (typeof opts.enabled === 'boolean') this.setEnabled(opts.enabled);
        if (opts.mode) this.setMode(opts.mode);
        if (opts.placeholderUrl) this.placeholderUrl = opts.placeholderUrl;
    }

    destroy() {
        this.hide();
        this._stopImageRotation();
        window.removeEventListener('thinking-state-changed', this._onThinkingChanged);
        if (this._overlayEl && this._overlayEl.parentNode) {
            this._overlayEl.parentNode.removeChild(this._overlayEl);
        }
        if (this._panelEl && this._panelEl.parentNode) {
            this._panelEl.parentNode.removeChild(this._panelEl);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AdOverlay };
}
