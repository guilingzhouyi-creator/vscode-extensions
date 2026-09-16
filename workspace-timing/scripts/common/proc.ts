// @wt-script common/proc
// @purpose 子进程执行封装：超时强杀、UTF-8 捕获、退出码与耗时——外部工具调用的唯一通道
// @origin native（超时能力补齐 WebGames 桥接器无超时的已知缺口）
// @usage import { run } from './proc.js'
// @exit 不适用（库模块）

import { spawn } from 'node:child_process';

export interface RunResult {
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
    error: Error | null;
}

export interface RunOptions {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
}

/**
 * 执行一条命令。
 * @param cmd argv 数组（cmd[0] 为可执行文件；不做 shell 拼接，杜绝注入面）
 */
export function run(cmd: string[], { cwd, timeoutMs = 120000, env = {} }: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve) => {
        const started = Date.now();
        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(cmd[0], cmd.slice(1), {
                cwd,
                env: { ...process.env, ...env },
                windowsHide: true,
            });
        } catch (err) {
            resolve({ code: -1, stdout: '', stderr: String((err as Error).message), timedOut: false, durationMs: 0, error: err as Error });
            return;
        }

        let stdout = '';
        let stderr = '';
        let settled = false;
        let timer: NodeJS.Timeout | null = null;
        const finish = (code: number | null, timedOut = false, error: Error | null = null): void => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve({ code, stdout, stderr, timedOut, durationMs: Date.now() - started, error });
        };

        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                timedKill(child);
                finish(null, true, new Error(`超时（>${timeoutMs}ms）已强杀: ${cmd.join(' ')}`));
            }, timeoutMs);
        }

        child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
        child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
        child.on('error', (err: Error) => finish(-1, false, err));
        child.on('close', (code) => finish(code ?? -1, false, null));
    });
}

/** Windows 下子进程可能再生孙进程，用 taskkill 断树；POSIX 用 SIGTERM */
function timedKill(child: ReturnType<typeof spawn>): void {
    try {
        if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
        } else {
            child.kill('SIGTERM');
        }
    } catch { /* 尽力而为：强杀失败不影响超时结论 */ }
}
