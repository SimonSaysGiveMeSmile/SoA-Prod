/**
 * TodoWidget - Displays Claude Code's internal task list for the active session
 *
 * Shows running/pending/completed tasks with status indicators.
 * Subscribes to claude-state-changed event for updates.
 */
class TodoWidget {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_todoWidget">
            <div id="mod_todoWidget_innercontainer">
                <h1>TASKS<span class="mod_todoWidget_count"></span></h1>
                <div id="mod_todoWidget_content">
                    <div class="todo-empty">NO SESSION</div>
                </div>
            </div>
        </div>`;

        // Store DOM references
        this.containerEl = document.getElementById("mod_todoWidget");
        this.contentEl = document.getElementById("mod_todoWidget_content");
        this.countEl = this.containerEl.querySelector(".mod_todoWidget_count");

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
     * Handle Claude state change event
     */
    _onStateChange(event) {
        const state = event.detail;

        if (!state) {
            this._renderNoSession();
            return;
        }

        // Get sessionId for current terminal
        const activeTerminal = window.currentTerm;
        const sessionId = window.terminalSessions ? window.terminalSessions[activeTerminal] : null;

        if (!sessionId) {
            this._renderNoSession();
            return;
        }

        // Get tasks from state.tasks[sessionId] (main session tasks)
        // or fall back to state.todos[sessionId] (subagent todos)
        let todos = state.tasks ? state.tasks[sessionId] : null;
        if (!todos || !Array.isArray(todos) || todos.length === 0) {
            todos = state.todos ? state.todos[sessionId] : null;
        }

        if (!todos || !Array.isArray(todos) || todos.length === 0) {
            this._renderEmpty();
            return;
        }

        // Separate into active (pending/in_progress) and completed
        const activeTodos = todos.filter(t => t.status === 'pending' || t.status === 'in_progress');
        const completedTodos = todos.filter(t => t.status === 'completed');

        // Update count
        this.countEl.textContent = ` (${todos.length})`;

        // Render
        this._render(activeTodos, completedTodos);
    }

    /**
     * Render active and completed tasks
     * @param {Array} activeTodos - Active tasks (pending/in_progress)
     * @param {Array} completedTodos - Completed tasks
     */
    _render(activeTodos, completedTodos) {
        let html = '';

        // Render active tasks
        if (activeTodos.length > 0) {
            html += '<div class="todo-active-section">';
            activeTodos.forEach((todo, index) => {
                const statusClass = this._mapStatus(todo.status);
                const content = this._escapeHtml(todo.subject || todo.content || todo.description || todo.title || 'Task');
                html += `
                    <div class="todo-item">
                        <span class="todo-index">${index + 1}.</span>
                        <span class="todo-status-icon ${statusClass}"></span>
                        <span class="todo-content">${content}</span>
                    </div>
                `;
            });
            html += '</div>';
        }

        // Render completed section (collapsible)
        if (completedTodos.length > 0) {
            html += `
                <details class="todo-completed-section">
                    <summary>COMPLETED (${completedTodos.length})</summary>
                    <div class="completed-items">
            `;
            completedTodos.forEach((todo, index) => {
                const content = this._escapeHtml(todo.subject || todo.content || todo.description || todo.title || 'Task');
                html += `
                    <div class="todo-item completed">
                        <span class="todo-index">${activeTodos.length + index + 1}.</span>
                        <span class="todo-status-icon completed"></span>
                        <span class="todo-content">${content}</span>
                    </div>
                `;
            });
            html += '</div></details>';
        }

        // If no active and no completed (shouldn't happen but safety)
        if (activeTodos.length === 0 && completedTodos.length === 0) {
            html = '<div class="todo-empty">No tasks</div>';
        }

        this.contentEl.innerHTML = html;
    }

    /**
     * Map Claude status to CSS class
     * @param {string} status - Claude status (in_progress, pending, completed)
     * @returns {string} CSS class name
     */
    _mapStatus(status) {
        switch (status) {
            case 'in_progress':
                return 'running';
            case 'pending':
                return 'pending';
            case 'completed':
                return 'completed';
            default:
                return 'pending';
        }
    }

    /**
     * Render empty state (session exists but no todos)
     */
    _renderEmpty() {
        this.countEl.textContent = '';
        this.contentEl.innerHTML = '<div class="todo-empty">No tasks</div>';
    }

    /**
     * Render no session state
     */
    _renderNoSession() {
        this.countEl.textContent = '';
        this.contentEl.innerHTML = '<div class="todo-empty">NO SESSION</div>';
    }

    /**
     * Escape HTML entities for XSS safety
     * @param {string} text - Raw text
     * @returns {string} Escaped text
     */
    _escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Export for module.exports compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TodoWidget };
}
