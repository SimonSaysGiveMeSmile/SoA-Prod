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
 *   'claude-attention-changed' => { detail: { terminalIndex, needsAttention } }
 */
class ThinkingDetector {
    constructor(opts = {}) {
        this.debounceStartMs = opts.debounceStartMs || opts.debounceMs || 100;  // DET-03
        this.debounceEndMs = opts.debounceEndMs || 200;   // Shorter end debounce for responsiveness
        this.timeoutMs = opts.timeoutMs || 30000;         // DET-04
        this._cooldownMs = opts.cooldownMs || 500;        // Cooldown after thinking ends
        this.enabled = opts.enabled !== false;

        // Per-terminal thinking state (DET-06)
        this._terminals = {};

        // ANSI escape sequence stripper — matches all CSI, OSC, and single-char escapes
        this._ansiRegex = /\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\(.|.)/g;

        // Detection patterns (DET-01, DET-05)
        // All patterns run against ANSI-stripped text for reliable matching
        this._patterns = {
            toolUseStart: [
                /⏺/,                                       // Claude tool use indicator (primary signal)
                /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,                         // Braille spinner characters (any occurrence)
                /(?:Read|Edit|Write|Bash|Glob|Grep|Task|WebFetch|WebSearch|TodoRead|TodoWrite|SemanticSearch)\s/,  // Claude tool name followed by space
                /(?:Read|Edit|Write|Bash|Glob|Grep|Task|WebFetch|WebSearch|TodoRead|TodoWrite|SemanticSearch)\(/,  // Claude tool name followed by paren
            ],
            toolUseEnd: [
                /\$\s*$/m,                                 // Shell prompt returned (bash)
                /❯\s*$/m,                                  // zsh/fish prompt — only bare ❯ at line end
                /\w+@\w+.*[\$#]\s*$/m,                     // user@host prompt
                /%\s*$/m,                                   // zsh default prompt
                />\s*$/m,                                   // minimal prompt (>)
            ],
            statusMessages: [
                /Thinking\.\.\./i,
                /Processing\.\.\./i,
                /Running\.\.\./i,
                /Executing\.\.\./i,
            ],
            streamingOutput: [
                /^│\s/m,                                    // Claude Code streaming output prefix (box-drawing vertical bar)
                /^│$/m,                                     // Empty streaming line
                /^\s{2,}[^\s]/m,                            // Indented content block (Claude response body)
            ]
        };

        // Attention patterns — detect Claude Code permission/input prompts
        this._attentionPatterns = [
            /Allow\s+\w+/,                          // Permission prompts (Allow Read, Allow Bash, etc.)
            /\(Y\)es\s*\/\s*\(N\)o/,                // (Y)es / (N)o choices
            /\[Y\/n\]/i,                             // [Y/n] or [y/N] prompts
            /\(y\/n\)/i,                             // (y/n) prompts
            /Do you want to proceed/i,               // Proceed confirmation
            /Do you want to continue/i,              // Continue confirmation
            /approve/i,                              // Approval prompts
            /continue\?\s*$/m,                       // "continue?" at end of line
            /Press Enter to/i,                       // Press Enter prompts
            /waiting for.*input/i,                   // Waiting for input
        ];

        // Accumulation buffer for detecting multi-chunk patterns
        this._bufferSize = 4096;

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
            needsAttention: false,
            buffer: '',
            debounceTimer: null,
            timeoutTimer: null,
            lastOutputTime: 0,
            lastNonEmptyOutput: 0,
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
     * Strip ANSI escape sequences from text for reliable pattern matching
     * @param {string} text
     * @returns {string}
     */
    _stripAnsi(text) {
        return text.replace(this._ansiRegex, '');
    }

    /**
     * Process terminal output chunk and detect thinking state
     * @param {number} terminalIndex
     * @param {string} data - Raw terminal output
     */
    _processOutput(terminalIndex, data) {
        const state = this._terminals[terminalIndex];
        if (!state) return;

        const clean = this._stripAnsi(data);

        // Update buffer (rolling window) — ANSI-stripped for reliable end-detection
        state.buffer = (state.buffer + clean).slice(-this._bufferSize);
        state.lastOutputTime = Date.now();

        // Track output activity — any non-empty output resets the silence timer
        if (clean.trim().length > 0) {
            state.lastNonEmptyOutput = Date.now();
        }

        // Scan for attention patterns on clean text
        if (!state.needsAttention) {
            const needsAttention = this._attentionPatterns.some(p => p.test(clean));
            if (needsAttention) {
                this._setAttention(terminalIndex, true);
            }
        }

        // Use clean data chunk for start detection (avoids stale buffer false positives)
        // Use buffer tail for end detection (prompt patterns may span chunks)
        const startDetected = this._detectThinkingStart(clean);
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
        } else if (state.isThinking && startDetected.detected) {
            // Still thinking + got new start signal — reset the timeout
            clearTimeout(state.timeoutTimer);
            state.timeoutTimer = setTimeout(() => {
                this._setThinking(terminalIndex, false, null);
            }, this.timeoutMs);
        }

        // Reset silence detection — if output is flowing, check for prompt return
        if (state.isThinking) {
            clearTimeout(state.silenceTimer);
            const promptDetected = this._patterns.toolUseEnd.some(p => p.test(clean));
            if (promptDetected) {
                clearTimeout(state.debounceTimer);
                state.debounceTimer = setTimeout(() => {
                    this._setThinking(terminalIndex, false, null);
                }, this.debounceEndMs);
            }

            // Silence fallback: if no non-empty output for 5s during thinking, end it
            state.silenceTimer = setTimeout(() => {
                if (state.isThinking && (Date.now() - state.lastNonEmptyOutput) > 5000) {
                    this._setThinking(terminalIndex, false, null);
                }
            }, 6000);
        }
    }

    /**
     * Detect thinking START patterns in ANSI-stripped data chunk (not buffer)
     * Using per-chunk data avoids stale ⏺ indicators in the rolling buffer
     * @param {string} data - ANSI-stripped incoming terminal output chunk
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
        for (const pattern of this._patterns.streamingOutput) {
            if (pattern.test(data)) {
                return { detected: true, method: 'streaming' };
            }
        }
        return { detected: false, method: null };
    }

    /**
     * Detect thinking END patterns in buffer tail (prompts may span chunks)
     * Buffer is already ANSI-stripped
     * @param {string} buffer
     * @returns {boolean}
     */
    _detectThinkingEnd(buffer) {
        const recent = buffer.slice(-1024);
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

            // Clear attention when thinking starts fresh (user answered, Claude continues)
            if (state.needsAttention) {
                this._setAttention(terminalIndex, false);
            }

            this._onThinkingStart(terminalIndex, method);
        } else {
            clearTimeout(state.timeoutTimer);
            // Aggressively clear buffer and record end time for cooldown
            state.buffer = '';
            state.lastThinkingEndTime = Date.now();

            // Don't clear attention here — if a permission prompt is showing,
            // it should remain until the user (or YOLO mode) answers it.
            // Attention is cleared when thinking starts again (user answered).

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
     * Set attention state and emit event
     * @param {number} terminalIndex
     * @param {boolean} needsAttention
     */
    _setAttention(terminalIndex, needsAttention) {
        const state = this._terminals[terminalIndex];
        if (!state || state.needsAttention === needsAttention) return;

        state.needsAttention = needsAttention;

        window.dispatchEvent(new CustomEvent('claude-attention-changed', {
            detail: { terminalIndex, needsAttention }
        }));
    }

    /**
     * Get attention state for a terminal
     * @param {number} terminalIndex
     * @returns {boolean}
     */
    isNeedingAttention(terminalIndex) {
        const state = this._terminals[terminalIndex];
        return state ? state.needsAttention : false;
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
