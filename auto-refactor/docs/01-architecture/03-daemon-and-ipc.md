# 守护进程与 IPC 机制 (Daemon Service & IPC Protocol)

> **所属模块**：`01-architecture`  
> **核心源码**：`src/daemon/server.ts`, `src/daemon/client.ts`, `src/daemon/protocol.ts`, `src/daemon/registry.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 守护进程架构与价值

对于 IDE 实时代码检查（如 VS Code 扩展）或频繁触发的本地 CLI，每次启动 Node.js 虚拟机、加载庞大的 TypeScript 编译器 AST 模块会带来 **300ms ~ 600ms 的冷启动延迟**。

Daemon 服务通过持久驻留后台进程，将全量 AST 解析适配器、L1 缓存与已初始化的 Worker 线程池保持在预热状态，实现 **< 10ms 的极速增量响应**。

---

## 2. 跨平台 IPC 通信管道

守护进程与客户端采用跨平台原生高效 IPC 机制通信：

* **Windows 环境**：基于 Named Pipes（命名管道，如 `\\.\pipe\auto-refactor-daemon-<hash>`）；
* **Linux / macOS 环境**：基于 Unix Domain Sockets（UDS 域套接字，如 `/tmp/auto-refactor-<hash>.sock`）。

数据传输采用高效的 **NDJSON (Newline Delimited JSON)** 协议流式传输。

---

## 3. 消息协议与生命周期

### 3.1 核心协议定义 (`src/daemon/protocol.ts`)

```typescript
export type DaemonMessage =
  | { type: 'hello'; version: number }
  | { type: 'hello_ack'; version: number; caps: { warm: boolean; diff: boolean } }
  | { type: 'scan'; params: ScanRequestParams }
  | { type: 'scan_diff'; params: ScanDiffRequestParams }
  | { type: 'scan_done'; report: ScanReport; stats?: WarmStats }
  | { type: 'error'; message: string };
```

### 3.2 发现注册与自愈管理 (`registry.ts`)
* **锁文件与注册表**：Daemon 启动后在项目缓存或临时目录写入 PID 与 Socket 描述符。
* **孤儿进程清理与空闲超时**：Daemon 默认具备 10 分钟空闲自退出定时器（Idle Timeout），无任务调用时自动释放资源；客户端在检测到僵尸 Socket 时会自动触发断线自愈并无感拉起新 Daemon。
