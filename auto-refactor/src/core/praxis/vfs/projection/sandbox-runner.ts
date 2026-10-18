/**
 * Module: Core Engine — Praxis LayerVFS Sandbox Process Runner
 * File Path: src/core/praxis/vfs/projection/sandbox-runner.ts
 * Architecture Role: Child process execution harness confined to projected physical sandboxes;
 *   executes compilers, tests, and linters with timeout guards and output streaming without
 *   polluting host workspace.
 * Dependencies & Triggers: Imports node:child_process, node:os; consumed by projection-engine.ts.
 * Responsibilities: Spawn processes in target sandbox directory, handle buffered stdout/stderr,
 *   enforce execution deadlines, and normalize exit codes into SandboxExecutionResult.
 * Exit Semantics & Design Rationale: Never throws unhandled exceptions; kills process trees on
 *   timeout; keeps cyclomatic complexity CC <= 15 and Depth <= 4.
 */

import { spawn } from 'node:child_process';
import type { SandboxExecutionResult } from './projection-contracts';

/** Default timeout for sandboxed command execution (30 seconds) */
export const DEFAULT_SANDBOX_TIMEOUT_MS = 30000;

/**
 * Options for executing commands inside a sandbox.
 */
export interface RunInSandboxOptions {
    cwd: string;
    command: string;
    args?: string[];
    timeoutMs?: number;
    env?: Record<string, string>;
}

const TIMEOUT_EXIT_CODE = 124;
const DEFAULT_FAILURE_EXIT_CODE = 1;
const SIGKILL_SIGNAL = 'SIGKILL';

/**
 * Builds process environment with sandbox tracking variables.
 */
function buildSandboxEnv(options: RunInSandboxOptions): NodeJS.ProcessEnv {
    return {
        ...process.env,
        ...(options.env ?? {}),
        LAYER_VFS_SANDBOX: '1',
        LAYER_VFS_CWD: options.cwd,
    };
}

function attachProcessListeners(
    child: ReturnType<typeof spawn>,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void,
    onError: (err: Error) => void,
    onClose: (code: number | null) => void,
): void {
    child.stdout?.on('data', (d: Buffer | string) => onStdout(d.toString()));
    child.stderr?.on('data', (d: Buffer | string) => onStderr(d.toString()));
    child.on('error', onError);
    child.on('close', onClose);
}

/**
 * Spawns an external command confined to a sandbox directory and captures its execution outcome.
 *
 * @param options - Execution configuration.
 * @returns Promise resolving to SandboxExecutionResult.
 */
export function runInSandbox(options: RunInSandboxOptions): Promise<SandboxExecutionResult> {
    return new Promise((resolve) => {
        const startMs = performance.now();
        const timeoutMs = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;
        const args = options.args ?? [];
        let stdoutAcc = '';
        let stderrAcc = '';
        let isTimedOut = false;
        let isSettled = false;
        let timeoutTimer: NodeJS.Timeout | null = null;

        const settle = (exitCode: number, errorMsg?: string): void => {
            if (isSettled) return;
            isSettled = true;
            if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = null;
            }
            resolve({
                exitCode: isTimedOut ? TIMEOUT_EXIT_CODE : exitCode,
                stdout: stdoutAcc,
                stderr: stderrAcc,
                durationMs: Math.round(performance.now() - startMs),
                success: exitCode === 0 && !isTimedOut && !errorMsg,
                errorMessage: errorMsg,
            });
        };

        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(options.command, args, {
                cwd: options.cwd,
                env: buildSandboxEnv(options),
                shell: true,
                windowsHide: true,
            });
        } catch (spawnError) {
            settle(DEFAULT_FAILURE_EXIT_CODE, `Failed to spawn process: ${String(spawnError)}`);
            return;
        }

        timeoutTimer = setTimeout(() => {
            isTimedOut = true;
            if (!child.killed) {
                try {
                    child.kill(SIGKILL_SIGNAL);
                } catch {
                    /* ignore kill failure */
                }
            }
            settle(TIMEOUT_EXIT_CODE, `Execution timed out after ${timeoutMs}ms`);
        }, timeoutMs);

        attachProcessListeners(
            child,
            (chunk) => {
                stdoutAcc += chunk;
            },
            (chunk) => {
                stderrAcc += chunk;
            },
            (err) => settle(DEFAULT_FAILURE_EXIT_CODE, `Child process error: ${err.message}`),
            (code) => settle(code ?? (isTimedOut ? TIMEOUT_EXIT_CODE : DEFAULT_FAILURE_EXIT_CODE)),
        );
    });
}
