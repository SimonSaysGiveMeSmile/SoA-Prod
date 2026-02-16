/**
 * AdOverlay - Displays ads during AI thinking time
 *
 * Three display modes:
 *   - 'fullscreen': Covers upper half of terminal area (side panels and bottom remain visible), higher credits
 *   - 'corner': Small overlay in bottom-right corner, fewer credits
 *   - 'panel': Lives in a side column, only visible on mouse hover
 *
 * All modes include a close/dismiss button.
 * Listens to 'thinking-state-changed' events from ThinkingDetector.
 */
class AdOverlay {
    constructor(opts = {}) {
        this.enabled = opts.enabled !== false;
        this.mode = localStorage.getItem('soa_ad_mode') || opts.mode || null; // null = needs picker
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
        this._modePickerEl = null;
        this._visible = false;
        this._dismissed = false;
        this._activeTerminal = null;

        this._creditRates = { fullscreen: 5, corner: 2, panel: 3 };
        this._creditInterval = null;
        this._manualMode = false;  // True when user manually triggered the ad
        this._userDismissed = false;  // True when user explicitly dismissed via button/close

        // Drag state for corner mode
        this._isDragging = false;
        this._dragOffsetX = 0;
        this._dragOffsetY = 0;
        this._onDragStart = this._onDragStart.bind(this);
        this._onDragMove = this._onDragMove.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);
        this._onResize = this._onResize.bind(this);

