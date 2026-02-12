/**
 * ThinkingDetector - Detects when Claude Code is "thinking" by parsing terminal output
 *
 * Monitors terminal WebSocket messages for tool use blocks, status messages,
 * and response delays. Supports debouncing, timeouts, and per-terminal state.
 *
 * Requirements: DET-01 through DET-06
 *
 * Events emitted on window:
 *   'thinking-state-changed' => { detail: { terminalIndex, isThinking, method } }
 */
class ThinkingDetector {
    constructor(opts = {}) {
        this.debounceStartMs = opts.debounceStartMs || opts.debounceMs || 300;  // DET-03
        this.debounceEndMs = opts.debounceEndMs || 500;   // Longer end debounce to avoid premature end
        this.timeoutMs = opts.timeoutMs || 30000;         // DET-04
        this._cooldownMs = opts.cooldownMs || 2000;       // Cooldown after thinking ends
        this.enabled = opts.enabled !== false;

        // Per-terminal thinking state (DET-06)
        this._terminals = {};

        // Detection patterns (DET-01, DET-05)
        // Claude Code specific: spinner chars appear WITH the ⏺ tool indicator or status text
        this._patterns = {
            toolUseStart: [
                /⏺/,                                       // Claude tool use indicator (primary signal)
                /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏].*(?:Read|Edit|Write|Bash|Glob|Grep|Task|WebFetch)/,  // Spinner + Claude tool name
                /(?:Read|Edit|Write|Bash|Glob|Grep|Task|WebFetch|WebSearch).*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, // Tool name + spinner
            ],
            toolUseEnd: [
                /\$\s*$/m,                                 // Shell prompt returned
                /❯\s*$/m,                                  // Alternative prompt (zsh/fish)
                /\w+@\w+.*[\$#]\s*$/m,                     // user@host prompt (specific, not just >)
            ],
            statusMessages: [
                /Thinking\.\.\./i,
                /Processing\.\.\./i,
                /Running\.\.\./i,
                /Executing\.\.\./i,
            ]
        };

        // Accumulation buffer for detecting multi-chunk patterns
        this._bufferSize = 2048;

        this._onThinkingStart = opts.onThinkingStart || (() => {});
        this._onThinkingEnd = opts.onThinkingEnd || (() => {});
    }

    /**
     * Attach to a terminal's WebSocket to monitor output (DET-02)
     * @param {number} terminalIndex - Terminal tab index (0-4)
     * @param {WebSocket} socket - The terminal's WebSocket connection
     */
    attach(terminalIndex, socket) {
        if (!this.enabled) return;

        // Initialize per-terminal state
        this._terminals[terminalIndex] = {
            isThinking: false,
            buffer: '',
            debounceTimer: null,
            timeoutTimer: null,
            lastOutputTime: 0,
            lastThinkingEndTime: 0,
            silenceTimer: null,
            method: null
        };

        const state = this._terminals[terminalIndex];

        // Shared TextDecoder for binary WebSocket frames (AttachAddon sets binaryType='arraybuffer')
        const decoder = new TextDecoder();

        // Listen to WebSocket messages (DET-02 - using message events)
        const handler = (event) => {
            let data;
            if (typeof event.data === 'string') {
                data = event.data;
            } else if (event.data instanceof ArrayBuffer) {
                data = decoder.decode(event.data);
            } else {
                return; // Blob or unknown — skip
            }
            if (data) this._processOutput(terminalIndex, data);
        };

        socket.addEventListener('message', handler);
        state._handler = handler;
        state._socket = socket;
    }

    /**
     * Detach from a terminal
     * @param {number} terminalIndex
     */
    detach(terminalIndex) {
        const state = this._terminals[terminalIndex];
        if (!state) return;

        if (state._socket && state._handler) {
            state._socket.removeEventListener('message', state._handler);
        }
        clearTimeout(state.debounceTimer);
        clearTimeout(state.timeoutTimer);
        clearTimeout(state.silenceTimer);
        delete this._terminals[terminalIndex];
    }

