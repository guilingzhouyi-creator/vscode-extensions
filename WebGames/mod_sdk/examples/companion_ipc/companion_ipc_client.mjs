/**
 * 卡拉尔引擎伴侣跨进程 IPC 客户端示例（纯 Node.js 内置 `node:net` 模块实现）。
 * 协议契约: kalar.companion.ipc.v1（127.0.0.1 本地回环换行分隔 UTF-8 JSON-RPC）。
 */

import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PROTOCOL_VERSION = "kalar.companion.ipc.v1";
const ALLOWED_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export class CompanionIPCError extends Error {
    constructor(errorCode, message) {
        super(`${errorCode}: ${message}`);
        this.name = "CompanionIPCError";
        this.errorCode = errorCode;
    }
}

export class CompanionIPCClient {
    constructor({ host = "127.0.0.1", port = 19420, timeoutMs = 5000 } = {}) {
        if (!ALLOWED_LOOPBACK_HOSTS.has(host)) {
            throw new Error(`出于安全隔离限制，伴侣 IPC 仅允许连接回环地址: ${host}`);
        }
        this.host = host;
        this.port = Number(port);
        this.timeoutMs = Number(timeoutMs);
        this._socket = null;
        this._buffer = "";
        this._sequence = 0;
        this._pending = [];
    }

    async connect() {
        if (this._socket) {
            return;
        }
        await new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: this.host, port: this.port });
            socket.setEncoding("utf8");
            socket.once("error", reject);
            socket.once("connect", () => {
                socket.removeListener("error", reject);
                this._attachSocket(socket);
                resolve();
            });
        });
    }

    _attachSocket(socket) {
        this._socket = socket;
        socket.on("data", (chunk) => {
            this._buffer += chunk;
            this._drainLines();
        });
        socket.on("error", (err) => this._rejectAll(err));
        socket.on("close", () => this._rejectAll(new CompanionIPCError("ERR_IPC_EOF", "IPC connection closed")));
    }

    _drainLines() {
        let newlineIdx = this._buffer.indexOf("\n");
        while (newlineIdx >= 0) {
            const rawLine = this._buffer.slice(0, newlineIdx).trim();
            this._buffer = this._buffer.slice(newlineIdx + 1);
            if (rawLine.length > 0 && this._pending.length > 0) {
                const waiter = this._pending.shift();
                clearTimeout(waiter.timer);
                try {
                    const parsed = JSON.parse(rawLine);
                    if (!parsed.ok) {
                        waiter.reject(new CompanionIPCError(parsed.error_code ?? "ERR_IPC_REMOTE", parsed.message ?? "Remote failure"));
                    } else {
                        waiter.resolve(parsed.payload);
                    }
                } catch (parseErr) {
                    waiter.reject(parseErr);
                }
            }
            newlineIdx = this._buffer.indexOf("\n");
        }
    }

    _rejectAll(error) {
        while (this._pending.length > 0) {
            const waiter = this._pending.shift();
            clearTimeout(waiter.timer);
            waiter.reject(error);
        }
        this._socket = null;
    }

    async request(method, params = {}, authToken = "") {
        await this.connect();
        this._sequence += 1;
        const frame = { id: `node_${this._sequence}`, method, params };
        if (authToken) {
            frame.auth_token = authToken;
        }
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this._pending.findIndex((item) => item.timer === timer);
                if (idx >= 0) {
                    this._pending.splice(idx, 1);
                }
                reject(new CompanionIPCError("ERR_IPC_TIMEOUT", `Timed out calling ${method}`));
            }, this.timeoutMs);
            this._pending.push({ resolve, reject, timer });
            this._socket.write(`${JSON.stringify(frame)}\n`, "utf8");
        });
    }

    authenticate(token) { return this.request("auth", {}, token); }
    ping() { return this.request("ping"); }
    getObservation() { return this.request("get_observation"); }
    step(choiceId, extraParams = {}) { return this.request("step", { ...extraParams, choice_id: choiceId }); }
    rollback() { return this.request("rollback"); }
    inspectBlackbox() { return this.request("inspect_blackbox"); }
    hotReloadPoll() { return this.request("hot_reload_poll"); }
    hotReloadStatus() { return this.request("hot_reload_status"); }

    close() {
        if (this._socket) {
            this._socket.destroy();
            this._socket = null;
        }
        this._buffer = "";
    }
}

function parseCliArgs(argv) {
    const parsed = { host: "127.0.0.1", port: 19420, token: process.env.KALAR_COMPANION_TOKEN ?? "", choice: "", demo: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--host" && argv[i + 1]) { parsed.host = argv[++i]; }
        else if (arg === "--port" && argv[i + 1]) { parsed.port = Number(argv[++i]); }
        else if (arg === "--token" && argv[i + 1]) { parsed.token = argv[++i]; }
        else if (arg === "--choice" && argv[i + 1]) { parsed.choice = argv[++i]; }
        else if (arg === "--demo") { parsed.demo = true; }
    }
    return parsed;
}

async function main() {
    const opts = parseCliArgs(process.argv.slice(2));
    if (!opts.demo) {
        console.log("Usage: node companion_ipc_client.mjs --port 19420 --token <SECRET> --demo [--choice <ID>]");
        return;
    }
    if (!opts.token) {
        console.error("必须通过 --token 或 KALAR_COMPANION_TOKEN 提供会话口令。");
        process.exitCode = 2;
        return;
    }
    const client = new CompanionIPCClient({ host: opts.host, port: opts.port });
    try {
        const authResult = await client.authenticate(opts.token);
        const pingResult = await client.ping();
        const observation = await client.getObservation();
        const blackbox = await client.inspectBlackbox();
        const summary = { protocol: PROTOCOL_VERSION, auth: authResult, ping: pingResult, observation, blackbox };
        if (opts.choice) {
            summary.stepResult = await client.step(opts.choice);
            summary.rollbackResult = await client.rollback();
        }
        console.log(JSON.stringify(summary, null, 2));
    } finally {
        client.close();
    }
}

const currentFile = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
    main().catch((err) => {
        console.error(err?.message ?? err);
        process.exitCode = 1;
    });
}
