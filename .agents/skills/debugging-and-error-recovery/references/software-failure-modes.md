# Common Failure Modes & Minimal SSCCE Isolation Guide

High-frequency failure breakpoints across services/kernels and VS Code extensions, paired with the 4-step SSCCE workflow.

---

## 1. Failure Diagnostic Matrix

| Domain | Typical Symptoms | Generic System Breakpoints | VS Code / Webview Breakpoints |
| :--- | :--- | :--- | :--- |
| **1. Startup & Activation** | Timeout, `command not found`, null panic | Check DAG init order, dangling async Promises, or deadlocks | Verify `package.json` `activationEvents` and zero sync work in `activate()` |
| **2. IPC & Dropped Messages** | Hang, blank panel, frozen statusbar | Compare wire schema versions, timeouts, and partial pipe framing | Open `Webview Developer Tools` for CSP blocks and `postMessage` contract mismatches |
| **3. Concurrency & Shutdown Loss** | State overwrites, lost tail frames | Check `isFlushing` reentrancy locks, CAS epochs, and monotonic ordering | Return a flush Promise from `deactivate()` and rely on Append-Only Journal replay |

---

## 2. Four-Step SSCCE Protocol

Never patch complex production modules blind; extract a Short, Self-Contained, Correct Example first:
1. **Short (`<= 30` lines)**: Strip UI and outer controllers down to the pure function or state machine reproducing the fault.
2. **Self-Contained**: Inject fixed clocks (`withFixedNow`), seeded RNG (Mulberry32), and in-memory maps with zero external network/DB I/O.
3. **Correct Repro**: Confirm deterministic failure trace (red test) before editing production code.
4. **Lock Regression**: Retain the minimal repro case permanently inside the unit test suite.