    /**
     * Process terminal output chunk and detect thinking state
     * @param {number} terminalIndex
     * @param {string} data - Raw terminal output
     */
    _processOutput(terminalIndex, data) {
        const state = this._terminals[terminalIndex];
        if (!state) return;

        // Update buffer (rolling window) — used for end-of-thinking prompt detection
        state.buffer = (state.buffer + data).slice(-this._bufferSize);
        state.lastOutputTime = Date.now();

        // Use raw data chunk for start detection (avoids stale buffer false positives)
        // Use buffer tail for end detection (prompt patterns may span chunks)
        const startDetected = this._detectThinkingStart(data);
        const endDetected = this._detectThinkingEnd(state.buffer);

        if (startDetected.detected && !state.isThinking) {
            // Skip if within cooldown window after last thinking ended
            const elapsed = Date.now() - state.lastThinkingEndTime;
            if (elapsed < this._cooldownMs) return;

            // Start thinking with debounce (DET-03)
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(() => {
                this._setThinking(terminalIndex, true, startDetected.method);
            }, this.debounceStartMs);
        } else if (state.isThinking && endDetected) {
            // End thinking with longer debounce to avoid premature end
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(() => {
                this._setThinking(terminalIndex, false, null);
            }, this.debounceEndMs);
        }

        // Reset silence detection - if output is flowing, check for prompt return
        if (state.isThinking) {
            clearTimeout(state.silenceTimer);
            const promptDetected = this._patterns.toolUseEnd.some(p => p.test(data));
            if (promptDetected) {
                clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(() => {
                    this._setThinking(terminalIndex, false, null);
                }, this.debounceEndMs);
            }
        }
    }

    /**
     * Detect thinking START patterns in raw data chunk (not buffer)
     * Using raw data avoids stale ⏺ indicators in the rolling buffer
     * @param {string} data - Raw incoming terminal output chunk
     * @returns {{ detected: boolean, method: string|null }}
     */
    _detectThinkingStart(data) {
        for (const pattern of this._patterns.toolUseStart) {
            if (pattern.test(data)) {
                return { detected: true, method: 'tool_use' };
            }
        }
        for (const pattern of this._patterns.statusMessages) {
            if (pattern.test(data)) {
                return { detected: true, method: 'status_message' };
            }
        }
        return { detected: false, method: null };
    }

    /**
     * Detect thinking END patterns in buffer tail (prompts may span chunks)
     * @param {string} buffer
     * @returns {boolean}
     */
    _detectThinkingEnd(buffer) {
        const recent = buffer.slice(-512);
        return this._patterns.toolUseEnd.some(p => p.test(recent));
    }

    /**
     * Set thinking state and emit events
     * @param {number} terminalIndex
     * @param {boolean} isThinking
     * @param {string|null} method
     */
    _setThinking(terminalIndex, isThinking, method) {
        const state = this._terminals[terminalIndex];
        if (!state || state.isThinking === isThinking) return;

        state.isThinking = isThinking;
        state.method = method;

        if (isThinking) {
            // Start timeout fallback (DET-04)
            clearTimeout(state.timeoutTimer);
            state.timeoutTimer = setTimeout(() => {
                this._setThinking(terminalIndex, false, null);
            }, this.timeoutMs);

            this._onThinkingStart(terminalIndex, method);
        } else {
            clearTimeout(state.timeoutTimer);
            // Aggressively clear buffer and record end time for cooldown
            state.buffer = '';
            state.lastThinkingEndTime = Date.now();
            this._onThinkingEnd(terminalIndex);
        }

        // Emit event for other components
        window.dispatchEvent(new CustomEvent('thinking-state-changed', {
            detail: { terminalIndex, isThinking, method }
        }));
    }

    /**
     * Get thinking state for a terminal (DET-06)
     * @param {number} terminalIndex
     * @returns {boolean}
     */
    isThinking(terminalIndex) {
        const state = this._terminals[terminalIndex];
        return state ? state.isThinking : false;
    }

    /**
     * Update configuration at runtime
     * @param {object} opts
     */
    configure(opts) {
        if (typeof opts.debounceMs === 'number') {
            this.debounceStartMs = opts.debounceMs;
        }
        if (typeof opts.debounceStartMs === 'number') this.debounceStartMs = opts.debounceStartMs;
        if (typeof opts.debounceEndMs === 'number') this.debounceEndMs = opts.debounceEndMs;
        if (typeof opts.cooldownMs === 'number') this._cooldownMs = opts.cooldownMs;
        if (typeof opts.timeoutMs === 'number') this.timeoutMs = opts.timeoutMs;
        if (typeof opts.enabled === 'boolean') this.enabled = opts.enabled;
    }

    /**
     * Clean up all terminals
     */
    destroy() {
        Object.keys(this._terminals).forEach(idx => this.detach(Number(idx)));
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ThinkingDetector };
}
