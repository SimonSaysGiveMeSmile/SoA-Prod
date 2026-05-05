/**
 * Tests for TodoWidget class
 * @jest-environment jsdom
 */

// Load the class directly
const fs = require('fs');
const path = require('path');
const classCode = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'classes', 'todoWidget.class.js'),
    'utf-8'
);
// Execute in global scope - strip module.exports block
const cleanCode = classCode.replace(/if\s*\(typeof module[\s\S]*$/m, '');
const script = new Function(cleanCode + '\nreturn TodoWidget;');
const TodoWidget = script();

describe('TodoWidget', () => {
    let todoWidget;
    let parentEl;

    beforeEach(() => {
        // Setup DOM
        parentEl = document.createElement('div');
        parentEl.id = 'test-parent';
        document.body.appendChild(parentEl);

        // Setup global state
        window.currentTerm = 0;
        window.terminalSessions = {};

        // Create instance
        todoWidget = new TodoWidget('test-parent');
    });

    afterEach(() => {
        document.body.innerHTML = '';
        window.claudeState = null;
        window.terminalSessions = {};
    });

    describe('Constructor', () => {
        test('throws error when parentId is missing', () => {
            expect(() => new TodoWidget()).toThrow('Missing parameters');
        });

        test('creates mod_todoWidget element', () => {
            const el = document.getElementById('mod_todoWidget');
            expect(el).not.toBeNull();
        });

        test('creates content element', () => {
            const el = document.getElementById('mod_todoWidget_content');
            expect(el).not.toBeNull();
        });

        test('shows NO SESSION initially', () => {
            const content = document.getElementById('mod_todoWidget_content');
            expect(content.innerHTML).toContain('NO SESSION');
        });
    });

    describe('_escapeHtml', () => {
        test('escapes dangerous characters', () => {
            const result = todoWidget._escapeHtml('<script>alert("xss")</script>');
            expect(result).not.toContain('<script>');
            expect(result).toContain('&lt;script&gt;');
        });

        test('handles null input', () => {
            expect(todoWidget._escapeHtml(null)).toBe('');
        });

        test('handles undefined input', () => {
            expect(todoWidget._escapeHtml(undefined)).toBe('');
        });
    });

    describe('_mapStatus', () => {
        test('maps in_progress to running', () => {
            expect(todoWidget._mapStatus('in_progress')).toBe('running');
        });

        test('maps pending to pending', () => {
            expect(todoWidget._mapStatus('pending')).toBe('pending');
        });

        test('maps completed to completed', () => {
            expect(todoWidget._mapStatus('completed')).toBe('completed');
        });

        test('defaults unknown status to pending', () => {
            expect(todoWidget._mapStatus('unknown')).toBe('pending');
        });
    });

    describe('_render', () => {
        test('renders active todos', () => {
            const activeTodos = [
                { content: 'Task 1', status: 'in_progress' },
                { content: 'Task 2', status: 'pending' }
            ];
            todoWidget._render(activeTodos, []);

            expect(todoWidget.contentEl.innerHTML).toContain('Task 1');
            expect(todoWidget.contentEl.innerHTML).toContain('Task 2');
            expect(todoWidget.contentEl.innerHTML).toContain('todo-active-section');
        });

        test('renders completed todos in details element', () => {
            const completedTodos = [
                { content: 'Done task', status: 'completed' }
            ];
            todoWidget._render([], completedTodos);

            expect(todoWidget.contentEl.innerHTML).toContain('Done task');
            expect(todoWidget.contentEl.innerHTML).toContain('COMPLETED');
            expect(todoWidget.contentEl.innerHTML).toContain('<details');
        });

        test('shows empty message when no todos', () => {
            todoWidget._render([], []);
            expect(todoWidget.contentEl.innerHTML).toContain('No tasks');
        });

        test('escapes HTML in todo content', () => {
            const activeTodos = [
                { content: '<img src=x onerror=alert(1)>', status: 'pending' }
            ];
            todoWidget._render(activeTodos, []);

            expect(todoWidget.contentEl.innerHTML).not.toContain('<img');
            expect(todoWidget.contentEl.innerHTML).toContain('&lt;img');
        });

        test('handles todos with different content field names', () => {
            const activeTodos = [
                { description: 'Task with description', status: 'pending' },
                { title: 'Task with title', status: 'pending' }
            ];
            todoWidget._render(activeTodos, []);

            expect(todoWidget.contentEl.innerHTML).toContain('Task with description');
            expect(todoWidget.contentEl.innerHTML).toContain('Task with title');
        });
    });

    describe('_renderEmpty', () => {
        test('clears count and shows empty message', () => {
            todoWidget.countEl.textContent = '(5)';
            todoWidget._renderEmpty();

            expect(todoWidget.countEl.textContent).toBe('');
            expect(todoWidget.contentEl.innerHTML).toContain('No tasks');
        });
    });

    describe('_renderNoSession', () => {
        test('clears count and shows no session message', () => {
            todoWidget.countEl.textContent = '(5)';
            todoWidget._renderNoSession();

            expect(todoWidget.countEl.textContent).toBe('');
            expect(todoWidget.contentEl.innerHTML).toContain('NO SESSION');
        });
    });

    describe('_onStateChange', () => {
        test('renders no session when state is null', () => {
            todoWidget._onStateChange({ detail: null });
            expect(todoWidget.contentEl.innerHTML).toContain('NO SESSION');
        });

        test('renders no session when no session ID mapped', () => {
            window.terminalSessions = {};
            todoWidget._onStateChange({ detail: { todos: {} } });
            expect(todoWidget.contentEl.innerHTML).toContain('NO SESSION');
        });

        test('renders empty when session has no todos', () => {
            window.terminalSessions = { 0: 'session123' };
            todoWidget._onStateChange({
                detail: { todos: { 'session123': [] } }
            });
            expect(todoWidget.contentEl.innerHTML).toContain('No tasks');
        });

        test('renders todos when session has tasks', () => {
            window.terminalSessions = { 0: 'session123' };
            const todos = [
                { content: 'Active task', status: 'in_progress' },
                { content: 'Pending task', status: 'pending' },
                { content: 'Done task', status: 'completed' }
            ];

            todoWidget._onStateChange({
                detail: { todos: { 'session123': todos } }
            });

            expect(todoWidget.contentEl.innerHTML).toContain('Active task');
            expect(todoWidget.contentEl.innerHTML).toContain('Pending task');
            expect(todoWidget.countEl.textContent).toContain('3');
        });
    });

    describe('Event handling', () => {
        test('responds to claude-state-changed event', () => {
            window.terminalSessions = { 0: 'sess1' };
            const mockState = {
                todos: {
                    'sess1': [{ content: 'Event test task', status: 'pending' }]
                }
            };

            window.dispatchEvent(new CustomEvent('claude-state-changed', {
                detail: mockState
            }));

            expect(todoWidget.contentEl.innerHTML).toContain('Event test task');
        });
    });
});