        this._onThinkingChanged = this._onThinkingChanged.bind(this);
        this._onCloseClick = this._onCloseClick.bind(this);
    }

    init() {
        // Always create DOM elements so manualToggle can enable and show later
        // Reference the terminal container for positioning context
        this._containerEl = document.getElementById('main_shell_innercontainer');

        // Overlay element — appended to body so it's never clipped by overflow:hidden
        this._overlayEl = document.createElement('div');
        this._overlayEl.id = 'ad_overlay';
        this._overlayEl.className = 'ad-overlay ad-overlay--hidden';
        this._overlayEl.innerHTML = this._buildOverlayHTML();
        document.body.appendChild(this._overlayEl);

        // Mode picker overlay — also on body for top-level stacking
        this._modePickerEl = document.createElement('div');
        this._modePickerEl.id = 'ad_mode_picker';
        this._modePickerEl.className = 'ad-mode-picker ad-mode-picker--hidden';
        this._modePickerEl.innerHTML = this._buildModePickerHTML();
        document.body.appendChild(this._modePickerEl);

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
        window.addEventListener('resize', this._onResize);
    }

    // ── HTML builders ──

    _buildOverlayHTML() {
        const label = this.mode === 'fullscreen' ? 'FULL SCREEN AD' : 'SPONSORED';
        const rate = this._creditRates[this.mode] || 2;
        return `
            <div class="ad-overlay__content">
                <div class="ad-overlay__close" title="Close ad">✕</div>
                <div class="ad-overlay__change-mode" title="Change ad mode">⚙</div>
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

    // ── Mode Picker ──

    _buildModePickerHTML() {
        return `
            <div class="ad-mode-picker__backdrop">
                <div class="ad-mode-picker__container">
                    <div class="ad-mode-picker__title">CHOOSE AD DISPLAY MODE</div>
                    <div class="ad-mode-picker__subtitle">Earn credits while AI thinks</div>
                    <div class="ad-mode-picker__cards">
                        <div class="ad-mode-picker__card" data-mode="fullscreen">
                            <div class="ad-mode-picker__card-icon">⬜</div>
                            <div class="ad-mode-picker__card-name">FULLSCREEN</div>
                            <div class="ad-mode-picker__card-desc">Covers upper half of terminal area</div>
                            <div class="ad-mode-picker__card-rate">+5 credits/sec</div>
                        </div>
                        <div class="ad-mode-picker__card" data-mode="corner">
                            <div class="ad-mode-picker__card-icon">◳</div>
                            <div class="ad-mode-picker__card-name">CORNER</div>
                            <div class="ad-mode-picker__card-desc">Small draggable overlay in the corner</div>
                            <div class="ad-mode-picker__card-rate">+2 credits/sec</div>
                        </div>
                        <div class="ad-mode-picker__card" data-mode="panel">
                            <div class="ad-mode-picker__card-icon">▐</div>
                            <div class="ad-mode-picker__card-name">PANEL</div>
                            <div class="ad-mode-picker__card-desc">Side panel, visible on hover</div>
                            <div class="ad-mode-picker__card-rate">+3 credits/sec</div>
                        </div>
                    </div>
                </div>
            </div>`;
    }

    _showModePicker(terminalIndex) {
        if (!this._modePickerEl) return;
        this._modePickerEl.className = 'ad-mode-picker ad-mode-picker--visible';
        // Bind card clicks
        const cards = this._modePickerEl.querySelectorAll('.ad-mode-picker__card');
        cards.forEach(card => {
            card.onclick = () => {
                const mode = card.dataset.mode;
                this._selectMode(mode, terminalIndex);
            };
        });
    }

    _hideModePicker() {
        if (!this._modePickerEl) return;
        this._modePickerEl.className = 'ad-mode-picker ad-mode-picker--hidden';
    }

    _selectMode(mode, terminalIndex) {
        this.mode = mode;
        localStorage.setItem('soa_ad_mode', mode);
        this._hideModePicker();
        // Now show the actual ad
        this._dismissed = false;
        this._userDismissed = false;
        this.show(terminalIndex);
    }

    _onChangeModeClick(e) {
        e.stopPropagation();
        const savedTerminal = this._activeTerminal;
        this.hide();
        this._dismissed = false;
        this._userDismissed = false;
        this.mode = null;
        localStorage.removeItem('soa_ad_mode');
        this._showModePicker(savedTerminal);
    }

    // ── Drag support (corner mode) ──

    _initDrag() {
        if (!this._overlayEl) return;
        const content = this._overlayEl.querySelector('.ad-overlay__content');
        if (content) {
            content.addEventListener('mousedown', this._onDragStart);
            this._overlayEl.classList.add('ad-overlay--draggable');
        }
        // Restore saved position, clamped to current viewport
        const saved = localStorage.getItem('soa_ad_position');
        if (saved) {
            try {
                const pos = JSON.parse(saved);
                const rect = this._overlayEl.getBoundingClientRect();
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const clampedLeft = Math.max(0, Math.min(pos.left, vw - rect.width));
                const clampedTop = Math.max(0, Math.min(pos.top, vh - rect.height));
                this._overlayEl.style.position = 'fixed';
                this._overlayEl.style.top = clampedTop + 'px';
                this._overlayEl.style.left = clampedLeft + 'px';
                this._overlayEl.style.bottom = 'auto';
                this._overlayEl.style.right = 'auto';
            } catch (_) { /* ignore bad data */ }
        }
    }

    _onDragStart(e) {
        // Don't drag when clicking close or change-mode buttons
        if (e.target.closest('.ad-overlay__close') || e.target.closest('.ad-overlay__change-mode')) return;
        this._isDragging = true;
        const rect = this._overlayEl.getBoundingClientRect();
        this._dragOffsetX = e.clientX - rect.left;
        this._dragOffsetY = e.clientY - rect.top;
        // Switch to fixed positioning for free movement
        this._overlayEl.style.position = 'fixed';
        this._overlayEl.style.top = rect.top + 'px';
        this._overlayEl.style.left = rect.left + 'px';
        this._overlayEl.style.bottom = 'auto';
        this._overlayEl.style.right = 'auto';
        this._overlayEl.classList.add('ad-overlay--dragging');
        document.addEventListener('mousemove', this._onDragMove);
        document.addEventListener('mouseup', this._onDragEnd);
        e.preventDefault();
    }

    _onDragMove(e) {
        if (!this._isDragging) return;
        const rect = this._overlayEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let x = e.clientX - this._dragOffsetX;
        let y = e.clientY - this._dragOffsetY;
        // Clamp to viewport boundaries
        x = Math.max(0, Math.min(x, vw - rect.width));
        y = Math.max(0, Math.min(y, vh - rect.height));
        this._overlayEl.style.left = x + 'px';
        this._overlayEl.style.top = y + 'px';
    }

    _onDragEnd() {
        if (!this._isDragging) return;
        this._isDragging = false;
        this._overlayEl.classList.remove('ad-overlay--dragging');
        document.removeEventListener('mousemove', this._onDragMove);
        document.removeEventListener('mouseup', this._onDragEnd);
        // Save position
        const rect = this._overlayEl.getBoundingClientRect();
        localStorage.setItem('soa_ad_position', JSON.stringify({
            top: rect.top, left: rect.left
        }));
    }

    _onResize() {
        if (!this._visible || !this._overlayEl) return;
        // Re-clamp overlay position to new viewport bounds
        if (this._overlayEl.style.position === 'fixed' && this.mode === 'corner') {
            const rect = this._overlayEl.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const clampedLeft = Math.max(0, Math.min(rect.left, vw - rect.width));
            const clampedTop = Math.max(0, Math.min(rect.top, vh - rect.height));
            if (clampedLeft !== rect.left || clampedTop !== rect.top) {
                this._overlayEl.style.left = clampedLeft + 'px';
                this._overlayEl.style.top = clampedTop + 'px';
            }
        }
    }

    _cleanupDrag() {
        if (!this._overlayEl) return;
        const content = this._overlayEl.querySelector('.ad-overlay__content');
        if (content) {
            content.removeEventListener('mousedown', this._onDragStart);
        }
        document.removeEventListener('mousemove', this._onDragMove);
        document.removeEventListener('mouseup', this._onDragEnd);
        this._isDragging = false;
        this._overlayEl.classList.remove('ad-overlay--draggable', 'ad-overlay--dragging');
        // Reset inline position styles
        this._overlayEl.style.position = '';
        this._overlayEl.style.top = '';
        this._overlayEl.style.left = '';
        this._overlayEl.style.bottom = '';
        this._overlayEl.style.right = '';
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
            if (!this._dismissed && !this._userDismissed) {
                if (!this.mode) {
                    // No mode chosen yet — show picker instead of ad
                    this._showModePicker(terminalIndex);
                } else {
                    this.show(terminalIndex);
                }
            }
        } else {
            this._dismissed = false;
            this._userDismissed = false;
            this._hideModePicker();
            if (!this._manualMode) {
                this.hide();
            }
        }
    }

    _onCloseClick(e) {
        e.stopPropagation();
        this._dismissed = true;
        this._userDismissed = true;
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
            // User wants to stop the ad — dismiss it so thinking detector won't re-show
            this._manualMode = false;
            this._dismissed = true;
            this._userDismissed = true;
            this.hide();
            window.dispatchEvent(new CustomEvent('ad-manual-toggled', { detail: { active: false } }));
            return false;
        } else {
            // User wants to watch an ad
            this._manualMode = true;
            this._dismissed = false;
            this._userDismissed = false;
            this.enabled = true;
            const termIdx = typeof window.currentTerm !== 'undefined' ? window.currentTerm : 0;
            this.show(termIdx);
            window.dispatchEvent(new CustomEvent('ad-manual-toggled', { detail: { active: true } }));
            return true;
        }
    }

    // ── Show / Hide ──

    show(terminalIndex) {
        if (this._visible || this._dismissed || this._userDismissed) return;
        if (!this.mode) {
            this._showModePicker(terminalIndex);
            return;
        }
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
     * Force-hide the ad and reset all state flags.
     * Used when the ad needs to be completely reset (e.g., terminal switch).
     */
    forceHide() {
        this._dismissed = false;
        this._userDismissed = false;
        this._manualMode = false;
        this.hide();
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
        const changeBtn = this._overlayEl.querySelector('.ad-overlay__change-mode');
        if (changeBtn) changeBtn.addEventListener('click', (e) => this._onChangeModeClick(e));
        // Init drag for corner mode
        if (this.mode === 'corner') this._initDrag();
    }

    _hideOverlay() {
        if (!this._overlayEl) return;
        this._cleanupDrag();
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
        localStorage.setItem('soa_ad_mode', mode);
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
        this._cleanupDrag();
        window.removeEventListener('thinking-state-changed', this._onThinkingChanged);
        window.removeEventListener('resize', this._onResize);
        if (this._overlayEl && this._overlayEl.parentNode) {
            this._overlayEl.parentNode.removeChild(this._overlayEl);
        }
        if (this._panelEl && this._panelEl.parentNode) {
            this._panelEl.parentNode.removeChild(this._panelEl);
        }
        if (this._modePickerEl && this._modePickerEl.parentNode) {
            this._modePickerEl.parentNode.removeChild(this._modePickerEl);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AdOverlay };
}
