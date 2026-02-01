/**
 * WidgetLoader - Orchestrates staged widget loading for performance
 *
 * Widgets are categorized by weight:
 * - lightweight: No system calls, fast initialization (Clock)
 * - heavy: Uses systeminformation or network calls (Cpuinfo, Netstat, Globe, etc.)
 * - deferred: Lightweight but needs to be last in DOM (AgentList, TodoWidget for bottom positioning)
 *
 * Loading strategy:
 * 1. Terminal loads first (critical path)
 * 2. Lightweight widgets load immediately after
 * 3. Heavy widgets load with staggered timing after terminal is interactive
 * 4. Deferred widgets load last (ensures bottom DOM position)
 */

class WidgetLoader {
    constructor(options = {}) {
        this.profiler = options.profiler || null;
        this.staggerDelay = options.staggerDelay || 100;  // ms between heavy widgets
        this.mods = {};

        // Widget registry with weight classification
        this.widgetRegistry = {
            // Left column
            clock: { column: 'left', weight: 'lightweight', class: null },
            sysinfo: { column: 'left', weight: 'heavy', class: null },
            hardwareInspector: { column: 'left', weight: 'heavy', class: null },
            cpuinfo: { column: 'left', weight: 'heavy', class: null },
            ramwatcher: { column: 'left', weight: 'heavy', class: null },
            toplist: { column: 'left', weight: 'heavy', class: null },

            // Right column
            netstat: { column: 'right', weight: 'heavy', class: null },
            globe: { column: 'right', weight: 'heavy', class: null },
            conninfo: { column: 'right', weight: 'heavy', class: null },
            todoWidget: { column: 'right', weight: 'deferred', class: null },
            agentList: { column: 'left', weight: 'deferred', class: null }
        };
    }

    /**
     * Register widget classes (call this with actual class references)
     */
    registerWidgets(widgets) {
        Object.entries(widgets).forEach(([name, cls]) => {
            if (this.widgetRegistry[name]) {
                this.widgetRegistry[name].class = cls;
            }
        });
    }

    /**
     * Get column ID for a widget
     */
    getColumnId(widgetName) {
        const widget = this.widgetRegistry[widgetName];
        return widget ? `mod_column_${widget.column}` : null;
    }

    /**
     * Load lightweight widgets immediately (no staggering)
     * Returns array of loaded widget names
     */
    loadLightweight() {
        if (this.profiler) this.profiler.mark('lightweight-widgets-start');

        const loaded = [];
        Object.entries(this.widgetRegistry)
            .filter(([_, config]) => config.weight === 'lightweight' && config.class)
            .forEach(([name, config]) => {
                try {
                    this.mods[name] = new config.class(this.getColumnId(name));
                    loaded.push(name);
                } catch (e) {
                    console.error(`[WidgetLoader] Failed to load ${name}:`, e.message);
                }
            });

        if (this.profiler) {
            this.profiler.mark('lightweight-widgets-end');
            this.profiler.measure('lightweight-widgets', 'lightweight-widgets-start', 'lightweight-widgets-end');
        }

        return loaded;
    }

    /**
     * Load heavy widgets with staggered timing
     * Returns promise that resolves when all heavy widgets are loaded
     */
    loadHeavyDeferred() {
        return new Promise((resolve) => {
            if (this.profiler) this.profiler.mark('heavy-widgets-start');

            // Load order: visual positioning takes priority for right column
            // Right column order: netstat first (top), globe, conninfo, then todoWidget (deferred)
            // Left column: sysinfo first (fast), then cpu/ram/toplist, hardwareInspector last (slowest)
            const loadOrder = ['sysinfo', 'netstat', 'globe', 'conninfo', 'cpuinfo', 'ramwatcher', 'toplist', 'hardwareInspector'];

            const heavyWidgets = loadOrder
                .map(name => [name, this.widgetRegistry[name]])
                .filter(([_, config]) => config && config.weight === 'heavy' && config.class);

            if (heavyWidgets.length === 0) {
                if (this.profiler) this.profiler.mark('heavy-widgets-end');
                resolve([]);
                return;
            }

            const loaded = [];
            let index = 0;

            const loadNext = () => {
                if (index >= heavyWidgets.length) {
                    if (this.profiler) {
                        this.profiler.mark('heavy-widgets-end');
                        this.profiler.measure('heavy-widgets', 'heavy-widgets-start', 'heavy-widgets-end');
                    }
                    resolve(loaded);
                    return;
                }

                const [name, config] = heavyWidgets[index];

                // Per-widget profiling
                if (this.profiler) this.profiler.mark(`widget-${name}-start`);

                try {
                    this.mods[name] = new config.class(this.getColumnId(name));
                    loaded.push(name);
                } catch (e) {
                    console.error(`[WidgetLoader] Failed to load ${name}:`, e.message);
                }

                if (this.profiler) {
                    this.profiler.mark(`widget-${name}-end`);
                    this.profiler.measure(`widget-${name}`, `widget-${name}-start`, `widget-${name}-end`);
                }

                index++;
                setTimeout(loadNext, this.staggerDelay);
            };

            // Use requestIdleCallback if available, otherwise setTimeout
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(loadNext);
            } else {
                setTimeout(loadNext, 0);
            }
        });
    }

    /**
     * Load deferred widgets after heavy widgets (for bottom positioning)
     * These are lightweight widgets that need to be last in DOM order
     */
    loadDeferred() {
        if (this.profiler) this.profiler.mark('deferred-widgets-start');

        const loaded = [];
        Object.entries(this.widgetRegistry)
            .filter(([_, config]) => config.weight === 'deferred' && config.class)
            .forEach(([name, config]) => {
                try {
                    this.mods[name] = new config.class(this.getColumnId(name));
                    loaded.push(name);
                } catch (e) {
                    console.error(`[WidgetLoader] Failed to load ${name}:`, e.message);
                }
            });

        if (this.profiler) {
            this.profiler.mark('deferred-widgets-end');
            this.profiler.measure('deferred-widgets', 'deferred-widgets-start', 'deferred-widgets-end');
        }

        return loaded;
    }

    /**
     * Load all widgets with proper staging
     * Returns promise with all loaded widget names
     */
    async loadAll() {
        const lightweight = this.loadLightweight();
        const heavy = await this.loadHeavyDeferred();
        const deferred = this.loadDeferred();
        return { lightweight, heavy, deferred, mods: this.mods };
    }

    /**
     * Get loaded modules object (for window.mods assignment)
     */
    getMods() {
        return this.mods;
    }
}

module.exports = { WidgetLoader };
