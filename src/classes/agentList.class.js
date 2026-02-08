class AgentList {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);
        let wrapper = document.createElement("div");
        wrapper.setAttribute("id", "mod_agentList");
        wrapper.innerHTML = `<h1>ACTIVE AGENTS</h1>
            <div id="mod_agentList_content">
                <div class="loading">Waiting for agent data...</div>
            </div>`;
        this.parent.appendChild(wrapper);

        this.contentEl = document.getElementById("mod_agentList_content");

        // Bind event handler
        this._onStateChange = this._onStateChange.bind(this);
        window.addEventListener('claude-state-changed', this._onStateChange);

        // Event delegation for expand/collapse (added ONCE, not on every render)
        this.contentEl.addEventListener('click', (e) => {
            const item = e.target.closest('.agent-item');
            if (item) this._toggleExpand(item);
        });

        this.init();
    }

    destroy() {
        window.removeEventListener('claude-state-changed', this._onStateChange);
    }

    init() {
        // If state already exists, render immediately
        if (window.claudeState && window.claudeState.agents) {
            this._onStateChange({ detail: window.claudeState });
        }
    }

    _onStateChange(event) {
        const state = event.detail;
        if (!state) {
            console.warn('AgentList: Received null/undefined state');
            return;
        }
        if (!state.agents) {
            console.warn('AgentList: State missing agents array');
            return;
        }

        // Get current session ID from live context
        const currentSessionId = this._extractSessionId(state);

        // Filter and sort agents
        const agents = this._processAgents(state.agents, currentSessionId);
        this.render(agents);
    }

    _extractSessionId(state) {
        if (!state.liveContext) {
            console.debug('AgentList: liveContext not available');
            return null;
        }
        if (!state.liveContext.session_id) {
            console.debug('AgentList: liveContext.session_id missing');
            return null;
        }
        return String(state.liveContext.session_id).trim();
    }

    _processAgents(agents, currentSessionId) {
        const TEN_MINUTES_MS = 10 * 60 * 1000;
        const FIVE_MINUTES_MS = 5 * 60 * 1000;
        const now = Date.now();

        // Validate and process agents
        const processed = agents
            .filter(a => {
                // Validate required properties
                if (!a || !a.id) {
                    console.warn('AgentList: Invalid agent (missing id)', a);
                    return false;
                }
                if (typeof a.mtime !== 'number' || isNaN(a.mtime)) {
                    console.warn('AgentList: Invalid agent mtime', { id: a.id, mtime: a.mtime });
                    return false;
                }
                return true;
            })
            .map(a => {
                // Normalize sessionId for comparison
                const agentSessionId = a.sessionId ? String(a.sessionId).trim() : null;
                const isCurrentSession = currentSessionId && agentSessionId === currentSessionId;
                const age = now - a.mtime;
                const isRecent = age <= TEN_MINUTES_MS;
                const isVeryRecent = age <= FIVE_MINUTES_MS;

                // Normalize status to uppercase
                const status = (a.status || 'UNKNOWN').toUpperCase();
                let displayStatus = status;

                // For non-running/pending agents in current session, mark as ONLINE if recent
                if (status !== 'RUNNING' && status !== 'PENDING') {
                    if (isCurrentSession && isRecent) {
                        displayStatus = 'ONLINE';
                    }
                }
                return { ...a, status, displayStatus, isCurrentSession, isRecent, isVeryRecent };
            });

        // Filter agents based on session context availability
        const filtered = processed.filter(a => {
            if (a.displayStatus === 'RUNNING' || a.displayStatus === 'PENDING') {
                // CRITICAL FIX: When no session ID available, use stricter filtering
                if (!currentSessionId) {
                    // Without session context, only show very recent agents (5 min)
                    return a.isVeryRecent;
                }
                // With session context: current session OR recent
                return a.isCurrentSession || a.isRecent;
            }
            // ONLINE only for current session
            return a.isCurrentSession && a.displayStatus === 'ONLINE';
        });

        // Sort: current session first, then by status priority, then by recency
        const statusPriority = { 'RUNNING': 0, 'PENDING': 1, 'ONLINE': 2 };
        filtered.sort((a, b) => {
            // Current session agents always come first
            if (a.isCurrentSession !== b.isCurrentSession) {
                return a.isCurrentSession ? -1 : 1;
            }
            // Then by status priority
            const priorityDiff = (statusPriority[a.displayStatus] || 99) - (statusPriority[b.displayStatus] || 99);
            if (priorityDiff !== 0) return priorityDiff;
            // Then by recency (handle potential NaN)
            const mtimeA = a.mtime || 0;
            const mtimeB = b.mtime || 0;
            return mtimeB - mtimeA;
        });

        // Limit to 5 visible
        return filtered.slice(0, 5);
    }

    _generateAgentName(task) {
        // Extract meaningful name from task description
        if (!task || task === 'Unknown task') return 'Agent Task';

        // Strip XML-like tags (e.g., <objective>, <planning_context>)
        let text = task.replace(/<[^>]+>/g, ' ').trim();

        // Get lines and find first meaningful one (skip metadata-only lines)
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let bestLine = '';
        for (const line of lines) {
            // Skip metadata lines
            if (/^\*\*[^*]+\*\*:?\s*[\w\d.-]*\s*$/.test(line)) continue;  // **Label:** short_value
            if (/^@/.test(line)) continue;  // @file references
            if (/^[-=]+$/.test(line)) continue;  // Separators
            if (line.length < 10) continue;  // Too short to be meaningful
            bestLine = line;
            break;
        }
        if (!bestLine) bestLine = lines[0] || text;

        // Take first sentence or phrase
        const firstSentence = bestLine.split(/[.!?]/)[0] || bestLine;

        // Clean up common prefixes
        let cleaned = firstSentence.slice(0, 150).trim()
            .replace(/^\*\*[^*]+\*\*:?\s*/i, '')  // Strip markdown bold headers
            .replace(/^(please |can you |could you |i need |let's |now )/i, '')
            .replace(/^(verify |research |execute |implement |create |fix |update |add )/i, '')
            .replace(/^(phase[:\s]*\d+[\s:-]*)?(goal\s+)?/i, '')
            .replace(/^(plan[:\s]*\d+\s*(of\s+)?)/i, '')
            .replace(/^achievement\s*/i, '');

        // Extract meaningful words (skip short/common words)
        const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'will', 'how', 'each', 'task', 'phase', 'directory', 'planning', 'phases']);
        const words = cleaned.split(/[\s-]+/)
            .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
            .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()) && !/^\d+$/.test(w))
            .slice(0, 4);

        let name = words
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');

        // Fallback: try to extract phase name from paths in the task
        if (!name) {
            const phaseMatch = task.match(/phases?\/\d+[-.]?([\w-]+)/i);
            if (phaseMatch && phaseMatch[1]) {
                name = phaseMatch[1].split('-')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                    .join(' ');
            }
        }

        // Trim and validate
        name = (name || '').trim();

        // Max 30 chars with ellipsis
        if (name && name.length > 30) {
            return name.slice(0, 27) + '...';
        }

        return name || 'Agent Task';
    }

    _truncateTask(task, maxLen) {
        if (!task) return 'No task description';
        if (task.length <= maxLen) return task;
        return task.slice(0, maxLen - 3) + '...';
    }

    _escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    _toggleExpand(item) {
        const isExpanded = item.getAttribute('data-expanded') === 'true';
        const fullTask = item.querySelector('.agent-full-task');
        const preview = item.querySelector('.agent-task-preview');

        if (isExpanded) {
            fullTask.style.display = 'none';
            preview.style.display = '';
            item.setAttribute('data-expanded', 'false');
        } else {
            fullTask.style.display = 'block';
            preview.style.display = 'none';
            item.setAttribute('data-expanded', 'true');
        }
    }

    render(agents) {
        if (agents.length === 0) {
            this.contentEl.innerHTML = '<div class="no-agents">- NO ACTIVE AGENTS -</div>';
            return;
        }

        let html = '';
        agents.forEach((agent, index) => {
            const name = this._generateAgentName(agent.task);
            const statusClass = (agent.displayStatus || agent.status || 'unknown').toLowerCase();
            const taskPreview = this._truncateTask(agent.task, 60);
            const fullTask = this._escapeHtml(agent.task || 'No task description');
            const agentId = agent.id || `unknown-${index}`;

            html += `
                <div class="agent-item ${statusClass}" data-agent-id="${agentId}" data-expanded="false">
                    <div class="agent-line1">
                        <span class="agent-status-dot ${statusClass}"></span>
                        <span class="agent-name">${this._escapeHtml(name)}</span>
                    </div>
                    <div class="agent-line2">
                        <span class="agent-task-preview">${this._escapeHtml(taskPreview)}</span>
                    </div>
                    <div class="agent-full-task" style="display: none;">
                        ${fullTask}
                    </div>
                </div>
            `;
        });

        this.contentEl.innerHTML = html;
        // Note: Click handlers use event delegation (set up once in constructor)
    }
}


// window.AgentList = AgentList;
