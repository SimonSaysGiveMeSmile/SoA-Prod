/**
 * Startup Performance Profiler
 *
 * Provides performance instrumentation for measuring startup time.
 * Uses Node.js performance API (perf_hooks) for precise timing.
 *
 * Environment Variables:
 *   PROFILE_STARTUP=true  - Enable console logging of performance marks
 *   PROFILE_STARTUP=deep  - Enable contentTracing (main process only)
 *
 * Usage:
 *   const profiler = require('./performance/startupProfiler');
 *   profiler.mark('boot-start');
 *   // ... work ...
 *   profiler.mark('window-created');
 *   profiler.measure('window-creation', 'boot-start', 'window-created');
 *   profiler.logSummary();
 */

const { performance, PerformanceObserver } = require('perf_hooks');

// Configuration
const PROFILE_ENABLED = process.env.PROFILE_STARTUP === 'true' || process.env.PROFILE_STARTUP === 'deep';
const PROFILE_DEEP = process.env.PROFILE_STARTUP === 'deep';

// Storage
const marks = new Map();
const measures = new Map();

// Process detection
const isMainProcess = process.type === 'browser';

// ContentTracing (main process only)
let tracingActive = false;

/**
 * Mark a specific point in time
 * @param {string} name - Mark name
 */
function mark(name) {
    const timestamp = performance.now();
    performance.mark(name);
    marks.set(name, timestamp);

    if (PROFILE_ENABLED) {
        console.log(`[PERF] Mark: ${name} at ${timestamp.toFixed(2)}ms`);
    }
}

/**
 * Measure duration between two marks
 * @param {string} name - Measure name
 * @param {string} startMark - Start mark name
 * @param {string} endMark - End mark name
 * @returns {number} Duration in milliseconds
 */
function measure(name, startMark, endMark) {
    try {
        performance.measure(name, startMark, endMark);
        const startTime = marks.get(startMark);
        const endTime = marks.get(endMark);

        if (startTime !== undefined && endTime !== undefined) {
            const duration = endTime - startTime;
            measures.set(name, { startMark, endMark, duration });

            if (PROFILE_ENABLED) {
                console.log(`[PERF] Measure: ${name} = ${duration.toFixed(2)}ms (${startMark} -> ${endMark})`);
            }

            return duration;
        }

        return 0;
    } catch (error) {
        console.error(`[PERF] Failed to measure ${name}:`, error.message);
        return 0;
    }
}

/**
 * Get all collected metrics
 * @returns {Object} Object containing marks and measures
 */
function getMetrics() {
    return {
        marks: Array.from(marks.entries()).map(([name, timestamp]) => ({ name, timestamp })),
        measures: Array.from(measures.entries()).map(([name, data]) => ({ name, ...data })),
        processType: isMainProcess ? 'main' : 'renderer'
    };
}

/**
 * Log formatted summary table of all measurements
 */
function logSummary() {
    if (measures.size === 0) {
        console.log('[PERF] No measurements to display');
        return;
    }

    console.log('\n┌─────────────────────────────────────────────────────┐');
    console.log('│           STARTUP PERFORMANCE SUMMARY              │');
    console.log('├─────────────────────────────────────────────────────┤');

    const processLabel = isMainProcess ? 'MAIN PROCESS' : 'RENDERER PROCESS';
    console.log(`│ Process: ${processLabel.padEnd(41)} │`);
    console.log('├─────────────────────────────────────────────────────┤');
    console.log('│ Phase                           │ Duration (ms)     │');
    console.log('├─────────────────────────────────┼───────────────────┤');

    // Sort measures by start time
    const sortedMeasures = Array.from(measures.entries()).sort((a, b) => {
        const startA = marks.get(a[1].startMark) || 0;
        const startB = marks.get(b[1].startMark) || 0;
        return startA - startB;
    });

    for (const [name, data] of sortedMeasures) {
        const namePadded = name.padEnd(31).substring(0, 31);
        const durationPadded = data.duration.toFixed(2).padStart(17);
        console.log(`│ ${namePadded} │ ${durationPadded} │`);
    }

    console.log('└─────────────────────────────────┴───────────────────┘');

    // Calculate total if we have a total measure
    const totalMeasure = measures.get('main-total') || measures.get('renderer-total');
    if (totalMeasure) {
        console.log(`\nTotal startup time: ${totalMeasure.duration.toFixed(2)}ms`);
    }

    console.log('');
}

/**
 * Start contentTracing (main process only, deep profiling)
 * Saves trace to userData/startup-trace.json
 */
async function startTracing() {
    if (!isMainProcess) {
        console.warn('[PERF] contentTracing only available in main process');
        return false;
    }

    if (!PROFILE_DEEP) {
        return false;
    }

    try {
        const { app, contentTracing } = require('electron');
        const path = require('path');
        const fs = require('fs');

        await contentTracing.startRecording({
            included_categories: ['*']
        });

        tracingActive = true;
        console.log('[PERF] ContentTracing started');
        return true;
    } catch (error) {
        console.error('[PERF] Failed to start contentTracing:', error.message);
        return false;
    }
}

/**
 * Stop contentTracing and save trace file
 */
async function stopTracing() {
    if (!isMainProcess || !tracingActive) {
        return null;
    }

    try {
        const { app, contentTracing } = require('electron');
        const path = require('path');
        const fs = require('fs');

        const tracePath = path.join(app.getPath('userData'), 'startup-trace.json');
        const traceBuffer = await contentTracing.stopRecording();

        fs.writeFileSync(tracePath, traceBuffer);
        tracingActive = false;

        console.log(`[PERF] ContentTracing saved to: ${tracePath}`);
        return tracePath;
    } catch (error) {
        console.error('[PERF] Failed to stop contentTracing:', error.message);
        return null;
    }
}

module.exports = {
    mark,
    measure,
    getMetrics,
    logSummary,
    startTracing,
    stopTracing
};
