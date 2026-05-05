/**
 * Mobile Bridge Protocol
 *
 * Shared message schema between the Son of Anton desktop and the mobile companion app.
 * Both sides import this so that message types stay in sync.
 *
 * Wire format: JSON over WebSocket. Every frame has the shape
 *
 *     { v: 1, t: <type>, d: <payload>, id?: <correlation id> }
 *
 * The `v` field is a protocol version we can bump if we ever change the schema.
 */

const PROTOCOL_VERSION = 1;

const MSG = Object.freeze({
    // ── server → client ────────────────────────────────────────────────
    HELLO:      'hello',       // initial handshake; payload includes session info
    SNAPSHOT:   'snapshot',    // full UI state snapshot (sent on connect & on big changes)
    PATCH:      'patch',       // incremental state diff
    TERM_DATA:  'term-data',   // raw terminal output for the active terminal
    NOTICE:     'notice',      // human-readable notification (info/warn/error)
    PONG:       'pong',
    BYE:        'bye',         // server intends to close

    // ── client → server ────────────────────────────────────────────────
    AUTH:       'auth',        // (reserved; token is sent in the WS URL today)
    INPUT:      'input',       // user input from mobile (see INPUT_KIND)
    PING:       'ping',
    REQUEST:    'request',     // request a fresh snapshot, etc.
});

const INPUT_KIND = Object.freeze({
    TERM_KEYS:      'term-keys',     // { text }
    TERM_RESIZE:    'term-resize',   // { cols, rows }
    SWITCH_TAB:     'switch-tab',    // { index }
    NEW_TAB:        'new-tab',
    CLOSE_TAB:      'close-tab',     // { index }
    MOVE_TAB:       'move-tab',      // { index, before }  — place tab `index` immediately before tab `before` (-1 = end)
    HOTKEY:         'hotkey',        // { combo: 'ctrl+c' }
    VOICE_TOGGLE:   'voice-toggle',
    SHELL_COMMAND:  'shell-command', // { line }   appended with \n
});

function frame(type, data, id) {
    const f = { v: PROTOCOL_VERSION, t: type, d: data == null ? {} : data };
    if (id) f.id = id;
    return JSON.stringify(f);
}

function parse(raw) {
    try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object' || typeof obj.t !== 'string') return null;
        if (obj.v && obj.v !== PROTOCOL_VERSION) return null;
        return obj;
    } catch (_) {
        return null;
    }
}

module.exports = {
    PROTOCOL_VERSION,
    MSG,
    INPUT_KIND,
    frame,
    parse,
};
