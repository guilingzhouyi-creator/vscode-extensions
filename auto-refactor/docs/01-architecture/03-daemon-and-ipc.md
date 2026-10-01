# 03. 跨平台守护进程与 NDJSON IPC 协议

> **所属层级**：L1 核心架构与原生内核 (`docs/01-architecture/`)  
> **对应代码真源**：`src/daemon/server.ts`、`src/daemon/client.ts`、`src/daemon/protocol.ts`、`src/daemon/registry.ts`、`src/cli/daemonCmd.ts`

---

## 1. 守护进程架构设计

在高频编辑与 IDE 保存即审（Save-on-Audit）场景下，Node.js 进程冷启动、JIT 预热与工作线程池初始化耗时约占总耗时的 60% 以上。`auto-refactor` 提供了跨平台守护进程（Daemon），将 `WorkerPool`、`L1` 内存 AST/结果缓存以及 `SemanticGraph` 拓扑常驻于后台进程中。

### 1.1 跨平台传输端点 (`src/daemon/registry.ts`)

| 操作系统平台 | 底层 IPC 端点协议 | 路径 / 管道命名规范 |
| :--- | :--- | :--- |
| **Windows** | Named Pipe (命名管道) | `\\.\pipe\auto-refactor-daemon-<workspaceHash>` |
| **Linux / macOS** | Unix Domain Socket (UDS) | `<os.tmpdir()>/auto-refactor-<workspaceHash>.sock` |

每个工作区根目录（`root`）通过规范化路径计算确定性哈希，保证多项目并行开启时守护进程彼此物理隔离、互不串扰。

---

## 2. NDJSON 流式通信协议 (`src/daemon/protocol.ts`)

客户端（`src/daemon/client.ts`）与服务端（`src/daemon/server.ts`）采用基于换行符分隔的 **NDJSON（Newline-Delimited JSON）** 帧协议，支持请求复用与大体积 Diff 流式传输：

### 2.1 核心请求与响应帧类型

| 帧类型 (`op`) | 方向 | 核心载荷字段 | 语义说明 |
| :--- | :---: | :--- | :--- |
| `ping` / `pong` | 双向 | `{ version, pid, uptimeMs, rssBytes }` | 探活与版本握手；若服务端 `version !== TOOL_VERSION`，客户端自动触发服务端平滑重启 |
| `scan` | Client $\rightarrow$ Server | `{ root, config, options }` | 触发暖缓存扫描，利用常驻 `L1/L2` 与已预热的 `WorkerPool` |
| `scan_diff` | Client $\rightarrow$ Server | `{ root, config, diffs, verifyDiskContent, delta }` | 触发内存缓冲区增量 Diff 扫描，支持 `DiffInput[]` 批量传入 |
| `status` | Client $\rightarrow$ Server | `{ cacheEntries, poolWorkers, rssMb }` | 查询当前守护进程缓存命中统计与内存健康度 |
| `shutdown` | Client $\rightarrow$ Server | `{ reason }` | 优雅刷盘 `L2` 缓存、销毁工作线程并释放 Socket 句柄 |

---

## 3. 三档守护模式 (`daemon` 选项契约)

在 `ScanOptions` 与 CLI 参数中，守护进程行为由三档枚举精确控制：

1. **`daemon: 'off'`（默认）**：完全禁用守护进程连接与 `net` 模块加载，纯进程内运行。
2. **`daemon: 'auto'`**：仅尝试探测已运行的同版本守护进程；若探测成功则走毫秒级 IPC 暖扫，若未启动则立即在当前进程内执行冷扫描，绝不隐式拉起后台进程。
3. **`daemon: 'on'`**：若当前工作区无活跃守护进程，自动通过 `ensureDaemon(root)` 在后台分离式（detached）拉起守护进程并完成本次扫描，适用于本地 `watch` 与开发流。

---

## 4. 心跳看守、空闲自毁与 RSS 内存自愈

为防止后台守护进程成为僵尸进程或持续侵占宿主内存，`src/daemon/server.ts` 内置三重自愈机制：

1. **空闲超时自动退出（Idle Timeout）**：当连续无扫描请求达到设定的空闲窗口时，自动将脏 `L1` 条目刷入 `L2` 磁盘缓存并优雅退出（Exit 0）。
2. **RSS 高水位主动回收（Memory Watermark Healing）**：每次扫描完成后检测 `process.memoryUsage().rss`；若超过安全水位阈值，自动清空 `L1` 大体积 AST 快照并重建轻量缓存池。
3. **全透明故障回退（Fail-Safe Cold Fallback）**：无论遇到命名管道权限受限（`EPERM` / `EACCES`）、连接中断还是协议超时，`tryWarmScan` 均会捕获异常并无缝回退至本地 `Scanner.scan()`，对外承诺**任何守护进程故障均不影响扫描结果的字节级正确性**。

---

## 5. 关联文档导航

- [01. 系统六层架构全景与核心数据流](./01-system-overview.md)
- [02. 两级增量缓存与配置指纹拓扑](./02-pipeline-and-caching.md)
