const cluster = require("cluster");

if (cluster.isMaster) {
    const electron = require("electron");
    const ipc = electron.ipcMain;
    const signale = require("signale");
    // Also, leave a core available for the renderer process
    const osCPUs = require("os").cpus().length - 1;
    // Cap at 4 workers — more than that just adds fork overhead and steals cycles from the renderer.
    // See #904
    const numCPUs = Math.max(1, Math.min(4, osCPUs));

    const si = require("systeminformation");

    const STATEFUL_SI_FUNCTIONS = ['networkStats', 'fsStats', 'disksIO'];

    cluster.setupMaster({
        exec: require("path").join(__dirname, "_multithread.js")
    });

    let workers = [];
    cluster.on("fork", worker => {
        workers.push(worker.id);
    });

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    signale.success("Multithreaded controller ready");

    cluster.on("exit", (worker, code, signal) => {
        signale.warn(`[SI] Worker ${worker.id} (pid ${worker.process.pid}) exited: code=${code} signal=${signal}`);
    });

    var lastID = 0;

    function dispatch(type, id, arg) {
        let selectedID = lastID+1;
        if (selectedID > numCPUs-1) selectedID = 0;

        const worker = cluster.workers[workers[selectedID]];
        if (!worker || worker.isDead()) {
            // Worker died — fall back to main-process call
            si[type](arg).then(res => {
                try {
                    if (queue[id] && !queue[id].isDestroyed()) {
                        queue[id].send("systeminformation-reply-"+id, res);
                        delete queue[id];
                    }
                } catch(e) { /* sender gone, ignore */ }
            }).catch(err => {
                signale.error(`[SI] Fallback ${type} failed:`, err.message);
                delete queue[id];
            });
            lastID = selectedID;
            return;
        }

        worker.send(JSON.stringify({
            id,
            type,
            arg
        }));

        lastID = selectedID;
    }

    var queue = {};
    var siCallCount = 0;
    ipc.on("systeminformation-call", (e, type, id, ...args) => {
        siCallCount++;
        if (siCallCount <= 20) signale.info(`[SI] Call #${siCallCount}: ${type} (id=${id.substring(0,6)})`);

        if (!si[type]) {
            signale.warn("Illegal request for systeminformation: " + type);
            return;
        }

        if (STATEFUL_SI_FUNCTIONS.includes(type) || args.length > 1 || workers.length <= 0) {
            si[type](...args).then(res => {
                if (e.sender && !e.sender.isDestroyed()) {
                    e.sender.send("systeminformation-reply-"+id, res);
                }
            }).catch(err => {
                signale.error(`[SI] ${type} failed:`, err.message);
            });
        } else {
            queue[id] = e.sender;
            dispatch(type, id, args[0]);
        }
    });

    cluster.on("message", (worker, msg) => {
        msg = JSON.parse(msg);
        try {
            if (queue[msg.id] && !queue[msg.id].isDestroyed()) {
                queue[msg.id].send("systeminformation-reply-"+msg.id, msg.res);
            }
            delete queue[msg.id];
        } catch(e) {
            signale.warn("[SI] Reply delivery failed:", e.message);
            delete queue[msg.id];
        }
    });
} else if (cluster.isWorker) {
    const signale = require("signale");
    const si = require("systeminformation");

    signale.info("Multithread worker started at "+process.pid);

    process.on("message", msg => {
        msg = JSON.parse(msg);
        si[msg.type](msg.arg).then(res => {
            process.send(JSON.stringify({
                id: msg.id,
                res
            }));
        }).catch(err => {
            // Send null result so the queue doesn't hang forever
            process.send(JSON.stringify({
                id: msg.id,
                res: null
            }));
        });
    });
}
