/**
 * Jest Test Setup
 * Configures JSDOM environment and global mocks for Electron app testing
 */

// Mock window.claudeState
global.window.claudeState = null;
global.window.terminalSessions = {};
global.window.currentTerm = 0;
global.window.settings = {
    claudeApiKey: null,
    sessionLimitTokens: 1000000,
    weeklyLimitTokens: 10000000
};

// Mock CustomEvent if not available
if (typeof CustomEvent === 'undefined') {
    global.CustomEvent = class CustomEvent extends Event {
        constructor(type, params = {}) {
            super(type, params);
            this.detail = params.detail;
        }
    };
}

// Mock console methods to suppress noise during tests (optional)
// global.console.debug = jest.fn();

// Helper to create mock DOM elements
global.createMockParent = (id) => {
    const parent = document.createElement('div');
    parent.id = id;
    document.body.appendChild(parent);
    return parent;
};

// Cleanup after each test
afterEach(() => {
    document.body.innerHTML = '';
    window.claudeState = null;
    window.terminalSessions = {};
    jest.clearAllMocks();
});
