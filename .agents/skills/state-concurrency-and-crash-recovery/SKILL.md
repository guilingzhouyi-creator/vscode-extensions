---
name: state-concurrency-and-crash-recovery
description: >-
  【触发：并发/状态机/排障/泄漏/原子落盘/幂等/崩溃恢复/Journal】涉及并发调度、句柄生命周期对称释放(PRF-LEAK-001)、异步派发器排空或崩溃恢复幂等性设计时触发。杜绝孤儿句柄与悬挂协程。
---

# state-concurrency-and-crash-recovery — 有界并发状态机、对称生命周期与崩溃安全持久化规范

本技能提炼全工作区四大项目共用的**高可靠状态管理、并发调度与崩溃恢复工程模型**。无论是 `workspace-timing` 的 RingBuffer+Journal 计时账本、`auto-refactor` 的常驻 Daemon 与 Worker 池、`WebGames` 的 `AgentAsyncDispatcher`，还是 `fractal-git` 的原子落盘存储，均受本技能的四大公理约束。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[rust-engineering](../rust-engineering/SKILL.md)、[workspace-timing-dev](../workspace-timing-dev/SKILL.md) → **本技能** → [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)、[interaction-design-physics](../interaction-design-physics/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：分形版本控制内核（链上第 3 步）；另 2 个领域支援；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：索引树并发写入或崩溃恢复 → `fractal-git-dev` + `state-concurrency-and-crash-recovery` + `defensive-security-and-taint-safety`；进程被杀后缓冲区数据丢失 → `workspace-timing-dev` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 一、 适用场景与触发条件

在以下任一研发或审查场景中，必须激活本技能：
1. **编写文件持久化、状态快照落盘、缓存写入或配置更新逻辑**；
2. **设计异步队列、后台 Worker 线程池、事件总线订阅或常驻守护进程（Daemon）**；
3. **编写跨午夜/休眠恢复、进程异常退出自愈或可重入初始化逻辑**；
4. **排查测试挂起超时（Timeout 124）、句柄泄漏（`PRF-LEAK-001`）、半写损坏或重入副作用（`UUID-REENTRANT-001`）**。

---

## 二、 四大高可靠并发与持久化刚性公理

### 1. 资源生命周期对称律 (`PRF-LEAK-001` / `RES-*` / `ADV-EVT-*`)
**任何资源获取操作在写下第一行时，必须在同一模块层级同步写下对称的释放路径**：

| 获取动作 (Acquire) | 必须对称实现的释放动作 (Release) | 漏写后果与对应规则 |
| :--- | :--- | :--- |
| `emitter.on(evt, fn)` / Godot `.connect()` | `emitter.off(evt, fn)` / `.disconnect()` | 闭包捕获 AST/节点树导致常驻内存泄漏（`PRF-LEAK-001` / `GDM-CONNECT-001`） |
| `setInterval` / `setTimeout` | `clearInterval` / `clearTimeout`（纳入 `dispose()`） | 宿主关停后孤儿定时器持续触发报错（`L3-RESOURCE-TOPO` / `VSC-MEM-001`） |
| `Start-Process` / `child_process.spawn` | 有界 `WaitForExit(timeoutMs)` + `try/finally` `Kill($true)` | 子进程挂死导致门禁或测试永久阻塞（`PS-TRAP-001`） |
| 后台异步派发器 `dispatch()` | 同步提供 `pump()`、`flush()`、`teardown()` | 无头引擎或测试退出时等待未决线程死锁（`ADV-EVT-001`） |

### 2. 暂存校验与原子落盘协议 (`GOV-PRF-004` / `FGT-STO-001` / `DAT-RES-001`)
**严禁对关键状态文件执行原地直接覆写（In-Place Overwrite）**：
1. **暂存路径分流**：先将数据写入同文件系统下的专用暂存路径（`stagingPath`、`compactStagingPath` 或 `stagingUri`）；
2. **完整性自检**：写入完成后校验字节长度非零及结构完整性（JSON 可解析性或 Checksum）；
3. **原子重命名替换**：调用 `fs.rename` / `FileAccess` 原子替换目标路径，确保任何时刻断电或进程崩溃，磁盘文件要么是旧完整版，要么是新完整版，绝不出现半写（Torn Write）0 字节损坏。

### 3. RingBuffer 有界缓冲与 Append-Only Journal 崩溃恢复 (`UUID-REENTRANT-001` / `VSC-MEM-001`)
1. **内存有界化（Bounded Memory）**：高频遥测、轨迹历史或未决事件队列严禁使用无上界动态数组，必须采用定长 `RingBuffer`（如 32/64 槽位循环覆盖）或带容量上限的 LRU 容器；
2. **双写崩溃防护**：内存状态聚合必须伴随轻量级 Append-Only Journal（紧凑 NDJSON 增量日志）；宿主启动时若检测到上次未正常关停（Dirty Shutdown），通过回放 Journal 幂等重建状态；
3. **可重入幂等契约 (`UUID-REENTRANT-001`)**：回放、重试与初始化入口必须携带幂等键（`checkpointId` / `sequenceId`），重复执行同一批次日志不得产生双倍累加副作用。

### 4. 热路径非阻塞 I/O 与状态机显式转换 (`PRF-IO-001`)
1. **常驻事件循环禁同步 I/O (`PRF-IO-001`)**：在守护进程请求处理、VS Code 扩展激活运行期或 UI 帧循环中，严禁调用 `fs.readFileSync`、`fs.writeFileSync`、`fs.unlinkSync`；
2. **显式有限状态机（Explicit FSM）**：严禁使用散落的多个布尔字段（`isLoading` + `isFailed` + `isClosed`）拼凑并发状态；必须收敛为单一判别联合状态机（`Idle | Running | Draining | Closed`），在 `Draining / Closed` 态拒绝新任务入队。

---

## 三、 本地预审与验证命令

```powershell
# 1. 验证 workspace-timing 存储协调器与跨日崩溃回放套件
cd workspace-timing && npm run test:fast

# 2. 验证 auto-refactor 守护进程与质量轨迹紧凑落盘门禁
cd auto-refactor && node scripts/gate-self.js

# 3. 验证技能集与代码资产物理卫生
node scripts/common/validate-skills.js
```

---

## 四、 关联深水区参考与实操样板

- [crash-safe-journal-and-dispatcher-lifecycle.md](references/crash-safe-journal-and-dispatcher-lifecycle.md)：暂存原子落盘四步状态图、Journal 幂等回放去重算法与后台派发器 `pump/flush/teardown` 标准协议；
- [atomic-journal-store.ts](templates/atomic-journal-store.ts)：符合六字段头部契约、有界 RingBuffer、原子暂存重命名与幂等重放的 TypeScript 标准样板。
