# 守护进程与 IPC 机制 (Daemon Service & IPC Protocol)

> **所属模块**：`01-architecture`  
> **核心源码**：`src/daemon/server.ts`, `src/daemon/client.ts`, `src/daemon/protocol.ts`, `src/daemon/registry.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 守护进程架构与响应优势

对于 IDE 实时代码检查（如 VS Code 扩展）或频繁触发的本地命令行审查，每次启动 Node.js 虚拟机、装载庞大的 TypeScript 编译器与 Native 解析模块会产生 **300ms ~ 600ms 的冷启动延迟**。

Daemon 守护进程通过在系统后台持久驻留，将全量 AST 适配器、L1 内存缓存与预热完毕的 Worker 线程池保持在就绪状态，实现 **$< 10\text{ms}$ 的极速增量响应**。

---

## 2. 跨平台 IPC 通信管道

守护进程与客户端采用跨平台原生高效 IPC 机制通信：

* **Windows 环境**：基于 Named Pipes（命名管道，如 `\\.\pipe\auto-refactor-daemon-<hash>`）；
* **Linux / macOS 环境**：基于 Unix Domain Sockets（UDS 域套接字，如 `/tmp/auto-refactor-<hash>.sock`）。

数据传输采用轻量、易解析且支持实时流式推流的 **NDJSON (Newline Delimited JSON)** 协议。

---

## 3. 消息协议与流式通信

### 3.1 核心协议定义 (`src/daemon/protocol.ts`)

```typescript
export type DaemonMessage =
  | { type: 'hello'; version: number }
  | { type: 'hello_ack'; version: number; caps: { warm: boolean; diff: boolean; stream: boolean } }
  | { type: 'scan'; params: ScanRequestParams }
  | { type: 'scan_diff'; params: ScanDiffRequestParams }
  | { type: 'scan_chunk'; chunk: ScanReportChunk }
  | { type: 'scan_done'; report: ScanReport; stats?: WarmStats }
  | { type: 'error'; message: string; code?: string };
```

### 3.2 发现注册与断线自愈 (`src/daemon/registry.ts`)

* **文件锁与注册表**：Daemon 启动后在项目缓存或临时目录写入 PID 与 Socket 描述符；
* **空闲超时（Idle Timeout）**：Daemon 默认配置 10 分钟空闲自退出定时器，无任务调用时自动释放内存与系统资源；
* **断线无感自愈**：客户端在连接失败或检测到僵尸 Socket 时，会自动清理过期锁文件并无感拉起新 Daemon 实例，确保调用方高可用。
