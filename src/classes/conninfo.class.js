function formatBytesPerSec(bytesPerSec) {
    if (bytesPerSec === 0) return '0 B/s';
    if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
    if (bytesPerSec < 1048576) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
}

class Conninfo {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        // Create DOM
        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_conninfo">
            <div id="mod_conninfo_innercontainer">
                <h1>NETWORK TRAFFIC<i>UP / DOWN</i></h1>
                <h2>TOTAL<i>0B OUT, 0B IN</i></h2>
                <div id="mod_conninfo_legend">
                    <span id="mod_conninfo_legend_up" class="mod_conninfo_legend_item">
                        <span class="mod_conninfo_legend_swatch upload"></span>
                        <span class="mod_conninfo_legend_label">UP: 0 B/s</span>
                    </span>
                    <span id="mod_conninfo_legend_down" class="mod_conninfo_legend_item">
                        <span class="mod_conninfo_legend_swatch download"></span>
                        <span class="mod_conninfo_legend_label">DOWN: 0 B/s</span>
                    </span>
                </div>
                <canvas id="mod_conninfo_canvas"></canvas>
                <div id="mod_conninfo_error" style="display:none;">Network data unavailable</div>
                <h3>OFFLINE</h3>
            </div>
        </div>`;

        this.current = document.querySelector("#mod_conninfo_innercontainer > h1 > i");
        this.total = document.querySelector("#mod_conninfo_innercontainer > h2 > i");
        this._pb = require("pretty-bytes");
        this._staleCount = 0;

        // Init Smoothie
        let TimeSeries = require("smoothie").TimeSeries;
        let SmoothieChart = require("smoothie").SmoothieChart;

        // Set chart options -- single chart with zero baseline and auto-scaling Y-axis
        let chartOptions = {
            limitFPS: 40,
            responsive: true,
            millisPerPixel: 50,
            interpolation: 'linear',
            minValue: 0,
            grid: {
                millisPerLine: 5000,
                fillStyle: 'transparent',
                strokeStyle: `rgba(${window.theme.r},${window.theme.g},${window.theme.b},0.4)`,
                verticalSections: 3,
                borderVisible: false
            },
            labels: {
                fontSize: 10,
                fillStyle: `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                precision: 2
            },
            yMaxFormatter: (max) => formatBytesPerSec(max),
            yMinFormatter: (min) => formatBytesPerSec(min)
        };

        // Create single chart with two time series
        this.downloadSeries = new TimeSeries();
        this.uploadSeries = new TimeSeries();
        this.chart = new SmoothieChart(chartOptions);

        // Download series added first (renders behind)
        this.chart.addTimeSeries(this.downloadSeries, {
            lineWidth: 1.7,
            strokeStyle: `rgba(${window.theme.r},${window.theme.g},${window.theme.b},0.8)`,
            fillStyle: `rgba(${window.theme.r},${window.theme.g},${window.theme.b},0.3)`
        });

        // Upload series added second (renders on top)
        this.chart.addTimeSeries(this.uploadSeries, {
            lineWidth: 1.7,
            strokeStyle: `rgba(${window.theme.r},${window.theme.g},${window.theme.b},0.5)`,
            fillStyle: `rgba(${window.theme.r},${window.theme.g},${window.theme.b},0.15)`
        });

        this.chart.streamTo(document.getElementById("mod_conninfo_canvas"), 1000);

        // Init updater
        this.updateInfo();
        this.infoUpdater = setInterval(() => {
            this.updateInfo();
        }, 1000);
    }
    updateInfo() {
        let time = new Date().getTime();
        const conninfoEl = document.querySelector("div#mod_conninfo");

        if (window.mods.netstat.offline) {
            this.uploadSeries.append(time, 0);
            this.downloadSeries.append(time, 0);
            conninfoEl.setAttribute("class", "offline");
            return;
        }
        conninfoEl.setAttribute("class", "");

        window.si.networkStats().then(data => {
            // Hide error, show canvas on successful response
            document.getElementById("mod_conninfo_error").style.display = "none";
            document.getElementById("mod_conninfo_canvas").style.display = "";

            if (!data || data.length === 0) {
                // No network interfaces detected
                document.getElementById("mod_conninfo_error").textContent = "No network interfaces";
                document.getElementById("mod_conninfo_error").style.display = "flex";
                document.getElementById("mod_conninfo_canvas").style.display = "none";
                return;
            }

            let totalTxSec = 0;
            let totalRxSec = 0;
            let totalTxBytes = 0;
            let totalRxBytes = 0;
            let hasValidData = false;

            data.forEach(iface => {
                if (iface.tx_sec !== null && iface.rx_sec !== null) {
                    totalTxSec += iface.tx_sec;
                    totalRxSec += iface.rx_sec;
                    hasValidData = true;
                }
                totalTxBytes += iface.tx_bytes;
                totalRxBytes += iface.rx_bytes;
            });

            if (!hasValidData) {
                // Don't append -- creates visible gap in chart
                this._staleCount++;
            } else {
                this.uploadSeries.append(time, totalTxSec);
                this.downloadSeries.append(time, totalRxSec);
                this._staleCount = 0;
            }

            // Stale data indicator -- dim chart after 5 consecutive calls without valid data
            if (this._staleCount > 5) {
                conninfoEl.classList.add("stale");
            } else {
                conninfoEl.classList.remove("stale");
            }

            // Update legend with live values
            document.querySelector("#mod_conninfo_legend_up .mod_conninfo_legend_label").textContent =
                "UP: " + formatBytesPerSec(totalTxSec);
            document.querySelector("#mod_conninfo_legend_down .mod_conninfo_legend_label").textContent =
                "DOWN: " + formatBytesPerSec(totalRxSec);

            // Update totals and current subtitle
            this.total.innerText = `${this._pb(totalTxBytes)} OUT, ${this._pb(totalRxBytes)} IN`.toUpperCase();
            this.current.innerText = "UP " + formatBytesPerSec(totalTxSec) + " / DOWN " + formatBytesPerSec(totalRxSec);
        }).catch(err => {
            console.error("Conninfo update error:", err);
            document.getElementById("mod_conninfo_error").style.display = "flex";
            document.getElementById("mod_conninfo_canvas").style.display = "none";
        });
    }
}

module.exports = {
    Conninfo
};
