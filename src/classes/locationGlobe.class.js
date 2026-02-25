class LocationGlobe {
    constructor(parentId) {
        if (!parentId) throw "Missing parameters";

        const path = require("path");

        this._geodata = require(path.join(__dirname, "assets/misc/grid.json"));
        require(path.join(__dirname, "assets/vendor/encom-globe.js"));
        this.ENCOM = window.ENCOM;

        // Create DOM and include lib
        this.parent = document.getElementById(parentId);
        this.parent.innerHTML += `<div id="mod_globe">
            <div id="mod_globe_innercontainer">
                <h1>WORLD VIEW<i>GLOBAL NETWORK MAP</i></h1>
                <h2>ENDPOINT LAT/LON<i class="mod_globe_headerInfo">0.0000, 0.0000</i></h2>
                <div id="mod_globe_canvas_placeholder"></div>
                <h3>OFFLINE</h3>
            </div>
        </div>`;

        this.lastgeo = {};
        this.conns = [];
        this._lastKnownGoodGeo = null;
        this._ipinfoRetries = 0;


        setTimeout(() => {
            let container = document.getElementById("mod_globe_innercontainer");
            let placeholder = document.getElementById("mod_globe_canvas_placeholder");

            // Create Globe
            this.globe = new this.ENCOM.Globe(placeholder.offsetWidth, placeholder.offsetHeight, {
                font: window.theme.cssvars.font_main,
                data: [],
                tiles: this._geodata.tiles,
                baseColor: window.theme.globe.base || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                markerColor: window.theme.globe.marker || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                pinColor: window.theme.globe.pin || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                satelliteColor: window.theme.globe.satellite || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                scale: 1.1,
                viewAngle: 0.630,
                dayLength: 1000 * 45,
                introLinesDuration: 2000,
                introLinesColor: window.theme.globe.marker || `rgb(${window.theme.r},${window.theme.g},${window.theme.b})`,
                maxPins: 300,
                maxMarkers: 100
            });

            // Place Globe
            placeholder.remove();
            container.append(this.globe.domElement);

            // Init animations
            this._animate = () => {
                if (window.mods.globe.globe) {
                    window.mods.globe.globe.tick();
                }
                if (window.mods.globe._animate) {
                    setTimeout(() => {
                        try {
                            requestAnimationFrame(window.mods.globe._animate);
                        } catch(e) {
                            // We probably got caught in a theme change. Print it out but everything should keep running fine.
                            console.warn(e);
                        }
                    }, 1000 / 30);
                }
            };
            this.globe.init(window.theme.colors.light_black, () => {
                this._animate();
                window.audioManager.scan.play();
            });

            // resize handler
            this.resizeHandler = () => {
                let canvas = document.querySelector("div#mod_globe canvas");
                window.mods.globe.globe.camera.aspect = canvas.offsetWidth / canvas.offsetHeight;
                window.mods.globe.globe.camera.updateProjectionMatrix();
                window.mods.globe.globe.renderer.setSize(canvas.offsetWidth, canvas.offsetHeight);
            };
            window.addEventListener("resize", this.resizeHandler);

            // Connections
            this.conns = [];
            this.addConn = ip => {
                let data = null;
                try {
                    data = window.mods.netstat.geoLookup.get(ip);
                } catch {
                    // do nothing
                }
                let geo = (data !== null ? data.location : {});
                if (geo.latitude && geo.longitude) {
                    const lat = Number(geo.latitude);
                    const lon = Number(geo.longitude);
                    window.mods.globe.conns.push({
                        ip,
                        pin: window.mods.globe.globe.addPin(lat, lon, "", 1.2),
                    });
                }
            };
            this.removeConn = ip => {
                let index = this.conns.findIndex(x => x.ip === ip);
                this.conns[index].pin.remove();
                this.conns.splice(index, 1);
            };

            // Add random satellites
            let constellation = [];
            for(var i = 0; i< 2; i++){
                for(var j = 0; j< 3; j++){
                    constellation.push({
                        lat: 50 * i - 30 + 15 * Math.random(),
                        lon: 120 * j - 120 + 30 * i,
                        altitude: Math.random() * (1.7 - 1.3) + 1.3
                    });
                }
            }

            this.globe.addConstellation(constellation);
        }, 2000);

        // Init updaters when intro animation is done
        setTimeout(() => {
            this.updateLoc();
            this.locUpdater = setInterval(() => {
                this.updateLoc();
            }, 1000);

            this.updateConns();
            this.connsUpdater = setInterval(() => {
                this.updateConns();
            }, 3000);
        }, 4000);
    }

    addRandomConnectedMarkers() {
        const randomLat = this.getRandomInRange(40, 90, 3);
        const randomLong = this.getRandomInRange(-180, 0, 3);
        this.globe.addMarker(randomLat, randomLong, '');
        this.globe.addMarker(randomLat - 20, randomLong + 150, '', true);
    }
    addTemporaryConnectedMarker(ip) {
        if (!window.mods.netstat || !window.mods.netstat.geoLookup) return;
        let data = window.mods.netstat.geoLookup.get(ip);
        let geo = (data !== null ? data.location : {});
        if (geo.latitude && geo.longitude) {
            const lat = Number(geo.latitude);
            const lon = Number(geo.longitude);

            window.mods.globe.conns.push({
                ip,
                pin: window.mods.globe.globe.addPin(lat, lon, "", 1.2)
            });
            let mark = window.mods.globe.globe.addMarker(lat, lon, '', true);
            setTimeout(() => {
                mark.remove();
            }, 3000);
        }
    }
    removeMarkers() {
        this.globe.markers.forEach(marker => { marker.remove(); });
        this.globe.markers = [];
    }
    removePins() {
        this.globe.pins.forEach(pin => {
            pin.remove();
        });
        this.globe.pins = [];
    }
    getRandomInRange(from, to, fixed) {
        return (Math.random() * (to - from) + from).toFixed(fixed) * 1;
    }
    updateLoc() {
        if (!window.mods.netstat) {
            // Netstat not loaded yet, use mock data
            this.updateWithMockData();
            return;
        }

        if (window.settings.debug) {
            console.log("[Globe] updateLoc: offline=", window.mods.netstat.offline);
            console.log("[Globe] updateLoc: ipinfo=", window.mods.netstat.ipinfo);
        }

        if (window.mods.netstat.offline) {
            // Transient offline: if we have cached geo and browser says online, use cache
            if (this._lastKnownGoodGeo && navigator.onLine) {
                this.updateWithCachedData();
            } else {
                this.updateWithMockData();
            }
        } else if (!window.mods.netstat.ipinfo) {
            // ipinfo not ready yet (async HTTP call still pending)
            this._ipinfoRetries++;
            if (this._ipinfoRetries > 15) {
                // Give up waiting — fall back to cached or mock
                if (window.settings.debug) console.log("[Globe] ipinfo retries exhausted, falling back");
                if (this._lastKnownGoodGeo) {
                    this.updateWithCachedData();
                } else {
                    this.updateWithMockData();
                }
                this._ipinfoRetries = 0;
            } else if (window.settings.debug) {
                console.log(`[Globe] ipinfo not ready, retry ${this._ipinfoRetries}/15`);
            }
            // Don't add extra setTimeout — the existing 1s setInterval handles polling
        } else if (!window.mods.netstat.ipinfo.geo) {
            // ipinfo exists but geo is null (geoLookup couldn't locate the IP)
            // Show IP coordinates as unknown rather than mock
            if (window.settings.debug) console.log("[Globe] ipinfo.geo is null, showing coordinates as unknown");
            this.updateWithUnknownGeo();
        } else {
            this.updateConOnlineConnection().then(() => {
                document.querySelector("div#mod_globe").setAttribute("class", "");
            }).catch(() => {
                // Fallback to mock data on connection error
                this.updateWithMockData();
            })
        }
    }
    updateWithMockData() {
        // Mock location data (San Francisco coordinates as default)
        const mockGeo = {
            latitude: 37.7749,
            longitude: -122.4194
        };

        document.querySelector("div#mod_globe").setAttribute("class", "");
        document.querySelector("i.mod_globe_headerInfo").innerText = `${mockGeo.latitude}, ${mockGeo.longitude} (MOCK)`;

        if (mockGeo.latitude !== this.lastgeo.latitude || mockGeo.longitude !== this.lastgeo.longitude) {
            this.removePins();
            this.removeMarkers();
            this.conns = [];

            this._locPin = this.globe.addPin(mockGeo.latitude, mockGeo.longitude, "", 1.2);
            this._locMarker = this.globe.addMarker(mockGeo.latitude, mockGeo.longitude, "", false, 1.2);
        }
        this.lastgeo = mockGeo;
    }
    updateWithCachedData() {
        const cached = this._lastKnownGoodGeo;
        document.querySelector("div#mod_globe").setAttribute("class", "");
        document.querySelector("i.mod_globe_headerInfo").innerText = `${cached.latitude}, ${cached.longitude} (CACHED)`;

        if (cached.latitude !== this.lastgeo.latitude || cached.longitude !== this.lastgeo.longitude) {
            this.removePins();
            this.removeMarkers();
            this.conns = [];

            this._locPin = this.globe.addPin(cached.latitude, cached.longitude, "", 1.2);
            this._locMarker = this.globe.addMarker(cached.latitude, cached.longitude, "", false, 1.2);
        }
        this.lastgeo = cached;
    }
    updateWithUnknownGeo() {
        // Have IP but geoLookup couldn't locate it - show unknown coordinates
        // Use a default location (0, 0) but without "(MOCK)" to indicate we're online
        const unknownGeo = {
            latitude: 0,
            longitude: 0
        };

        document.querySelector("div#mod_globe").setAttribute("class", "");
        document.querySelector("i.mod_globe_headerInfo").innerText = `IP: ${window.mods.netstat.ipinfo.ip} (GEO N/A)`;

        if (unknownGeo.latitude !== this.lastgeo.latitude || unknownGeo.longitude !== this.lastgeo.longitude) {
            this.removePins();
            this.removeMarkers();
            this.conns = [];

            // Still add a pin at (0,0) to show the globe is active
            this._locPin = this.globe.addPin(unknownGeo.latitude, unknownGeo.longitude, "", 1.2);
            this._locMarker = this.globe.addMarker(unknownGeo.latitude, unknownGeo.longitude, "", false, 1.2);
        }
        this.lastgeo = unknownGeo;
    }
    async updateConOnlineConnection() {
        let newgeo = window.mods.netstat.ipinfo.geo;
        newgeo.latitude = Math.round(newgeo.latitude*10000)/10000;
        newgeo.longitude = Math.round(newgeo.longitude*10000)/10000;

        // Cache this as last known good location
        this._lastKnownGoodGeo = { latitude: newgeo.latitude, longitude: newgeo.longitude };
        this._ipinfoRetries = 0;

        if (newgeo.latitude !== this.lastgeo.latitude || newgeo.longitude !== this.lastgeo.longitude) {

            document.querySelector("i.mod_globe_headerInfo").innerText = `${newgeo.latitude}, ${newgeo.longitude}`;
            this.removePins();
            this.removeMarkers();
            //this.addRandomConnectedPoints();
            this.conns = [];

            this._locPin = this.globe.addPin(newgeo.latitude, newgeo.longitude, "", 1.2);
            this._locMarker = this.globe.addMarker(newgeo.latitude, newgeo.longitude, "", false, 1.2);
        }

        this.lastgeo = newgeo;
        document.querySelector("div#mod_globe").setAttribute("class", "");
    }
    updateConns() {
        if (!window.mods.globe || !window.mods.globe.globe || !window.mods.netstat || window.mods.netstat.offline) return false;
        window.si.networkConnections().then(conns => {
            let newconns = [];
            conns.forEach(conn => {
                let ip = conn.peeraddress;
                let state = conn.state;
                if (state === "ESTABLISHED" && ip !== "0.0.0.0" && ip !== "127.0.0.1" && ip !== "::") {
                    newconns.push(ip);
                }
            });

            this.conns.forEach(conn => {
                if (newconns.indexOf(conn.ip) !== -1) {
                    newconns.splice(newconns.indexOf(conn.ip), 1);
                } else {
                    this.removeConn(conn.ip);
                }
            });

            newconns.forEach(ip => {
                this.addConn(ip);
            });
        }).catch(err => {
            console.error("LocationGlobe connections update error:", err);
        });
    }
}

module.exports = {
    LocationGlobe
};
