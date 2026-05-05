/**
 * Mock for electron
 */
const remote = require('./electron-remote');

module.exports = {
    ipcRenderer: {
        send: jest.fn(),
        on: jest.fn(),
        once: jest.fn()
    },
    remote: remote,
    webFrame: {
        setVisualZoomLevelLimits: jest.fn()
    },
    shell: {
        openPath: jest.fn()
    }
};
