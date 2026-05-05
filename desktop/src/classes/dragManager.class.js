/**
 * DragManager - Enables drag-and-drop reordering of panel widgets
 *
 * Makes every widget tile in the left/right columns independently draggable.
 * Supports cross-column moves and persists layout to localStorage.
 */

class DragManager {
    constructor(options = {}) {
        this.columns = {
            left: document.getElementById('mod_column_left'),
            right: document.getElementById('mod_column_right')
        };
        // v2: single-column layout — invalidate any previously saved two-column orders so the
        // new default priority (FileExplorer/Globe on top) isn't overridden by stale state.
        this.storageKey = options.storageKey || 'soa_widget_order_v2';
        this._draggedEl = null;
        this._placeholder = null;
        this._boundHandlers = {};

        this._init();
    }

    _init() {
        this._restoreOrder();
        this._makeWidgetsDraggable();
        this._setupColumnDropZones();
    }

    /** Mark every direct child div in both columns as draggable */
    _makeWidgetsDraggable() {
        Object.values(this.columns).forEach(col => {
            if (!col) return;
            Array.from(col.children).forEach(child => {
                if (child.tagName === 'DIV') this._enableDrag(child);
            });
        });
    }

    _enableDrag(el) {
        el.setAttribute('draggable', 'true');
        el.classList.add('soa-draggable');

        // Inject drag handle if not already present
        if (!el.querySelector('.soa-drag-handle')) {
            const handle = document.createElement('div');
            handle.className = 'soa-drag-handle';
            handle.innerHTML = '⠿';
            handle.title = 'Drag to reorder';
            el.style.position = 'relative';
            el.appendChild(handle);
        }

        el.addEventListener('dragstart', this._onDragStart.bind(this));
        el.addEventListener('dragend', this._onDragEnd.bind(this));
    }

    /** Create a translucent placeholder shown at the drop target */
    _createPlaceholder() {
        const ph = document.createElement('div');
        ph.className = 'soa-drop-placeholder';
        return ph;
    }

    // --- Drag event handlers ---

    _onDragStart(e) {
        this._draggedEl = e.currentTarget;
        this._draggedEl.classList.add('soa-dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Use a tiny transparent image so the browser ghost doesn't clash
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);
        this._placeholder = this._createPlaceholder();
    }

    _onDragEnd(_e) {
        if (this._draggedEl) {
            this._draggedEl.classList.remove('soa-dragging');
        }
        if (this._placeholder && this._placeholder.parentNode) {
            this._placeholder.parentNode.removeChild(this._placeholder);
        }
        this._draggedEl = null;
        this._placeholder = null;
        this._saveOrder();
    }

    /** Set up dragover / drop listeners on both columns */
    _setupColumnDropZones() {
        Object.values(this.columns).forEach(col => {
            if (!col) return;
            col.addEventListener('dragover', this._onDragOver.bind(this));
            col.addEventListener('drop', this._onDrop.bind(this));
            col.addEventListener('dragleave', this._onDragLeave.bind(this));
        });
    }

    _onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!this._draggedEl || !this._placeholder) return;

        const col = e.currentTarget;
        const widgets = Array.from(col.children).filter(
            c => c.tagName === 'DIV' && c !== this._draggedEl && !c.classList.contains('soa-drop-placeholder')
        );

        // Find the widget we're hovering closest to
        let insertBefore = null;
        for (const w of widgets) {
            const rect = w.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                insertBefore = w;
                break;
            }
        }

        // Place the placeholder
        if (insertBefore) {
            col.insertBefore(this._placeholder, insertBefore);
        } else {
            col.appendChild(this._placeholder);
        }
    }

    _onDrop(e) {
        e.preventDefault();
        if (!this._draggedEl || !this._placeholder) return;

        const col = e.currentTarget;
        // Insert the dragged element where the placeholder is
        col.insertBefore(this._draggedEl, this._placeholder);

        if (this._placeholder.parentNode) {
            this._placeholder.parentNode.removeChild(this._placeholder);
        }
        this._draggedEl.classList.remove('soa-dragging');
        this._saveOrder();
    }

    _onDragLeave(e) {
        // Only remove placeholder when actually leaving the column
        if (!e.currentTarget.contains(e.relatedTarget)) {
            if (this._placeholder && this._placeholder.parentNode === e.currentTarget) {
                e.currentTarget.removeChild(this._placeholder);
            }
        }
    }

    // --- Persistence ---

    _getWidgetId(el) {
        return el.id || el.getAttribute('data-widget');
    }

    _saveOrder() {
        const order = {};
        ['left', 'right'].forEach(side => {
            const col = this.columns[side];
            if (!col) return;
            order[side] = Array.from(col.children)
                .filter(c => c.tagName === 'DIV' && !c.classList.contains('soa-drop-placeholder'))
                .map(c => this._getWidgetId(c))
                .filter(Boolean);
        });
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(order));
        } catch (_) { /* storage full or unavailable */ }
    }

    _restoreOrder() {
        let order;
        try {
            order = JSON.parse(localStorage.getItem(this.storageKey));
        } catch (_) { return; }
        if (!order) return;

        ['left', 'right'].forEach(side => {
            const col = this.columns[side];
            const ids = order[side];
            if (!col || !ids || !ids.length) return;

            // Collect all widget divs currently in EITHER column
            const allWidgets = {};
            Object.values(this.columns).forEach(c => {
                if (!c) return;
                Array.from(c.children).forEach(child => {
                    if (child.tagName === 'DIV') {
                        const id = this._getWidgetId(child);
                        if (id) allWidgets[id] = child;
                    }
                });
            });

            // Re-append in saved order
            ids.forEach(id => {
                const widget = allWidgets[id];
                if (widget) col.appendChild(widget);
            });
        });
    }

    /** Call after dynamically adding a new widget to make it draggable */
    register(el) {
        if (el && el.tagName === 'DIV') this._enableDrag(el);
    }

    /** Reset to default order (clears saved layout) */
    reset() {
        try { localStorage.removeItem(this.storageKey); } catch (_) {}
        window.location.reload();
    }
}

module.exports = { DragManager };
