/**
 * UI Integrity Tests
 * Checks if critical DOM elements exist and are visible.
 */
window.runUITests = () => {
    console.log("%cRunning UI Integrity Tests...", "color: cyan; font-weight: bold;");
    const tests = [
        {
            name: "Terminal Container Exists",
            check: () => document.getElementById("main_shell") !== null
        },
        {
            name: "Terminal Height Correct",
            check: () => document.getElementById("main_shell").style.height === "100%" || document.defaultView.getComputedStyle(document.getElementById("main_shell")).height
        },
        {
            name: "Column Left Exists",
            check: () => document.getElementById("mod_column_left") !== null
        },
        {
            name: "Column Right Exists",
            check: () => document.getElementById("mod_column_right") !== null
        },
        {
            name: "Active Agents Widget Present",
            check: () => document.getElementById("mod_agentList") !== null
        },
        {
            name: "Todo Widget Present",
            check: () => document.getElementById("mod_todoWidget") !== null
        }
    ];

    let passed = 0;
    tests.forEach(test => {
        try {
            if (test.check()) {
                console.log(`%c[PASS] ${test.name}`, "color: lime;");
                passed++;
            } else {
                console.warn(`%c[FAIL] ${test.name}`, "color: red;");
            }
        } catch (e) {
            console.error(`%c[ERR] ${test.name}: ${e.message}`, "color: red;");
        }
    });

    if (passed === tests.length) {
        console.log(`%c[UI Tests] All ${passed} tests passed`, "color: lime; font-weight: bold;");
    } else {
        console.warn(`%c[UI Tests] ${tests.length - passed}/${tests.length} tests failed`, "color: red; font-weight: bold;");
    }
};
