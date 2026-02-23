/**
 * BrowserTab - Internal browser iframe wrapper
 * Provides browser functionality in a dedicated tab
 * Controlled via terminal commands: browse <url>, back, forward, refresh
 */

class BrowserTab {
    constructor(options = {}) {
        this.id = options.id || 'browser0';
        this.parentId = options.parentId || 'browser0';
        this.url = options.url || 'about:blank';
        this.history = [this.url];
        this.historyIndex = 0;

        this._createContainer();
        this._setupIPC();
    }

    _createContainer() {
        const parent = document.getElementById(this.parentId);
        if (!parent) {
            console.error(`[BrowserTab] Parent element ${this.parentId} not found`);
            return;
        }

        this.iframe = document.createElement('iframe');
        this.iframe.id = this.id;
        this.iframe.src = this.url;
        this.iframe.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
            background: #000;
        `;

        parent.innerHTML = '';
        parent.appendChild(this.iframe);

        // Listen for iframe navigation events
        this.iframe.addEventListener('load', () => {
            try {
                this.url = this.iframe.contentWindow.location.href;
                this._updateHistory(this.url);
            } catch (e) {
                // Cross-origin restriction - can't read URL
            }
        });
    }

    _setupIPC() {
        // Handle browser IPC commands (window.ipc strips the event arg)
        window.ipc.on('browser:navigate', (url) => {
            this.navigate(url);
        });

        window.ipc.on('browser:back', () => {
            this.back();
        });

        window.ipc.on('browser:forward', () => {
            this.forward();
        });

        window.ipc.on('browser:refresh', () => {
            this.refresh();
        });

        window.ipc.on('browser:url', () => {
            window.ipc.send('browser:url-reply', this.url);
        });
    }

    _updateHistory(url) {
        // Remove forward history when navigating to a new URL
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(url);
        this.historyIndex = this.history.length - 1;
    }

    navigate(url) {
        if (!url || url.trim() === '') {
            // Just "browse" - show the browser
            this.show();
            return;
        }

        // Add protocol if missing
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
            url = 'https://' + url;
        }

        try {
            this.iframe.src = url;
            this.url = url;
            this._updateHistory(url);
            console.log(`[BrowserTab] Navigated to: ${url}`);
        } catch (e) {
            console.error(`[BrowserTab] Navigation failed: ${e.message}`);
        }
    }

    back() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.iframe.src = this.history[this.historyIndex];
            this.url = this.history[this.historyIndex];
        }
    }

    forward() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.iframe.src = this.history[this.historyIndex];
            this.url = this.history[this.historyIndex];
        }
    }

    refresh() {
        this.iframe.src = this.iframe.src;
    }

    show() {
        const parent = document.getElementById(this.parentId);
        if (parent) {
            parent.style.display = 'block';
        }
    }

    hide() {
        const parent = document.getElementById(this.parentId);
        if (parent) {
            parent.style.display = 'none';
        }
    }

    canGoBack() {
        return this.historyIndex > 0;
    }

    canGoForward() {
        return this.historyIndex < this.history.length - 1;
    }

    getUrl() {
        return this.url;
    }

    dispose() {
        if (this.iframe && this.iframe.parentNode) {
            this.iframe.parentNode.removeChild(this.iframe);
        }
        this.iframe = null;
    }
}

// Export for global use
window.BrowserTab = BrowserTab;
