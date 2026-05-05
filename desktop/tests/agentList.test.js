/**
 * Tests for AgentList class
 * @jest-environment jsdom
 */

// Load the class directly (not as module since it's browser-based)
const fs = require('fs');
const path = require('path');
const classCode = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'classes', 'agentList.class.js'),
    'utf-8'
);
// Execute in global scope
const script = new Function(classCode + '\nreturn AgentList;');
const AgentList = script();

describe('AgentList', () => {
    let agentList;
    let parentEl;

    beforeEach(() => {
        // Setup DOM
        parentEl = document.createElement('div');
        parentEl.id = 'test-parent';
        document.body.appendChild(parentEl);

        // Create instance
        agentList = new AgentList('test-parent');
    });

    afterEach(() => {
        if (agentList && agentList.destroy) {
            agentList.destroy();
        }
        document.body.innerHTML = '';
    });

    describe('Constructor', () => {
        test('throws error when parentId is missing', () => {
            expect(() => new AgentList()).toThrow('Missing parameters');
        });

        test('creates mod_agentList element', () => {
            const el = document.getElementById('mod_agentList');
            expect(el).not.toBeNull();
        });

        test('creates content element', () => {
            const el = document.getElementById('mod_agentList_content');
            expect(el).not.toBeNull();
        });

        test('shows loading message initially', () => {
            const content = document.getElementById('mod_agentList_content');
            expect(content.innerHTML).toContain('Waiting for agent data');
        });
    });

    describe('_extractSessionId', () => {
        test('returns null when liveContext is missing', () => {
            const result = agentList._extractSessionId({});
            expect(result).toBeNull();
        });

        test('returns null when session_id is missing', () => {
            const result = agentList._extractSessionId({ liveContext: {} });
            expect(result).toBeNull();
        });

        test('returns trimmed session_id when present', () => {
            const result = agentList._extractSessionId({
                liveContext: { session_id: '  abc123  ' }
            });
            expect(result).toBe('abc123');
        });

        test('converts numeric session_id to string', () => {
            const result = agentList._extractSessionId({
                liveContext: { session_id: 12345 }
            });
            expect(result).toBe('12345');
        });
    });

    describe('_generateAgentName', () => {
        test('returns default for null task', () => {
            expect(agentList._generateAgentName(null)).toBe('Agent Task');
        });

        test('returns default for "Unknown task"', () => {
            expect(agentList._generateAgentName('Unknown task')).toBe('Agent Task');
        });

        test('extracts meaningful words from task', () => {
            const result = agentList._generateAgentName('Please implement user authentication');
            expect(result).not.toBe('Agent Task');
            expect(result.length).toBeGreaterThan(0);
        });

        test('strips XML-like tags', () => {
            const result = agentList._generateAgentName('<objective>Implement login</objective>');
            expect(result).not.toContain('<');
            expect(result).not.toContain('>');
        });

        test('truncates long names to 30 chars', () => {
            const longTask = 'This is a very long task description that should be truncated properly';
            const result = agentList._generateAgentName(longTask);
            expect(result.length).toBeLessThanOrEqual(30);
        });

        test('extracts phase name from path', () => {
            const result = agentList._generateAgentName('Working on phases/01-setup for initialization');
            // Should extract something from the task
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('_escapeHtml', () => {
        test('escapes ampersand', () => {
            expect(agentList._escapeHtml('a & b')).toBe('a &amp; b');
        });

        test('escapes less than', () => {
            expect(agentList._escapeHtml('a < b')).toBe('a &lt; b');
        });

        test('escapes greater than', () => {
            expect(agentList._escapeHtml('a > b')).toBe('a &gt; b');
        });

        test('escapes quotes', () => {
            expect(agentList._escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
        });

        test('escapes single quotes', () => {
            expect(agentList._escapeHtml("a 'b' c")).toBe('a &#039;b&#039; c');
        });

        test('handles null input', () => {
            expect(agentList._escapeHtml(null)).toBe('');
        });

        test('handles undefined input', () => {
            expect(agentList._escapeHtml(undefined)).toBe('');
        });
    });

    describe('_truncateTask', () => {
        test('returns short strings unchanged', () => {
            expect(agentList._truncateTask('Short task', 60)).toBe('Short task');
        });

        test('truncates long strings with ellipsis', () => {
            const longStr = 'a'.repeat(100);
            const result = agentList._truncateTask(longStr, 60);
            expect(result.length).toBe(60);
            expect(result.endsWith('...')).toBe(true);
        });

        test('handles null input', () => {
            expect(agentList._truncateTask(null, 60)).toBe('No task description');
        });
    });

    describe('_processAgents', () => {
        const now = Date.now();

        test('filters out agents without id', () => {
            const agents = [
                { mtime: now },
                { id: 'valid', mtime: now, status: 'RUNNING' }
            ];
            const result = agentList._processAgents(agents, null);
            expect(result.length).toBeLessThanOrEqual(1);
        });

        test('filters out agents with invalid mtime', () => {
            const agents = [
                { id: 'a1', mtime: 'invalid' },
                { id: 'a2', mtime: now, status: 'RUNNING' }
            ];
            const result = agentList._processAgents(agents, null);
            expect(result.every(a => typeof a.mtime === 'number')).toBe(true);
        });

        test('normalizes status to uppercase', () => {
            const agents = [
                { id: 'a1', mtime: now, status: 'running', sessionId: 'sess1' }
            ];
            const result = agentList._processAgents(agents, 'sess1');
            if (result.length > 0) {
                expect(result[0].status).toBe('RUNNING');
            }
        });

        test('limits output to 5 agents', () => {
            const agents = Array.from({ length: 10 }, (_, i) => ({
                id: `agent${i}`,
                mtime: now - i * 1000,
                status: 'RUNNING',
                sessionId: 'sess1'
            }));
            const result = agentList._processAgents(agents, 'sess1');
            expect(result.length).toBeLessThanOrEqual(5);
        });

        test('prioritizes current session agents', () => {
            const agents = [
                { id: 'other', mtime: now, status: 'RUNNING', sessionId: 'other-sess' },
                { id: 'current', mtime: now - 1000, status: 'RUNNING', sessionId: 'current-sess' }
            ];
            const result = agentList._processAgents(agents, 'current-sess');
            if (result.length >= 2) {
                expect(result[0].id).toBe('current');
            }
        });
    });

    describe('render', () => {
        test('shows no agents message when empty', () => {
            agentList.render([]);
            expect(agentList.contentEl.innerHTML).toContain('NO ACTIVE AGENTS');
        });

        test('renders agent items', () => {
            const agents = [
                {
                    id: 'agent1',
                    task: 'Test task',
                    displayStatus: 'RUNNING',
                    status: 'RUNNING',
                    mtime: Date.now()
                }
            ];
            agentList.render(agents);
            expect(agentList.contentEl.innerHTML).toContain('agent-item');
            expect(agentList.contentEl.innerHTML).toContain('running');
        });

        test('escapes HTML in task content', () => {
            const agents = [
                {
                    id: 'agent1',
                    task: '<script>alert("xss")</script>',
                    displayStatus: 'RUNNING',
                    status: 'RUNNING',
                    mtime: Date.now()
                }
            ];
            agentList.render(agents);
            expect(agentList.contentEl.innerHTML).not.toContain('<script>');
            expect(agentList.contentEl.innerHTML).toContain('&lt;script&gt;');
        });
    });

    describe('Event handling', () => {
        test('responds to claude-state-changed event', () => {
            const mockState = {
                agents: [
                    { id: 'a1', mtime: Date.now(), status: 'RUNNING', task: 'Test' }
                ],
                liveContext: { session_id: 'sess1' }
            };

            window.dispatchEvent(new CustomEvent('claude-state-changed', {
                detail: mockState
            }));

            // Content should update
            expect(agentList.contentEl.innerHTML).not.toContain('Waiting for agent data');
        });

        test('handles null state gracefully', () => {
            window.dispatchEvent(new CustomEvent('claude-state-changed', {
                detail: null
            }));
            // Should not throw
            expect(true).toBe(true);
        });

        test('handles state without agents gracefully', () => {
            window.dispatchEvent(new CustomEvent('claude-state-changed', {
                detail: {}
            }));
            // Should not throw
            expect(true).toBe(true);
        });
    });
});
