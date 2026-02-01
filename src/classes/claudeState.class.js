/**
 * ClaudeStateManager - File watcher for Claude Code session state
 *
 * Watches ~/.claude.json and ~/.claude/todos/ for changes and sends
 * updates to the renderer process via IPC.
 */
const chokidar = require('chokidar');
const path = require('path');
const os = require('os');
const fs = require('fs');

class ClaudeStateManager {
    /**
     * @param {BrowserWindow} mainWindow - Electron main window reference
     */
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.claudeDir = path.join(os.homedir(), '.claude');
        this.claudeJsonPath = path.join(os.homedir(), '.claude.json');
        this.todosDir = path.join(this.claudeDir, 'todos');
        this.tasksDir = path.join(this.claudeDir, 'tasks');  // Main session tasks directory
        this.liveContextPath = path.join(this.claudeDir, 'cache', 'context-live.json');
        this.watchers = [];
        this.state = {
            projects: {},
            todos: {},
            tasks: {},  // Main session tasks from ~/.claude/tasks/
            liveContext: null,  // Real-time context from statusline
            agents: [],  // Subagent data from ~/.claude/projects/*/subagents/
            lastUpdate: null
        };
        this.projectsDir = path.join(this.claudeDir, 'projects');
        this._updateTimeout = null;
        this._pollInterval = null;
        this._subagentPollInterval = null;
        this._tasksPollInterval = null;
        this._lastLiveContextMtime = 0;
    }

    /**
     * Start file watchers for Claude state files
     */
    start() {
        const watcherOptions = {
            persistent: true,
            ignoreInitial: false,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            },
            ignorePermissionErrors: true
        };

        // Watch main ~/.claude.json file
        const mainWatcher = chokidar.watch(this.claudeJsonPath, watcherOptions);
        mainWatcher.on('add', (filepath) => this._handleMainStateChange(filepath));
        mainWatcher.on('change', (filepath) => this._handleMainStateChange(filepath));
        mainWatcher.on('error', (error) => this._handleError('main', error));
        this.watchers.push(mainWatcher);

        // Watch ~/.claude/todos/ directory
        const todosWatcherOptions = {
            ...watcherOptions,
            depth: 0 // Only watch immediate children
        };
        const todosWatcher = chokidar.watch(this.todosDir, todosWatcherOptions);
        todosWatcher.on('add', (filepath) => this._handleTodoChange(filepath));
        todosWatcher.on('change', (filepath) => this._handleTodoChange(filepath));
        todosWatcher.on('unlink', (filepath) => this._handleTodoRemove(filepath));
        todosWatcher.on('error', (error) => this._handleError('todos', error));
        this.watchers.push(todosWatcher);

        // Watch ~/.claude/cache/context-live.json for real-time context data
        const liveContextWatcherOptions = {
            ...watcherOptions,
            awaitWriteFinish: {
                stabilityThreshold: 100,  // Faster updates for live data
                pollInterval: 50
            }
        };
        const liveContextWatcher = chokidar.watch(this.liveContextPath, liveContextWatcherOptions);
        liveContextWatcher.on('add', (filepath) => this._handleLiveContextChange(filepath));
        liveContextWatcher.on('change', (filepath) => this._handleLiveContextChange(filepath));
        liveContextWatcher.on('error', (error) => this._handleError('liveContext', error));
        this.watchers.push(liveContextWatcher);

        // Polling fallback for live context (chokidar may miss external writes on Windows)
        this._pollInterval = setInterval(() => this._pollLiveContext(), 2000);

        // Watch subagent directories: ~/.claude/projects/*/subagents/ and ~/.claude/projects/*/*/subagents/
        const subagentGlobPatterns = [
            path.join(this.projectsDir, '*', 'subagents', 'agent-*.jsonl'),
            path.join(this.projectsDir, '*', '*', 'subagents', 'agent-*.jsonl')
        ];
        const subagentWatcher = chokidar.watch(subagentGlobPatterns, watcherOptions);
        subagentWatcher.on('add', (filepath) => this._handleSubagentChange(filepath));
        subagentWatcher.on('change', (filepath) => this._handleSubagentChange(filepath));
        subagentWatcher.on('unlink', (filepath) => this._handleSubagentChange(filepath));
        subagentWatcher.on('error', (error) => this._handleError('subagents', error));
        this.watchers.push(subagentWatcher);

        // Initial scan of subagents
        this._scanAllAgents();

        // Polling fallback for subagents (chokidar glob watching unreliable on Windows/OneDrive)
        this._subagentPollInterval = setInterval(() => this._pollSubagents(), 5000);

        // Watch ~/.claude/tasks/ directory for main session tasks
        const tasksGlobPattern = path.join(this.tasksDir, '*', '*.json');
        const tasksWatcher = chokidar.watch(tasksGlobPattern, watcherOptions);
        tasksWatcher.on('add', (filepath) => this._handleTaskChange(filepath));
        tasksWatcher.on('change', (filepath) => this._handleTaskChange(filepath));
        tasksWatcher.on('unlink', (filepath) => this._handleTaskRemove(filepath));
        tasksWatcher.on('error', (error) => this._handleError('tasks', error));
        this.watchers.push(tasksWatcher);

        // Initial scan of tasks
        this._scanAllTasks();

        // Polling fallback for tasks (chokidar glob watching unreliable on Windows/OneDrive)
        this._tasksPollInterval = setInterval(() => this._pollTasks(), 2000);
    }

    /**
     * Poll live context file for changes (fallback for unreliable chokidar)
     */
    _pollLiveContext() {
        try {
            if (!fs.existsSync(this.liveContextPath)) {
                return;
            }
            const stats = fs.statSync(this.liveContextPath);
            const mtime = stats.mtimeMs;

            // Only process if file was modified since last poll
            if (mtime > this._lastLiveContextMtime) {
                this._lastLiveContextMtime = mtime;
                this._handleLiveContextChange(this.liveContextPath);
            }
        } catch (error) {
            console.warn("[ClaudeState] Live context poll failed:", error.message);
        }
    }

    /**
     * Poll subagent directories for changes (fallback for unreliable chokidar glob watching)
     */
    _pollSubagents() {
        this._scanAllAgents();
    }

    /**
     * Poll tasks directory for changes (fallback for unreliable chokidar)
     */
    _pollTasks() {
        this._scanAllTasks();
    }

    /**
     * Handle changes to task files in ~/.claude/tasks/{sessionId}/*.json
     * @param {string} filepath - Path to changed file
     */
    _handleTaskChange(filepath) {
        const filename = path.basename(filepath);
        if (!filename.endsWith('.json') || filename.startsWith('.')) {
            return;
        }
        // Extract sessionId from parent directory name
        const sessionId = path.basename(path.dirname(filepath));
        this._scanSessionTasks(sessionId);
    }

    /**
     * Handle removal of task files
     * @param {string} filepath - Path to removed file
     */
    _handleTaskRemove(filepath) {
        const sessionId = path.basename(path.dirname(filepath));
        this._scanSessionTasks(sessionId);
    }

    /**
     * Scan all session task directories and update state
     */
    _scanAllTasks() {
        try {
            if (!fs.existsSync(this.tasksDir)) {
                return;
            }
            const sessions = fs.readdirSync(this.tasksDir);
            for (const sessionId of sessions) {
                const sessionPath = path.join(this.tasksDir, sessionId);
                try {
                    const stat = fs.statSync(sessionPath);
                    if (stat.isDirectory()) {
                        this._scanSessionTasks(sessionId);
                    }
                } catch (e) {
                    // Skip invalid entries
                }
            }
        } catch (error) {
            console.warn("[ClaudeState] Tasks scan failed:", error.message);
        }
    }

    /**
     * Scan tasks for a specific session
     * @param {string} sessionId - Session ID to scan
     */
    _scanSessionTasks(sessionId) {
        const sessionPath = path.join(this.tasksDir, sessionId);
        try {
            if (!fs.existsSync(sessionPath)) {
                delete this.state.tasks[sessionId];
                this._sendUpdate();
                return;
            }
            const files = fs.readdirSync(sessionPath);
            const tasks = [];
            for (const file of files) {
                if (!file.endsWith('.json') || file.startsWith('.')) continue;
                const filepath = path.join(sessionPath, file);
                const task = this._safeParseJson(filepath, null);
                if (task && task.id) {
                    tasks.push(task);
                }
            }
            // Sort tasks by ID (numeric order)
            tasks.sort((a, b) => parseInt(a.id) - parseInt(b.id));
            this.state.tasks[sessionId] = tasks;
            this.state.lastUpdate = Date.now();
            this._sendUpdate();
        } catch (error) {
            console.warn("[ClaudeState] Session tasks scan failed:", sessionId, error.message);
        }
    }

    /**
     * Stop all file watchers and clean up
     */
    stop() {
        if (this._updateTimeout) {
            clearTimeout(this._updateTimeout);
            this._updateTimeout = null;
        }
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        if (this._subagentPollInterval) {
            clearInterval(this._subagentPollInterval);
            this._subagentPollInterval = null;
        }
        if (this._tasksPollInterval) {
            clearInterval(this._tasksPollInterval);
            this._tasksPollInterval = null;
        }
        this.watchers.forEach(watcher => watcher.close());
        this.watchers = [];
    }

    /**
     * Safely parse JSON file with fallback value
     * @param {string} filepath - Path to JSON file
     * @param {*} fallback - Value to return on error
     * @returns {*} Parsed JSON or fallback
     */
    _safeParseJson(filepath, fallback) {
        try {
            if (!fs.existsSync(filepath)) {
                return fallback;
            }
            const content = fs.readFileSync(filepath, 'utf-8');
            if (!content || content.trim() === '') {
                return fallback;
            }
            return JSON.parse(content);
        } catch (error) {
            console.error(`ClaudeStateManager: Failed to parse ${filepath}:`, error.message);
            return fallback;
        }
    }

    /**
     * Handle changes to main ~/.claude.json state file
     * @param {string} filepath - Path to changed file
     */
    _handleMainStateChange(filepath) {
        const data = this._safeParseJson(filepath, {});
        if (data && data.projects) {
            this.state.projects = data.projects;
            this.state.lastUpdate = Date.now();
            this._sendUpdate();
        }
    }

    /**
     * Handle changes to todo files in ~/.claude/todos/
     * @param {string} filepath - Path to changed file
     */
    _handleTodoChange(filepath) {
        const filename = path.basename(filepath);
        if (!filename.endsWith('.json')) {
            return;
        }

        const data = this._safeParseJson(filepath, []);
        // Extract sessionId from filename: {sessionId}-agent-{agentId}.json
        const sessionId = filename.split('-agent-')[0];
        this.state.todos[sessionId] = data;
        this.state.lastUpdate = Date.now();
        this._sendUpdate();
    }

    /**
     * Handle removal of todo files
     * @param {string} filepath - Path to removed file
     */
    _handleTodoRemove(filepath) {
        const filename = path.basename(filepath);
        const sessionId = filename.split('-agent-')[0];
        delete this.state.todos[sessionId];
        this.state.lastUpdate = Date.now();
        this._sendUpdate();
    }

    /**
     * Handle changes to live context file (real-time data from statusline)
     * @param {string} filepath - Path to changed file
     */
    _handleLiveContextChange(filepath) {
        const data = this._safeParseJson(filepath, null);
        if (data && data.context_window) {
            this.state.liveContext = data;
            this.state.lastUpdate = Date.now();
            this._sendUpdate();
        }
    }

    /**
     * Handle changes to subagent files
     * @param {string} filepath - Path to changed agent file
     */
    _handleSubagentChange(filepath) {
        const filename = path.basename(filepath);
        // Only process agent-*.jsonl files
        if (!filename.startsWith('agent-') || !filename.endsWith('.jsonl')) {
            return;
        }
        // Rescan all agents on any change (simpler than incremental updates)
        this._scanAllAgents();
    }

    /**
     * Scan all subagent directories and update state
     */
    _scanAllAgents() {
        const agents = [];
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);

        try {
            if (!fs.existsSync(this.projectsDir)) {
                this.state.agents = [];
                this._sendUpdate();
                return;
            }

            // Scan projects directory
            const projects = fs.readdirSync(this.projectsDir);
            for (const project of projects) {
                const projectPath = path.join(this.projectsDir, project);
                try {
                    const projectStat = fs.statSync(projectPath);
                    if (!projectStat.isDirectory()) continue;

                    // Check for direct subagents/ directory
                    const directSubagents = path.join(projectPath, 'subagents');
                    if (fs.existsSync(directSubagents)) {
                        this._scanSubagentsDir(directSubagents, agents, oneDayAgo, null);
                    }

                    // Check for session-scoped subagents: project/session-id/subagents/
                    const subdirs = fs.readdirSync(projectPath);
                    for (const subdir of subdirs) {
                        const subdirPath = path.join(projectPath, subdir);
                        try {
                            const subdirStat = fs.statSync(subdirPath);
                            if (!subdirStat.isDirectory()) continue;

                            const sessionSubagents = path.join(subdirPath, 'subagents');
                            if (fs.existsSync(sessionSubagents)) {
                                // subdir name is the session ID
                                this._scanSubagentsDir(sessionSubagents, agents, oneDayAgo, subdir);
                            }
                        } catch (e) {
                            console.warn("[ClaudeState] Error scanning subdir:", subdirPath, e.message);
                        }
                    }
                } catch (e) {
                    console.warn("[ClaudeState] Error scanning project:", project, e.message);
                }
            }

            // Deduplicate by agentId (keep most recent)
            const agentMap = new Map();
            for (const agent of agents) {
                const existing = agentMap.get(agent.id);
                if (!existing || agent.mtime > existing.mtime) {
                    agentMap.set(agent.id, agent);
                }
            }

            // Sort by mtime descending (most recent first)
            const sortedAgents = Array.from(agentMap.values())
                .sort((a, b) => b.mtime - a.mtime)
                .slice(0, 20); // Limit to 20 agents

            this.state.agents = sortedAgents;
            this.state.lastUpdate = Date.now();
            this._sendUpdate();
        } catch (error) {
            console.error('ClaudeStateManager: Error scanning agents:', error.message);
        }
    }

    /**
     * Scan a single subagents directory and add agents to array
     * @param {string} subagentsDir - Path to subagents directory
     * @param {Array} agents - Array to add agents to
     * @param {number} cutoffTime - Only include agents modified after this time
     * @param {string|null} sessionId - Parent session ID if known
     */
    _scanSubagentsDir(subagentsDir, agents, cutoffTime, sessionId) {
        try {
            const files = fs.readdirSync(subagentsDir);
            for (const file of files) {
                if (!file.startsWith('agent-') || !file.endsWith('.jsonl')) continue;

                const filepath = path.join(subagentsDir, file);
                try {
                    const stat = fs.statSync(filepath);
                    const mtime = stat.mtimeMs;

                    // Filter to agents modified in last 24 hours
                    if (mtime < cutoffTime) continue;

                    // Extract agent ID from filename: agent-{id}.jsonl
                    const agentId = file.replace('agent-', '').replace('.jsonl', '');

                    // Parse first line for task description and slug
                    let task = 'Unknown task';
                    let slug = null;
                    let agentSessionId = sessionId;

                    try {
                        const content = fs.readFileSync(filepath, 'utf-8');
                        const firstLine = content.split('\n')[0];
                        if (firstLine) {
                            const data = JSON.parse(firstLine);
                            slug = data.slug || null;
                            agentSessionId = data.sessionId || sessionId;

                            if (data.message && data.message.content) {
                                const msgContent = data.message.content;
                                if (typeof msgContent === 'string') {
                                    task = msgContent.slice(0, 200);
                                } else if (Array.isArray(msgContent) && msgContent[0]) {
                                    task = (msgContent[0].text || '').slice(0, 200);
                                }
                            }
                        }
                    } catch (e) {
                        console.warn("[ClaudeState] Error parsing agent file:", filepath, e.message);
                    }

                    const status = this._getAgentStatus(agentSessionId, agentId, mtime);

                    agents.push({
                        id: agentId,
                        slug: slug,
                        task: task,
                        status: status,
                        mtime: mtime,
                        sessionId: agentSessionId
                    });
                } catch (e) {
                    console.warn("[ClaudeState] Error processing agent file:", file, e.message);
                }
            }
        } catch (error) {
            console.warn("[ClaudeState] Error reading subagents directory:", subagentsDir, error.message);
        }
    }

    /**
     * Get agent status from todo file or mtime fallback
     * @param {string|null} sessionId - Session ID
     * @param {string} agentId - Agent ID
     * @param {number} mtime - File modification time
     * @returns {string} Status: PENDING | RUNNING | COMPLETE | FAILED
     */
    _getAgentStatus(sessionId, agentId, mtime) {
        // Try to get status from todo file
        if (sessionId) {
            const todoFilename = `${sessionId}-agent-${agentId}.json`;
            const todoPath = path.join(this.todosDir, todoFilename);

            try {
                if (fs.existsSync(todoPath)) {
                    const content = fs.readFileSync(todoPath, 'utf-8');
                    const todos = JSON.parse(content);

                    if (Array.isArray(todos) && todos.length > 0) {
                        const hasInProgress = todos.some(t => t.status === 'in_progress');
                        const allCompleted = todos.every(t => t.status === 'completed');
                        const hasPending = todos.some(t => t.status === 'pending');

                        if (hasInProgress) return 'RUNNING';
                        if (allCompleted) return 'COMPLETE';
                        if (hasPending) return 'PENDING';
                    }
                }
            } catch (e) {
                console.warn("[ClaudeState] Error reading todo file for agent status:", todoPath, e.message);
            }
        }

        // Fallback to mtime-based heuristic
        const timeSinceModified = Date.now() - mtime;
        if (timeSinceModified < 10000) return 'RUNNING';        // < 10 seconds
        if (timeSinceModified < 30 * 60 * 1000) return 'PENDING'; // < 30 minutes
        return 'COMPLETE'; // Assume finished if not recently modified
    }

    /**
     * Handle watcher errors (log only, don't crash)
     * @param {string} source - Error source identifier
     * @param {Error} error - Error object
     */
    _handleError(source, error) {
        console.error(`ClaudeStateManager: Watcher error (${source}):`, error.message);
    }

    /**
     * Send state update to renderer via IPC (debounced)
     */
    _sendUpdate() {
        if (this._updateTimeout) {
            clearTimeout(this._updateTimeout);
        }

        this._updateTimeout = setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('claude-state-update', this.state);
            }
            this._updateTimeout = null;
        }, 100);
    }

    /**
     * Find Claude session ID for a given project path
     * @param {string} projectPath - Directory path to match
     * @returns {string|null} Session ID or null if not found
     */
    getSessionForProject(projectPath) {
        const normalizedPath = projectPath.replace(/\\/g, '/').toLowerCase();
        let bestMatch = null;
        let bestMatchLen = 0;

        for (const [projPath, projData] of Object.entries(this.state.projects)) {
            const normalizedProjPath = projPath.replace(/\\/g, '/').toLowerCase();
            if (normalizedPath.startsWith(normalizedProjPath) &&
                normalizedProjPath.length > bestMatchLen &&
                projData.lastSessionId) {
                bestMatch = projData.lastSessionId;
                bestMatchLen = normalizedProjPath.length;
            }
        }

        return bestMatch;
    }
}

module.exports = ClaudeStateManager;
