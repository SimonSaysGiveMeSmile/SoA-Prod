class Netstat {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        // Create DOM
        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_netstat">
            <div id="mod_netstat_inner">
                <h1>NETWORK STATUS<i id="mod_netstat_iname"></i></h1>
                <div id="mod_netstat_innercontainer">
                    <div>
                        <h1>STATE</h1>
                        <h2>UNKNOWN</h2>
                    </div>
                    <div>
                        <h1>IPv4</h1>
                        <h2>--.--.--.--</h2>
                    </div>
                    <div>
                        <h1>PING</h1>
                        <h2>--ms</h2>
                    </div>
                </div>
            </div>
        </div>`;

        this.offline = false;
        this.lastconn = { finished: false }; // Prevent geoip lookup attempt until maxminddb is loaded
        this.iface = null;
        this.failedAttempts = {};
        this.runsBeforeGeoIPUpdate = 0;

        this._httpsAgent = new require("https").Agent({
            keepAlive: false,
            maxSockets: 10
        });

        // Init updaters
        this.updateInfo();
        this.infoUpdater = setInterval(() => {
            this.updateInfo();
        }, 2000);

        // Init GeoIP integrated backend
        this.geoLookup = {
            get: () => null
        };
        let geolite2 = require("geolite2-redist");
        let maxmind = require("maxmind");
        geolite2.downloadDbs(require("path").join(require("@electron/remote").app.getPath("userData"), "geoIPcache")).then(() => {
            geolite2.open('GeoLite2-City', path => {
                return maxmind.open(path);
            }).then(lookup => {
                this.geoLookup = lookup;
                this.lastconn.finished = true;
            }).catch(e => {
                console.error("[Netstat] GeoIP database open failed:", e.message || e);
                this.lastconn.finished = true;
            });
        }).catch(e => {
            console.error("[Netstat] GeoIP database download failed:", e.message || e);
            this.lastconn.finished = true;
        });
    }
    updateInfo() {
        window.si.networkInterfaces().then(async data => {
            if (window.settings.debug) console.log("[Netstat] Interfaces detected:", JSON.stringify(data, null, 2));
            if (!data || data.length === 0) {
                if (window.settings.debug) console.log("[Netstat] No network interfaces detected");
                this.iface = null;
                this.offline = true;
                document.getElementById("mod_netstat_iname").innerText = "Interface: (offline)";
                document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "OFFLINE";
                document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = "--.--.--.--";
                document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = "--ms";
                return;
            }

            let offline = false;
            let net = data[0];
            let netID = 0;

            if (typeof window.settings.iface === "string") {
                while (net.iface !== window.settings.iface) {
                    netID++;
                    if (data[netID]) {
                        net = data[netID];
                    } else {
                        // No detected interface has the custom iface name, fallback to automatic detection on next loop
                        window.settings.iface = false;
                        return false;
                    }
                }
            } else {
                // Find the first external, IPv4 connected networkInterface that has a MAC address set
                const isWindows = require("os").type() === "Windows_NT";
                if (window.settings.debug) {
                    console.log("[Netstat] === Interface Detection Start ===");
                    console.log("[Netstat] OS:", require("os").type());
                    console.log("[Netstat] Total interfaces:", data.length);
                    data.forEach((iface, idx) => {
                        console.log(`[Netstat] [${idx}] ${iface.iface}: operstate=${iface.operstate}, internal=${iface.internal}, ip4=${iface.ip4}, mac=${iface.mac ? iface.mac.substring(0,8)+'...' : 'none'}`);
                    });
                    console.log("[Netstat] Searching for valid interface...");
                }

                // Windows: Accept "unknown" operstate and don't require MAC
                // Other OS: Keep strict requirements
                const isValidInterface = (iface) => {
                    if (iface.internal === true) return false;
                    if (iface.ip4 === "") return false;
                    if (isWindows) {
                        // Windows: operstate is often "unknown" for active interfaces
                        return iface.operstate === "up" || iface.operstate === "unknown";
                    } else {
                        // Linux/Mac: require "up" and MAC address
                        return iface.operstate === "up" && iface.mac !== "";
                    }
                };

                // Prioritize interfaces: prefer those with typical private IP ranges
                const prioritizeInterfaces = (interfaces) => {
                    return interfaces.slice().sort((a, b) => {
                        const scoreIface = (iface) => {
                            if (!iface.ip4) return 0;
                            // Prefer common private ranges
                            if (iface.ip4.startsWith("192.168.")) return 100;
                            if (iface.ip4.startsWith("10.")) return 90;
                            if (iface.ip4.match(/^172\.(1[6-9]|2[0-9]|3[01])\./)) return 80;
                            // Valid non-private IP
                            if (iface.ip4 !== "127.0.0.1") return 50;
                            return 0;
                        };
                        return scoreIface(b) - scoreIface(a);
                    });
                };

                // Apply prioritization on Windows (where multiple valid interfaces common)
                if (isWindows) {
                    data = prioritizeInterfaces(data);
                    net = data[0];
                    netID = 0;
                    if (window.settings.debug) console.log("[Netstat] Interfaces prioritized by IP range");
                }

                while (!isValidInterface(net)) {
                    if (window.settings.debug) console.log(`[Netstat] Skipping ${net.iface}: operstate=${net.operstate}, internal=${net.internal}, ip4=${net.ip4}, mac=${net.mac}`);
                    netID++;
                    if (data[netID]) {
                        net = data[netID];
                    } else {
                        // No external connection!
                        if (window.settings.debug) console.log("[Netstat] No valid interface found - going offline");
                        this.iface = null;
                        document.getElementById("mod_netstat_iname").innerText = "Interface: (offline)";

                        this.offline = true;
                        document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "OFFLINE";
                        document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = "--.--.--.--";
                        document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = "--ms";
                        break;
                    }
                }
                if (!this.offline && window.settings.debug) console.log(`[Netstat] Selected interface: ${net.iface}, ip4=${net.ip4}`);
            }

            if (net.ip4 !== this.internalIPv4) this.runsBeforeGeoIPUpdate = 0;

            this.iface = net.iface;
            this.internalIPv4 = net.ip4;
            document.getElementById("mod_netstat_iname").innerText = "Interface: " + net.iface;

            if (net.ip4 === "127.0.0.1") {
                offline = true;
            } else {
                if (this.runsBeforeGeoIPUpdate === 0 && this.lastconn.finished) {
                    const externalIpService = window.settings.externalIpService || { host: "myexternalip.com", port: 443, path: "/json" };
                    this.lastconn = require("https").get({ host: externalIpService.host, port: externalIpService.port, path: externalIpService.path, localAddress: net.ip4, agent: this._httpsAgent }, res => {
                        let rawData = "";
                        res.on("data", chunk => {
                            rawData += chunk;
                        });
                        res.on("end", () => {
                            try {
                                let data = JSON.parse(rawData);
                                if (window.settings.debug) console.log("[Netstat] External IP response:", rawData);

                                // Safely get geo data - geoLookup.get() may return null
                                const geoData = this.geoLookup.get(data.ip);
                                const geo = geoData && geoData.location ? geoData.location : null;

                                if (window.settings.debug) console.log("[Netstat] GeoLookup result for", data.ip, ":", geoData ? "found" : "null");

                                this.ipinfo = {
                                    ip: data.ip,
                                    geo: geo
                                };

                                let ip = this.ipinfo.ip;
                                document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = window._escapeHtml(ip);

                                this.runsBeforeGeoIPUpdate = 10;
                            } catch (e) {
                                this.failedAttempts[e] = (this.failedAttempts[e] || 0) + 1;
                                if (this.failedAttempts[e] > 2) return false;
                                console.warn(e);
                                console.info(rawData.toString());
                                let electron = require("electron");
                                electron.ipcRenderer.send("log", "note", "NetStat: Error parsing data from external IP service");
                                electron.ipcRenderer.send("log", "debug", `Error: ${e}`);
                            }
                        });
                    }).on("error", e => {
                        // HTTP request failed - log for debugging
                        if (window.settings.debug) console.log("[Netstat] HTTP error fetching external IP:", e.message);
                    });
                } else if (this.runsBeforeGeoIPUpdate !== 0) {
                    this.runsBeforeGeoIPUpdate = this.runsBeforeGeoIPUpdate - 1;
                }

                let p = await this.ping(window.settings.pingAddr || "1.1.1.1", 80, net.ip4).catch((e) => {
                    if (window.settings.debug) console.log(`[Netstat] Ping failed: ${e.message}`);
                    offline = true;
                });

                this.offline = offline;
                if (offline) {
                    document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "OFFLINE";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = "--.--.--.--";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = "--ms";
                } else {
                    document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "ONLINE";
                    document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = Math.round(p) + "ms";
                }
            }
        }).catch(err => {
            console.error("Netstat update error:", err);
            this.offline = true;
            document.getElementById("mod_netstat_iname").innerText = "Interface: (error)";
            document.querySelector("#mod_netstat_innercontainer > div:first-child > h2").innerHTML = "OFFLINE";
            document.querySelector("#mod_netstat_innercontainer > div:nth-child(2) > h2").innerHTML = "--.--.--.--";
            document.querySelector("#mod_netstat_innercontainer > div:nth-child(3) > h2").innerHTML = "--ms";
        });
    }
    ping(target, port, local) {
        return new Promise((resolve, reject) => {
            let s = new require("net").Socket();
            let start = process.hrtime();

            s.connect({
                port,
                host: target,
                localAddress: local,
                family: 4
            }, () => {
                let time_arr = process.hrtime(start);
                let time = (time_arr[0] * 1e9 + time_arr[1]) / 1e6;
                resolve(time);
                s.destroy();
            });
            s.on('error', e => {
                s.destroy();
                reject(e);
            });
            s.setTimeout(1900, function () {
                s.destroy();
                reject(new Error("Socket timeout"));
            });
        });
    }
}

module.exports = {
    Netstat
};
