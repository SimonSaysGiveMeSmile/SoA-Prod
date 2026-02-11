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
        this.debounceMs = opts.debounceMs || 300;       // DET-03
        this.timeoutMs = opts.timeoutMs || 30000;       // DET-04
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
            silenceTimer: null,
            method: null
        };

        const state = this._terminals[terminalIndex];

        // Listen to WebSocket messages (DET-02 - using message events)
        const handler = (event) => {
            const data = typeof event.data === 'string' ? event.data : '';
            this._processOutput(terminalIndex, data);
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

        // Update buffer (rolling window)
        state.buffer = (state.buffer + data).slice(-this._bufferSize);
        state.lastOutputTime = Date.now();

        // Check for thinking indicators
        const thinkingDetected = this._detectThinking(state.buffer);

        if (thinkingDetected.detected && !state.isThinking) {
            // Start thinking with debounce (DET-03)
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(() => {
                this._setThinking(terminalIndex, true, thinkingDetected.method);
            }, this.debounceMs);
        } else if (!thinkingDetected.detected && state.isThinking) {
            // End thinking with debounce (DET-03)
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(() => {
                this._setThinking(terminalIndex, false, null);
            }, this.debounceMs);
        }

        // Reset silence detection - if output is flowing, check for prompt return
        if (state.isThinking) {
            clearTimeout(state.silenceTimer);
            // If we see a prompt pattern, end thinking
            const promptDetected = this._patterns.toolUseEnd.some(p => p.test(data));
            if (promptDetected) {
                clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(() => {
                    this._setThinking(terminalIndex, false, null);
                }, this.debounceMs);
            }
        }
    }

    /**
     * Detect thinking patterns in buffered output (DET-01, DET-05)
     * Only checks recent output (last chunk + small window) to avoid stale matches
     * @param {string} buffer
     * @returns {{ detected: boolean, method: string|null }}
     */
    _detectThinking(buffer) {
        // Only check the most recent output to avoid stale pattern matches
        const recent = buffer.slice(-512);

        // Check tool use patterns (DET-01) — Claude-specific indicators
        for (const pattern of this._patterns.toolUseStart) {
            if (pattern.test(recent)) {
                return { detected: true, method: 'tool_use' };
            }
        }

        // Check status messages (DET-05)
        for (const pattern of this._patterns.statusMessages) {
            if (pattern.test(recent)) {
                return { detected: true, method: 'status_message' };
            }
        }

        return { detected: false, method: null };
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
            state.buffer = '';
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
        if (typeof opts.debounceMs === 'number') this.debounceMs = opts.debounceMs;
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
