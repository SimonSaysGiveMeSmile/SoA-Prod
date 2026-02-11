/**
 * CreditDisplay - Shows earned credits like game currency in the corner
 *
 * Displays a real-time credit counter that increases while watching ads.
 * Different ad types give different credit amounts.
 * Credits persist in localStorage across sessions.
 */
class CreditDisplay {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);
        this.credits = this._loadCredits();
        this._displayedCredits = this.credits;
        this._animationFrame = null;

        // Use createElement + appendChild to avoid destroying existing widgets (innerHTML += kills DOM refs)
        const wrapper = document.createElement('div');
        wrapper.id = 'mod_creditDisplay';
        // Force visible — the column's staggered fade-in animation has already run by now
        wrapper.style.animationPlayState = 'running';
        wrapper.innerHTML = `
            <div id="mod_creditDisplay_innercontainer">
                <h1>CREDITS</h1>
                <div id="mod_creditDisplay_content">
                    <div class="credit-counter">
                        <span class="credit-icon">◆</span>
                        <span class="credit-amount">${this._formatCredits(this.credits)}</span>
                    </div>
                    <div class="credit-rate"></div>
                    <div class="credit-history"></div>
                    <div class="credit-watch-btn" id="credit_watchAdBtn">▶ WATCH AD</div>
                </div>
            </div>`;
        this.parent.appendChild(wrapper);

        // Store DOM references
        this.containerEl = document.getElementById('mod_creditDisplay');
        this.amountEl = this.containerEl.querySelector('.credit-amount');
        this.rateEl = this.containerEl.querySelector('.credit-rate');
        this.historyEl = this.containerEl.querySelector('.credit-history');
        this.watchBtn = document.getElementById('credit_watchAdBtn');

        // Watch Ad button — manual ad toggle
        this.watchBtn.addEventListener('click', () => {
            if (window.adOverlay) {
                window.adOverlay.manualToggle();
            }
        });

        // Update button label when ad state changes
        this._onAdToggled = (e) => {
            const { active } = e.detail;
            this.watchBtn.textContent = active ? '■ STOP AD' : '▶ WATCH AD';
            this.watchBtn.classList.toggle('credit-watch-btn--active', active);
        };
        window.addEventListener('ad-manual-toggled', this._onAdToggled);

        // Also update button when thinking-driven ads show/hide
        this._onThinkingChanged = this._onThinkingChanged.bind(this);
        window.addEventListener('thinking-state-changed', this._onThinkingChanged);

        // Track earning sessions
        this._earningSessions = [];
        this._isEarning = false;
        this._currentRate = 0;
    }

    /**
     * Add credits (called by AdOverlay during ad display)
     * @param {number} amount - Credits to add
     * @param {string} source - Source type ('fullscreen' or 'corner')
     */
    addCredits(amount, source) {
        this.credits += amount;
        this._saveCredits();

        // Log earning event
        this._earningSessions.push({
            amount,
            source,
            timestamp: Date.now()
        });

        // Keep only last 10 events
        if (this._earningSessions.length > 10) {
            this._earningSessions.shift();
        }

        // Animate the counter
        this._animateCounter();
        this._updateRate(amount, source);
        this._updateHistory();
    }

    /**
     * Smoothly animate the credit counter to the new value
     */
    _animateCounter() {
        if (this._animationFrame) cancelAnimationFrame(this._animationFrame);

        const target = this.credits;
        const start = this._displayedCredits;
        const startTime = performance.now();
        const duration = 300;

        const animate = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out
            const eased = 1 - Math.pow(1 - progress, 3);
            this._displayedCredits = Math.round(start + (target - start) * eased);
            this.amountEl.textContent = this._formatCredits(this._displayedCredits);

            // Add pulse class during animation
            if (progress < 1) {
                this.amountEl.classList.add('credit-amount--earning');
                this._animationFrame = requestAnimationFrame(animate);
            } else {
                this._displayedCredits = target;
                this.amountEl.textContent = this._formatCredits(target);
                this.amountEl.classList.remove('credit-amount--earning');
            }
        };

        this._animationFrame = requestAnimationFrame(animate);
    }

    /**
     * Update the earning rate display
     * @param {number} rate - Credits per tick
     * @param {string} source - Ad type
     */
    _updateRate(rate, source) {
        this._currentRate = rate;
        this._isEarning = true;
        const label = source === 'fullscreen' ? 'FULL AD' : 'CORNER AD';
        this.rateEl.textContent = `+${rate}/sec · ${label}`;
        this.rateEl.classList.add('credit-rate--active');
    }

    /**
     * Update the earning history display
     */
    _updateHistory() {
        const recent = this._earningSessions.slice(-3);
        if (recent.length === 0) {
            this.historyEl.textContent = '';
            return;
        }

        const totalEarned = this._earningSessions.reduce((sum, s) => sum + s.amount, 0);
        this.historyEl.textContent = `SESSION: +${totalEarned}`;
    }

    /**
     * Handle thinking state changes
     * @param {CustomEvent} event
     */
    _onThinkingChanged(event) {
        const { isThinking } = event.detail;
        if (!isThinking && this._isEarning) {
            this._isEarning = false;
            this._currentRate = 0;
            this.rateEl.textContent = '';
            this.rateEl.classList.remove('credit-rate--active');
        }
        // Sync button label with ad visibility
        if (window.adOverlay) {
            const adVisible = window.adOverlay._visible;
            this.watchBtn.textContent = adVisible ? '■ STOP AD' : '▶ WATCH AD';
            this.watchBtn.classList.toggle('credit-watch-btn--active', adVisible);
        }
    }

    /**
     * Format credits for display (e.g., 1,234)
     * @param {number} amount
     * @returns {string}
     */
    _formatCredits(amount) {
        return amount.toLocaleString();
    }

    /**
     * Load credits from localStorage
     * @returns {number}
     */
    _loadCredits() {
        try {
            const stored = localStorage.getItem('soa_credits');
            return stored ? parseInt(stored, 10) || 0 : 0;
        } catch (e) {
            return 0;
        }
    }

    /**
     * Save credits to localStorage
     */
    _saveCredits() {
        try {
            localStorage.setItem('soa_credits', this.credits.toString());
        } catch (e) {
            // localStorage unavailable
        }
    }

    /**
     * Get current credit balance
     * @returns {number}
     */
    getCredits() {
        return this.credits;
    }

    /**
     * Clean up
     */
    destroy() {
        window.removeEventListener('thinking-state-changed', this._onThinkingChanged);
        window.removeEventListener('ad-manual-toggled', this._onAdToggled);
        if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CreditDisplay };
}
