/**
 * MicMonitor - Live microphone waveform display for the side panel
 * Shows real-time audio input levels to diagnose mic capture issues.
 */
class MicMonitor {
    constructor(parentId) {
        this.parent = document.getElementById(parentId);
        if (!this.parent) return;

        this._stream = null;
        this._audioCtx = null;
        this._analyser = null;
        this._dataArray = null;
        this._animFrame = null;
        this._canvas = null;
        this._ctx = null;
        this._active = false;
        this._peakLevel = 0;
        this._selectedDeviceId = null;
        this._prevWaveform = null; // sustain buffer

        this._buildDOM();
    }

    _buildDOM() {
        const wrapper = document.createElement('div');
        wrapper.id = 'mod_micMonitor';
        wrapper.style.animationPlayState = 'running';
        wrapper.innerHTML = `
            <div id="mod_micMonitor_inner">
                <div class="mic-monitor-header">
                    <h1>MIC INPUT</h1>
                    <span class="mic-monitor-gear" title="Input Source">&#9881;</span>
                </div>
                <canvas id="mod_micMonitor_canvas" width="200" height="60"></canvas>
                <div class="mic-monitor-info">
                    <span class="mic-monitor-level">—</span>
                    <span class="mic-monitor-status">OFF</span>
                </div>
                <div class="mic-monitor-source-label">Source: Default</div>
                <div class="mic-monitor-speech-status">SPEECH: —</div>
            </div>
            <div class="mic-monitor-source-overlay" style="display:none;">
                <div class="mic-monitor-source-overlay__title">INPUT SOURCE</div>
                <div class="mic-monitor-source-overlay__list"></div>
            </div>`;
        // Insert right after credit display (which is at the top)
        const creditDisplay = this.parent.querySelector('#mod_creditDisplay');
        if (creditDisplay && creditDisplay.nextSibling) {
            this.parent.insertBefore(wrapper, creditDisplay.nextSibling);
        } else if (creditDisplay) {
            this.parent.appendChild(wrapper);
        } else {
            // Fallback: insert at top if credit display hasn't loaded yet
            const firstWidget = this.parent.querySelector(':scope > div');
            if (firstWidget) {
                this.parent.insertBefore(wrapper, firstWidget);
            } else {
                this.parent.appendChild(wrapper);
            }
        }

        this._canvas = document.getElementById('mod_micMonitor_canvas');
        this._ctx = this._canvas.getContext('2d');
        this._levelEl = wrapper.querySelector('.mic-monitor-level');
        this._statusEl = wrapper.querySelector('.mic-monitor-status');
        this._speechStatusEl = wrapper.querySelector('.mic-monitor-speech-status');
        this._sourceLabel = wrapper.querySelector('.mic-monitor-source-label');
        this._sourceOverlay = wrapper.querySelector('.mic-monitor-source-overlay');
        this._sourceList = wrapper.querySelector('.mic-monitor-source-overlay__list');
        this._wrapperEl = wrapper;

        // Gear button opens input source overlay
        wrapper.querySelector('.mic-monitor-gear').addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleSourceOverlay();
        });

        // Click delegates to the global mic toggle so everything stays in sync
        wrapper.addEventListener('click', (e) => {
            // Don't toggle if clicking the drag handle, gear, or source overlay
            if (e.target.classList.contains('soa-drag-handle')) return;
            if (e.target.closest('.mic-monitor-gear')) return;
            if (e.target.closest('.mic-monitor-source-overlay')) return;
            if (window.toggleMic) window.toggleMic();
        });
    }

    async _toggleSourceOverlay() {
        const visible = this._sourceOverlay.style.display !== 'none';
        if (visible) {
            this._sourceOverlay.style.display = 'none';
            return;
        }
        // Enumerate audio input devices
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            this._sourceList.innerHTML = '';
            audioInputs.forEach(device => {
                const item = document.createElement('div');
                item.className = 'mic-monitor-source-overlay__item';
                if (this._selectedDeviceId === device.deviceId ||
                    (!this._selectedDeviceId && device.deviceId === 'default')) {
                    item.classList.add('mic-monitor-source-overlay__item--active');
                }
                item.textContent = device.label || `Microphone (${device.deviceId.substring(0, 8)})`;
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._selectDevice(device.deviceId, item.textContent);
                });
                this._sourceList.appendChild(item);
            });
        } catch (e) {
            this._sourceList.innerHTML = '<div class="mic-monitor-source-overlay__item">No devices found</div>';
        }
        this._sourceOverlay.style.display = '';
    }

    _selectDevice(deviceId, label) {
        this._selectedDeviceId = deviceId;
        this._sourceLabel.textContent = `Source: ${label}`;
        this._sourceOverlay.style.display = 'none';
        // Restart stream with new device if active
        if (this._active) {
            this.stop();
            this.start();
        }
    }

    async start() {
        if (this._active) return;
        try {
            const constraints = { audio: this._selectedDeviceId
                ? { deviceId: { exact: this._selectedDeviceId } }
                : true };
            this._stream = await navigator.mediaDevices.getUserMedia(constraints);
            this._audioCtx = new AudioContext();
            const source = this._audioCtx.createMediaStreamSource(this._stream);

            this._analyser = this._audioCtx.createAnalyser();
            this._analyser.fftSize = 256;
            this._dataArray = new Uint8Array(this._analyser.frequencyBinCount);
            source.connect(this._analyser);

            this._active = true;
            this._statusEl.textContent = 'LIVE';
            this._statusEl.classList.add('mic-monitor-status--live');

            // Scale canvas for retina
            const dpr = window.devicePixelRatio || 1;
            const rect = this._canvas.getBoundingClientRect();
            this._canvas.width = rect.width * dpr;
            this._canvas.height = rect.height * dpr;
            this._ctx.scale(dpr, dpr);
            this._drawWidth = rect.width;
            this._drawHeight = rect.height;

            this._draw();
            console.log('[MicMonitor] Started');
        } catch (e) {
            console.error('[MicMonitor] Failed to start:', e.message);
            this._statusEl.textContent = 'ERROR';
        }
    }

    stop() {
        this._active = false;
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
        if (this._audioCtx) {
            this._audioCtx.close();
            this._audioCtx = null;
        }
        this._analyser = null;
        this._prevWaveform = null;
        this._statusEl.textContent = 'OFF';
        this._statusEl.classList.remove('mic-monitor-status--live');
        this._levelEl.textContent = '—';
        if (this._speechStatusEl) this._speechStatusEl.textContent = 'SPEECH: —';

        // Clear canvas
        if (this._ctx && this._canvas) {
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        }
        console.log('[MicMonitor] Stopped');
    }

    toggle() {
        if (this._active) {
            this.stop();
        } else {
            this.start();
        }
    }

    _draw() {
        if (!this._active || !this._analyser) return;

        this._analyser.getByteTimeDomainData(this._dataArray);

        // Sustain: blend current frame with previous (keep 92% of old displacement)
        if (!this._prevWaveform) {
            this._prevWaveform = new Uint8Array(this._dataArray.length);
            this._prevWaveform.fill(128);
        }
        const sustain = 0.92;
        for (let i = 0; i < this._dataArray.length; i++) {
            const cur = this._dataArray[i] - 128;
            const prev = this._prevWaveform[i] - 128;
            // Keep whichever displacement is larger, with decay on previous
            const blended = Math.abs(cur) >= Math.abs(prev * sustain)
                ? cur : prev * sustain;
            this._prevWaveform[i] = 128 + blended;
        }

        const canvas = this._canvas;
        const ctx = this._ctx;
        const w = this._drawWidth || canvas.width;
        const h = this._drawHeight || canvas.height;

        // Get CSS color variables
        const style = getComputedStyle(document.documentElement);
        const r = style.getPropertyValue('--color_r').trim();
        const g = style.getPropertyValue('--color_g').trim();
        const b = style.getPropertyValue('--color_b').trim();

        ctx.clearRect(0, 0, w, h);

        // Draw center line
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // Draw sustained waveform (faded)
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const sliceWidth = w / this._prevWaveform.length;
        let x = 0;
        for (let i = 0; i < this._prevWaveform.length; i++) {
            const v = this._prevWaveform[i] / 128.0;
            const y = (v * h) / 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            x += sliceWidth;
        }
        ctx.stroke();

        // Draw current waveform
        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        x = 0;
        let rmsSum = 0;

        for (let i = 0; i < this._dataArray.length; i++) {
            const v = this._dataArray[i] / 128.0;
            const y = (v * h) / 2;
            rmsSum += (v - 1) * (v - 1);

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }
        ctx.stroke();

        // Calculate RMS level
        const rms = Math.sqrt(rmsSum / this._dataArray.length);
        const dbLevel = Math.round(rms * 100);
        const maxLevel = 30;
        this._peakLevel = Math.max(this._peakLevel * 0.985, dbLevel);
        this._levelEl.textContent = `${dbLevel}% (peak ${Math.round(this._peakLevel)}%)`;

        // Draw level bar at bottom
        const barH = 3;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
        ctx.fillRect(0, h - barH, w, barH);
        const levelColor = dbLevel > 5 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, 0.4)`;
        ctx.fillStyle = levelColor;
        ctx.fillRect(0, h - barH, Math.min(dbLevel / maxLevel, 1) * w, barH);

        this._animFrame = requestAnimationFrame(() => this._draw());
    }

    release() {
        this.stop();
        if (this._wrapperEl && this._wrapperEl.parentNode) {
            this._wrapperEl.parentNode.removeChild(this._wrapperEl);
        }
    }

    /** Update the speech recognition status line (called from voice controller callbacks) */
    setSpeechStatus(status) {
        if (this._speechStatusEl) {
            this._speechStatusEl.textContent = `SPEECH: ${status}`;
        }
    }
}

module.exports = { MicMonitor };
