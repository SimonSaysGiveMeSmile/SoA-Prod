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
        // Insert at top of panel (after h3 title, before other widgets)
        const firstWidget = this.parent.querySelector(':scope > div');
        if (firstWidget) {
            this.parent.insertBefore(wrapper, firstWidget);
        } else {
            this.parent.appendChild(wrapper);
        }

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

        // Update button label when ad visibility changes (covers both manual and thinking-driven)
        this._onAdVisibilityChanged = (e) => {
            const { visible } = e.detail;
            // Re-query button in case DOM was rebuilt
            const btn = this.watchBtn && document.contains(this.watchBtn)
                ? this.watchBtn
                : document.getElementById('credit_watchAdBtn');
            if (btn) {
                btn.textContent = visible ? '■ STOP AD' : '▶ WATCH AD';
                btn.classList.toggle('credit-watch-btn--active', visible);
                this.watchBtn = btn;
            }
        };
        window.addEventListener('ad-visibility-changed', this._onAdVisibilityChanged);

        // Track earning sessions
        this._earningSessions = [];
        this._isEarning = false;
        this._currentRate = 0;
    }

    /**
     * Add credits (called by AdOverlay every second during ad display)
     * @param {number} amount - Credits to add
     * @param {string} source - Source type ('fullscreen', 'corner', or 'panel')
     */
    addCredits(amount, source) {
        // Reconnect DOM if elements were detached (e.g., by widget loader rebuild)
        if (!this.amountEl || !document.contains(this.amountEl)) {
            this._reconnectDOM();
        }

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

        // Animate the counter and update history (rate display managed by startEarning/stopEarning)
        this._animateCounter();
        this._updateHistory();
    }

    /**
     * Called by AdOverlay when credits start accruing (ad shown)
     * @param {number} rate - Credits per second
     * @param {string} source - Ad mode ('fullscreen', 'corner', 'panel')
     */
    startEarning(rate, source) {
        // Reconnect DOM if elements were detached
        if (!this.rateEl || !document.contains(this.rateEl)) {
            this._reconnectDOM();
        }
        this._isEarning = true;
        this._currentRate = rate;
        this._updateRate(rate, source);
    }

    /**
     * Called by AdOverlay when credits stop accruing (ad hidden)
     */
    stopEarning() {
        this._isEarning = false;
        this._currentRate = 0;
        if (this.rateEl && document.contains(this.rateEl)) {
            this.rateEl.textContent = '';
            this.rateEl.classList.remove('credit-rate--active');
        }
    }

    /**
     * Re-create DOM elements if they were detached (e.g., by widget loader rebuild)
     */
    _reconnectDOM() {
        // Check if our wrapper is still in the document
        let wrapper = document.getElementById('mod_creditDisplay');
        if (!wrapper || !document.contains(wrapper)) {
            // Re-create the wrapper
            wrapper = document.createElement('div');
            wrapper.id = 'mod_creditDisplay';
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
            if (this.parent && document.contains(this.parent)) {
                this.parent.appendChild(wrapper);
            }
        }

        this.containerEl = wrapper;
        this.amountEl = wrapper.querySelector('.credit-amount');
        this.rateEl = wrapper.querySelector('.credit-rate');
        this.historyEl = wrapper.querySelector('.credit-history');
        this.watchBtn = document.getElementById('credit_watchAdBtn');

        // Re-attach button handler
        if (this.watchBtn) {
            this.watchBtn.addEventListener('click', () => {
                if (window.adOverlay) {
                    window.adOverlay.manualToggle();
                }
            });
        }
    }

    /**
     * Smoothly animate the credit counter to the new value
     */
    _animateCounter() {
        if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
        if (!this.amountEl || !document.contains(this.amountEl)) return;

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
        if (!this.rateEl || !document.contains(this.rateEl)) return;
        const labels = { fullscreen: 'FULL AD', corner: 'CORNER AD', panel: 'PANEL AD' };
        const label = labels[source] || 'AD';
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
        window.removeEventListener('ad-visibility-changed', this._onAdVisibilityChanged);
        if (this._animationFrame) cancelAnimationFrame(this._animationFrame);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CreditDisplay };
}
