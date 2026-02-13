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

        this._buildDOM();
    }

    _buildDOM() {
        const wrapper = document.createElement('div');
        wrapper.id = 'mod_micMonitor';
        wrapper.style.animationPlayState = 'running';
        wrapper.innerHTML = `
            <div id="mod_micMonitor_inner">
                <h1>MIC INPUT</h1>
                <canvas id="mod_micMonitor_canvas" width="200" height="60"></canvas>
                <div class="mic-monitor-info">
                    <span class="mic-monitor-level">—</span>
                    <span class="mic-monitor-status">OFF</span>
                </div>
                <div class="mic-monitor-speech-status">SPEECH: —</div>
            </div>`;
        this.parent.appendChild(wrapper);

        this._canvas = document.getElementById('mod_micMonitor_canvas');
        this._ctx = this._canvas.getContext('2d');
        this._levelEl = wrapper.querySelector('.mic-monitor-level');
        this._statusEl = wrapper.querySelector('.mic-monitor-status');
        this._speechStatusEl = wrapper.querySelector('.mic-monitor-speech-status');
        this._wrapperEl = wrapper;

        // Click delegates to the global mic toggle so everything stays in sync
        wrapper.addEventListener('click', (e) => {
            // Don't toggle if clicking the drag handle
            if (e.target.classList.contains('soa-drag-handle')) return;
            if (window.toggleMic) window.toggleMic();
        });
    }

    async start() {
        if (this._active) return;
        try {
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

        // Draw waveform
        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        const sliceWidth = w / this._dataArray.length;
        let x = 0;
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
        this._peakLevel = Math.max(this._peakLevel * 0.95, dbLevel);
        this._levelEl.textContent = `${dbLevel}% (peak ${Math.round(this._peakLevel)}%)`;

        // Draw level bar at bottom
        const barH = 3;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.3)`;
        ctx.fillRect(0, h - barH, w, barH);
        const levelColor = dbLevel > 5 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, 0.4)`;
        ctx.fillStyle = levelColor;
        ctx.fillRect(0, h - barH, (dbLevel / 100) * w, barH);

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
