class DeviceStatus {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        this.parent = document.getElementById(parentId);
        this._element = document.createElement("div");
        this._element.setAttribute("id", "mod_deviceStatus");
        this._element.innerHTML = `<div id="mod_deviceStatus_inner">
            <div>
                <h1>BATTERY</h1>
                <h2 id="mod_deviceStatus_battery">--</h2>
            </div>
            <div>
                <h1>NETWORK</h1>
                <h2 id="mod_deviceStatus_net">--</h2>
            </div>
            <div>
                <h1>CPU °C</h1>
                <h2 id="mod_deviceStatus_cpu_temp">--</h2>
            </div>
            <div>
                <h1>GPU °C</h1>
                <h2 id="mod_deviceStatus_gpu_temp">--</h2>
            </div>
        </div>`;
        this.parent.append(this._element);

        // Shared state read by mobileBridge._collectWidgetData()
        this._last = null;

        this._update();
        this._timer = setInterval(() => this._update(), 10000);
    }

    _update() {
        Promise.all([
            window.si.battery().catch(() => null),
            window.si.cpuTemperature().catch(() => null),
            window.si.graphics().catch(() => null),
        ]).then(([bat, cpuTemp, gfx]) => {
            // Battery
            let batText = 'N/A';
            if (bat && bat.hasBattery) {
                if (bat.isCharging) batText = 'CHARGE';
                else if (bat.acConnected) batText = 'WIRED';
                else batText = bat.percent + '%';
            } else if (bat) {
                batText = 'ON';
            }

            // Network (reads from netstat if available)
            const netText = (window.mods && window.mods.netstat)
                ? (window.mods.netstat.offline ? 'OFFLINE' : 'ONLINE')
                : '--';

            // CPU temp
            const cpuTempVal = (cpuTemp && cpuTemp.max != null) ? cpuTemp.max : null;
            const cpuText = cpuTempVal !== null ? cpuTempVal + '°' : 'N/A';

            // GPU temp — first controller with a valid temp
            let gpuTempVal = null;
            if (gfx && gfx.controllers) {
                for (const c of gfx.controllers) {
                    if (c.temperatureGpu != null && c.temperatureGpu > 0) {
                        gpuTempVal = c.temperatureGpu;
                        break;
                    }
                }
            }
            const gpuText = gpuTempVal !== null ? gpuTempVal + '°' : 'N/A';

            // Update DOM
            const el = id => document.getElementById(id);
            if (el('mod_deviceStatus_battery')) el('mod_deviceStatus_battery').innerText = batText;
            if (el('mod_deviceStatus_net'))     el('mod_deviceStatus_net').innerText     = netText;
            if (el('mod_deviceStatus_cpu_temp'))el('mod_deviceStatus_cpu_temp').innerText= cpuText;
            if (el('mod_deviceStatus_gpu_temp'))el('mod_deviceStatus_gpu_temp').innerText= gpuText;

            // Expose for mobile bridge
            this._last = {
                battery: bat && bat.hasBattery ? {
                    percent: bat.percent,
                    isCharging: bat.isCharging,
                    acConnected: bat.acConnected,
                    label: batText,
                } : { label: batText },
                network: netText,
                cpuTemp: cpuTempVal,
                gpuTemp: gpuTempVal,
            };
        });
    }
}

module.exports = { DeviceStatus };
