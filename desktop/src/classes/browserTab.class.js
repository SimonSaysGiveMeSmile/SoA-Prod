/**
 * BrowserTab - Webview-based browser tab for the terminal tab bar
 * Uses Electron's <webview> tag to load any URL (bypasses main window CSP)
 * Each instance renders a URL bar + navigation buttons above the webview
 */

class BrowserTab {
    constructor(options = {}) {
        this.parentId = options.parentId;
        this.url = options.url || 'https://www.google.com';
        this.history = [this.url];
        this.historyIndex = 0;
        this._destroyed = false;

        this._createContainer();
    }

    _createContainer() {
        const parent = document.getElementById(this.parentId);
        if (!parent) {
            console.error(`[BrowserTab] Parent element ${this.parentId} not found`);
            return;
        }

        // Wrapper holds URL bar + webview
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'browser-tab-wrapper';

        // --- URL bar ---
        this.urlBar = document.createElement('div');
        this.urlBar.className = 'browser-url-bar';

        // Back button
        this.backBtn = document.createElement('button');
        this.backBtn.className = 'browser-nav-btn';
        this.backBtn.innerHTML = '&#9664;'; // ◀
        this.backBtn.title = 'Back';
        this.backBtn.onclick = () => this.back();

        // Forward button
        this.fwdBtn = document.createElement('button');
        this.fwdBtn.className = 'browser-nav-btn';
        this.fwdBtn.innerHTML = '&#9654;'; // ▶
        this.fwdBtn.title = 'Forward';
        this.fwdBtn.onclick = () => this.forward();

        // Refresh button
        this.refreshBtn = document.createElement('button');
        this.refreshBtn.className = 'browser-nav-btn';
        this.refreshBtn.innerHTML = '&#8635;'; // ↻
        this.refreshBtn.title = 'Refresh';
        this.refreshBtn.onclick = () => this.refresh();

        // URL input
        this.urlInput = document.createElement('input');
        this.urlInput.className = 'browser-url-input';
        this.urlInput.type = 'text';
        this.urlInput.value = this.url;
        this.urlInput.spellcheck = false;
        this.urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.navigate(this.urlInput.value);
            }
            // Stop propagation so terminal shortcuts don't fire
            e.stopPropagation();
        });
        // Also stop keyup/keypress from bubbling to terminal/keyboard
        this.urlInput.addEventListener('keyup', (e) => e.stopPropagation());
        this.urlInput.addEventListener('keypress', (e) => e.stopPropagation());

        this.urlBar.appendChild(this.backBtn);
        this.urlBar.appendChild(this.fwdBtn);
        this.urlBar.appendChild(this.refreshBtn);
        this.urlBar.appendChild(this.urlInput);

        // --- Webview ---
        this.webview = document.createElement('webview');
        this.webview.className = 'browser-webview';
        this.webview.setAttribute('src', this.url);
        this.webview.setAttribute('autosize', 'on');
        // Allow all features in the webview guest
        this.webview.setAttribute('allowpopups', '');

        // Track navigation inside webview
        this.webview.addEventListener('did-navigate', (e) => {
            this._onNavigated(e.url);
        });
        this.webview.addEventListener('did-navigate-in-page', (e) => {
            if (e.isMainFrame) this._onNavigated(e.url);
        });
        this.webview.addEventListener('page-title-updated', (e) => {
            this.title = e.title;
            if (this.onTitleChange) this.onTitleChange(e.title);
        });
        this.webview.addEventListener('did-fail-load', (e) => {
            if (e.errorCode !== -3) { // -3 = aborted, ignore
                console.warn(`[BrowserTab] Load failed: ${e.errorDescription} (${e.validatedURL})`);
            }
        });

        this.wrapper.appendChild(this.urlBar);
        this.wrapper.appendChild(this.webview);

        parent.innerHTML = '';
        parent.appendChild(this.wrapper);
    }

    _onNavigated(url) {
        this.url = url;
        this.urlInput.value = url;
        this._updateNavButtons();
    }

    _addToHistory(url) {
        // Trim forward history when navigating to a new URL
        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }
        this.history.push(url);
        this.historyIndex = this.history.length - 1;
    }

    _updateNavButtons() {
        this.backBtn.disabled = !this.webview.canGoBack();
        this.fwdBtn.disabled = !this.webview.canGoForward();
        this.backBtn.style.opacity = this.webview.canGoBack() ? '1' : '0.3';
        this.fwdBtn.style.opacity = this.webview.canGoForward() ? '1' : '0.3';
    }

    navigate(url) {
        if (!url || url.trim() === '') return;
        url = url.trim();

        // Add protocol if missing
        if (!/^https?:\/\//i.test(url) && !/^about:/i.test(url) && !/^file:/i.test(url)) {
            // If it looks like a domain/URL, add https. Otherwise treat as search.
            if (/^localhost[:/]?/.test(url) || /\.\w{2,}/.test(url)) {
                url = 'http://' + url;
            } else {
                url = 'https://' + url;
            }
        }

        this.url = url;
        this.urlInput.value = url;
        this.webview.setAttribute('src', url);
    }

    back() {
        if (this.webview && this.webview.canGoBack()) {
            this.webview.goBack();
        }
    }

    forward() {
        if (this.webview && this.webview.canGoForward()) {
            this.webview.goForward();
        }
    }

    refresh() {
        if (this.webview) {
            this.webview.reload();
        }
    }

    /** No-op — called by focusShellTab for terminal compat */
    fit() {}

    dispose() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this.wrapper && this.wrapper.parentNode) {
            this.wrapper.parentNode.removeChild(this.wrapper);
        }
        this.webview = null;
        this.wrapper = null;
    }
}

// Export for global use
window.BrowserTab = BrowserTab;
