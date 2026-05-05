/**
 * Mock for @electron/remote
 */
module.exports = {
    app: {
        getAppPath: jest.fn(() => '/mock/app/path'),
        getPath: jest.fn((name) => `/mock/user/data/${name}`),
        getVersion: jest.fn(() => '2.2.8'),
        focus: jest.fn(),
        relaunch: jest.fn(),
        quit: jest.fn()
    },
    process: {
        argv: []
    },
    screen: {
        getAllDisplays: jest.fn(() => [{ id: 0 }])
    },
    globalShortcut: {
        register: jest.fn(),
        unregisterAll: jest.fn()
    },
    getCurrentWindow: jest.fn(() => ({
        webContents: {
            toggleDevTools: jest.fn()
        },
        isFullScreen: jest.fn(() => false),
        setFullScreen: jest.fn(),
        isMaximized: jest.fn(() => false),
        getSize: jest.fn(() => [1920, 1080]),
        setSize: jest.fn(),
        unmaximize: jest.fn(),
        minimize: jest.fn(),
        on: jest.fn(),
        isDestroyed: jest.fn(() => false)
    })),
    shell: {
        openPath: jest.fn()
    }
};
