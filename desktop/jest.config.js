/** @type {import('jest').Config} */
const config = {
    testEnvironment: 'jsdom',
    testMatch: ['**/tests/**/*.test.js'],
    moduleFileExtensions: ['js', 'json'],
    // Avoid haste map collision between root and src package.json
    modulePathIgnorePatterns: ['<rootDir>/src/package.json', '<rootDir>/prebuild-src/'],
    testPathIgnorePatterns: ['/node_modules/', '/src/node_modules/'],
    collectCoverageFrom: [
        'src/classes/**/*.js',
        '!src/classes/terminal.class.js',  // Requires pty
        '!src/classes/filesystem.class.js', // Requires electron
        '!**/node_modules/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    verbose: true,
    testTimeout: 10000,
    // Mock electron modules
    moduleNameMapper: {
        '^@electron/remote$': '<rootDir>/tests/mocks/electron-remote.js',
        '^electron$': '<rootDir>/tests/mocks/electron.js'
    }
};

module.exports = config;
