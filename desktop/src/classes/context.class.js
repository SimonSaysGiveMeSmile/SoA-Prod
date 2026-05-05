class ContextWidget {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        // Constants
        this.maxTokens = 200000;  // Claude's standard context limit
        this.stalenessThreshold = 30000;  // 30 seconds
        this.lastUpdate = 0;

        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_context">
            <div id="mod_context_innercontainer">
                <h1>CONTEXT<i class="mod_context_headerInfo">NO SESSION</i></h1>
                <div id="mod_context_content">
                    <div class="context-display">
                        <span class="context-text">-- / --</span>
                        <progress class="context-progress" max="100" value="0"></progress>
                    </div>
                </div>
            </div>
        </div>`;

        // Store references to DOM elements
        this.containerEl = document.getElementById("mod_context");
        this.contentEl = document.getElementById("mod_context_content");
        this.textEl = this.contentEl.querySelector(".context-text");
        this.progressEl = this.contentEl.querySelector(".context-progress");
        this.sessionIndicator = this.containerEl.querySelector(".mod_context_headerInfo");

        // Bind methods
        this._onStateChange = this._onStateChange.bind(this);

        // Subscribe to Claude state changes
        window.addEventListener('claude-state-changed', this._onStateChange);

        // Initialize from existing state if available
        if (window.claudeState) {
            this._onStateChange({ detail: window.claudeState });
        }
    }

    /**
     * Calculate total tokens from project data
     * Sums all token fields: input, output, cache creation, cache read
     */
    _calculateTokens(projectData) {
        return (projectData.lastTotalInputTokens || 0) +
               (projectData.lastTotalOutputTokens || 0) +
               (projectData.lastTotalCacheCreationInputTokens || 0) +
               (projectData.lastTotalCacheReadInputTokens || 0);
    }

    /**
     * Format token count for display
     * Returns "Xk" for thousands, raw number otherwise
     */
    _formatTokens(tokens) {
        if (tokens >= 1000) {
            return Math.floor(tokens / 1000) + 'k';
        }
        return String(tokens);
    }

    /**
     * Find project data by path (best prefix match)
     */
    _findProjectByPath(targetPath, projects) {
        if (!targetPath || !projects) return null;

        const normalizedTarget = targetPath.replace(/\\/g, '/').toLowerCase();
        let bestMatch = null;
        let bestMatchLen = 0;

        for (const [projPath, projData] of Object.entries(projects)) {
            const normalizedProj = projPath.replace(/\\/g, '/').toLowerCase();
            // Check if target path starts with project path (is under that project)
            if (normalizedTarget.startsWith(normalizedProj) && normalizedProj.length > bestMatchLen) {
                bestMatch = { path: projPath, data: projData };
                bestMatchLen = normalizedProj.length;
            }
        }

        return bestMatch;
    }

    /**
     * Handle Claude state change event
     * Priority: 1) Live context data, 2) Manual path, 3) Session-based lookup
     */
    _onStateChange(event) {
        const state = event.detail;

        if (!state) {
            this.sessionIndicator.textContent = 'NO DATA';
            this._renderPlaceholder();
            return;
        }

        // Priority 1: Use live context data from statusline (real-time or recent)
        if (state.liveContext && state.liveContext.context_window) {
            const live = state.liveContext;
            const ctx = live.context_window;

            if (ctx.used_percentage != null) {
                // Check freshness - 60s for fresh, 5min for stale but usable
                const age = Date.now() - (live.timestamp || 0);
                const isFresh = age < 60000;  // 1 minute
                const isUsable = age < 300000;  // 5 minutes

                if (isUsable) {
                    // Show model name with freshness indicator
                    const modelName = live.model ? live.model.split('-')[1]?.toUpperCase() || 'LIVE' : 'LIVE';
                    const indicator = isFresh ? '●' : '○';  // Filled for fresh, hollow for stale
                    this.sessionIndicator.textContent = `${modelName} ${indicator}`;

                    console.log(`[Context Debug] Live data - Used: ${ctx.used_percentage}%, Age: ${Math.round(age/1000)}s`);
                    this._renderLive(ctx, !isFresh);  // Pass stale flag
                    return;
                }
            }
        }

        // Priority 2: Check for manual project path override
        const manualPath = window.settings?.contextProjectPath;

        if (manualPath && manualPath.trim() && state.projects) {
            const projectMatch = this._findProjectByPath(manualPath, state.projects);

            if (projectMatch && projectMatch.data) {
                const pathParts = projectMatch.path.replace(/\\/g, '/').split('/');
                const projectName = pathParts[pathParts.length - 1] || 'PROJECT';
                this.sessionIndicator.textContent = projectName.toUpperCase().slice(0, 12);

                console.log(`[Context Debug] Manual path "${manualPath}" matched project "${projectMatch.path}"`);
                this._render(projectMatch.data);
            } else {
                this.sessionIndicator.textContent = 'PATH NOT FOUND';
                console.log(`[Context Debug] Manual path "${manualPath}" did not match any project`);
                this._renderPlaceholder();
            }
            return;
        }

        // Priority 3: Fall back to session-based lookup
        if (!state.projects) {
            this.sessionIndicator.textContent = 'NO DATA';
            this._renderPlaceholder();
            return;
        }

        const activeTerminal = window.currentTerm;
        const sessionId = window.terminalSessions ? window.terminalSessions[activeTerminal] : null;

        if (sessionId) {
            const shortId = sessionId.slice(0, 8);
            this.sessionIndicator.textContent = `SESSION ${shortId}`;
        } else {
            this.sessionIndicator.textContent = 'NO SESSION';
        }

        if (!sessionId) {
            this._renderPlaceholder();
            return;
        }

        let foundProject = null;
        for (const [projPath, projData] of Object.entries(state.projects)) {
            if (projData.lastSessionId === sessionId) {
                foundProject = projData;
                break;
            }
        }

        if (foundProject) {
            this._render(foundProject);
        } else {
            this._renderPlaceholder();
        }

        this._checkStaleness();
    }

    /**
     * Render from live context data (real-time from statusline)
     * @param {Object} contextWindow - Context window data
     * @param {boolean} isStale - Whether the data is stale (>60s old)
     */
    _renderLive(contextWindow, isStale = false) {
        const percentage = Math.round(contextWindow.used_percentage || 0);
        const totalTokens = (contextWindow.total_input_tokens || 0) + (contextWindow.total_output_tokens || 0);
        const maxTokens = contextWindow.context_window_size || this.maxTokens;

        // Update progress bar
        this.progressEl.value = percentage;

        // Update text display
        const formattedUsed = this._formatTokens(totalTokens);
        const formattedMax = this._formatTokens(maxTokens);
        this.textEl.textContent = `${formattedUsed} / ${formattedMax} (${percentage}%)`;

        // Remove all color state classes first
        this.containerEl.classList.remove('caution', 'elevated', 'warning');

        // Apply color class based on percentage thresholds
        if (percentage >= 80) {
            this.containerEl.classList.add('warning');
        } else if (percentage >= 65) {
            this.containerEl.classList.add('elevated');
        } else if (percentage >= 50) {
            this.containerEl.classList.add('caution');
        }
        // Below 50% = default green (no class needed)

        // Add/remove stale class based on data age
        if (isStale) {
            this.containerEl.classList.add('stale');
        } else {
            this.containerEl.classList.remove('stale');
        }

        // Track last update time
        this.lastUpdate = Date.now();
    }

    /**
     * Render context usage from project data
     */
    _render(projectData) {
        const tokens = this._calculateTokens(projectData);
        const percentage = Math.min(100, Math.round((tokens / this.maxTokens) * 100));

        // Update progress bar
        this.progressEl.value = percentage;

        // Update text display
        const formattedUsed = this._formatTokens(tokens);
        this.textEl.textContent = `${formattedUsed} / 200k (${percentage}%)`;

        // Remove all color state classes first
        this.containerEl.classList.remove('caution', 'elevated', 'warning', 'stale');

        // Apply color class based on percentage thresholds
        if (percentage >= 80) {
            this.containerEl.classList.add('warning');
        } else if (percentage >= 65) {
            this.containerEl.classList.add('elevated');
        } else if (percentage >= 50) {
            this.containerEl.classList.add('caution');
        }

        // Track last update time
        this.lastUpdate = Date.now();
    }

    /**
     * Render placeholder state when no session detected
     */
    _renderPlaceholder() {
        this.textEl.textContent = '-- / --';
        this.progressEl.value = 0;
        this.containerEl.classList.remove('caution', 'elevated', 'warning', 'stale');
    }

    /**
     * Check if data is stale (>30 seconds since last update)
     */
    _checkStaleness() {
        if (this.lastUpdate > 0 && (Date.now() - this.lastUpdate > this.stalenessThreshold)) {
            this.containerEl.classList.add('stale');
        }
    }
}

module.exports = { ContextWidget };
