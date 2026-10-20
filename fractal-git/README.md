# Fractal Git (分形 Git) — Agent-Native 版本时空与分形协同内核

> **模块名称**：`fractal-git`  
> **所属架构层级**：工作区第四大核心顶级系统 (`fractal-git/`)  
> **设计使命**：解决传统 Git 面向人类低频串行假设与多智能体（Multi-Agent）高频并发试错之间的物理冲突。通过 Rust 极速无锁对象模型、LayerVFS CAS 虚拟时空底座、自相似四层分形拓扑与按需物理回收机制，为智能体演化提供纳秒/微秒级版本控制基础设施。  
> **权威目录职责与扩展指引**：详见 [`docs/DIRECTORY_SPEC.md`](docs/DIRECTORY_SPEC.md)

---

## 一、 核心架构原则

1. **Plumbing 级纯净吸纳**：吸纳现代 Rust Git（`gix` / `git2`）底层对象编解码与 ODB 算子，彻底抛弃传统脆弱的单工作区与 `index.lock` 锁机制；
2. **无锁内存虚拟索引**：并发 Agent 各自在独立的内存树中暂存变动，直写不可变 ODB 对象，并发锁冲突率归零；
3. **提交预审区双轨互锁**：将传统盲目的暂存区重构为包含 Auto 客观静态度量（`<10ms` AST 切片 / 三层拓扑 Diff）与 Agent 角色主观审阅的双轨门禁网；
4. **两道人类关卡与一体两面**：SubAgent 仅允许合入父级私有工作树；部门集成主树与全局系统主树作为人类掌舵的战略关口，贯穿机器可执行指令与人类双语卡片的一体两面数据结构；
5. **系统接管与物理按需回收**：提交流程由宿主系统刚性接管，绝不依赖大模型自觉；SubAgent 与任务卡工作树在合入后瞬时完成物理卸载释放，DAG 历史全息保留。

---

## 二、 完备目录层级与职责矩阵

```
fractal-git/
├── Cargo.toml                       // Rust 统一工作区配置 (9 大微 Crate Workspace)
├── package.json                     // TypeScript 工程包配置 (双轨构建与门禁脚本)
├── tsconfig.json                    // TypeScript 严格类型编译器配置
├── README.md                        // 项目总览、六字段契约与一级路由表
│
├── docs/                            // 【全局技术文档库】
│   ├── README.md                    // 文档全宗导航与关键指标
│   ├── ARCHITECTURE.md              // 顶层架构规范与 Mermaid 拓扑
│   ├── DIRECTORY_SPEC.md            // 全域目录职责矩阵、单向依赖流与架构扩展路由指南
│   ├── 01-architecture-principles.md
│   ├── 02-ecosystem-survey-and-lessons.md
│   ├── 03-pre-review-zone-and-auto-gating.md
│   ├── 04-lockless-in-memory-engine.md
│   ├── 05-advanced-algorithms-and-poset-mathematics.md
│   └── 06-anthropic-scion-benchmark-and-parity-spec.md
│
├── crates/                          // 【9 大微 Crate 内核矩阵 (L1~L3 分层解耦)】
│   ├── fg-core/                     // L1: 基础对象模型、OID 哈希、UAC 权限与 Trait 抽象
│   ├── fg-object/                   // L1: Git 底层对象二进制序列化 (Blob / Tree / Commit)
│   ├── fg-index/                    // L1: 无锁内存虚拟树索引 (消融 index.lock 锁争用)
│   ├── fg-algorithms/               // L1: 顶会级数学算法库 (CCD v2, SWAR Diff, FastCDC, 3-Way Merge)
│   ├── fg-pools/                    // L2: 高承压资源池 (BufferPool, WorktreePool, LRU 缓存)
│   ├── fg-storage/                  // L2: CAS 内容寻址存储、Loose ODB 与 WAL Journal
│   ├── fg-topology/                 // L3: 分形引用拓扑 (refs/fractal/...)、状态机与提拔账本
│   ├── fg-transport/                // L3: Smart Protocol v2 (Packet-line) 与 Agent 本地 IPC
│   └── fg-gate/                     // L3: 协议层身份认证、越权阻断、冲突扫描与配额控制
│
├── src/                             // 【Rust 顶层统一门面与 CLI 入口】
│   ├── lib.rs                       // Rust 内核统一导出门面 (统摄导出 9 大微 Crate)
│   ├── bin/                         // 原生命令行二进制入口 (taxis.rs 支持全量 Git 兼容命令)
│   └── bench.rs                     // TB-REGRESSION 微基准性能测试套件
│
├── ts/                              // 【TypeScript 上层编排与应用层】
│   ├── index.ts                     // TS 统一公共门面 (ARCH-FAC-001, ELOC >= 15)
│   ├── client/                      // Praxis Agent SDK 客户端
│   ├── vfs/                         // LayerVFS 虚拟文件系统适配器
│   ├── native-binding.ts            // 跨语言安全桥接与 Pure-TS 回退
│   ├── gate-bridge.ts               // 对接 Auto 审查系统的互锁门禁桥
│   └── orchestration/               // 智能体工作树调度编排 (workspace-manager, tournament-runner)
│
├── scripts/                         // 跨平台构建与门禁维护脚本 (ps1 CRLF / sh LF)
│   ├── README.md                    // 脚本职责与调用契约
│   ├── build.ps1 / build.sh         // 跨平台全量构建与自测脚本
│   └── ps1/audit-taxis.ps1          // Taxis 5 级质量与性能门禁总督
│
└── tests/                           // 双轨确定性测试套件
    ├── README.md                    // 测试架构与分类准则
    └── rust/                        // 9 大微 Crate 单元、集成与微基准测试套件
```

---

## 三、 模块职责速查

| 目录/模块 | 负责什么 | 严禁做什么 |
| :--- | :--- | :--- |
| `crates/fg-core/` | 基础 OID、身份凭证、UAC 权限模型与核心 Trait 契约 | 严禁包含复杂 I/O 操作或网络通信 |
| `crates/fg-object/` | Git 对象二进制序列化、zlib 压缩与解压 | 严禁包含拓扑状态机或业务门禁规则 |
| `crates/fg-index/` | 内存树递归组装与虚拟暂存，消融 `.git/index.lock` | 严禁依赖上层服务或物理工作区阻塞 I/O |
| `crates/fg-algorithms/` | 算法层：CCD v2 偏序剪枝、SWAR 文本差分、FastCDC 分块与三方合并 | 严禁在密集循环体内触发瞬态堆分配 |
| `crates/fg-pools/` | 线程本地 FreeList 缓冲池、工作树复用池与 LRU 缓存 | 严禁无限膨胀无上限占用内存 |
| `crates/fg-storage/` | CAS 内容寻址存储与 Loose ODB 原子落盘 | 严禁非原子直接覆盖写对象 |
| `crates/fg-topology/` | 四层拓扑断言（Sub $\to$ Card $\to$ Cell $\to$ Trunk）与提拔账本 | 严禁越级跨层直接合入 |
| `crates/fg-transport/` | Git Smart Protocol v2 (Packet-line) 与 Agent 本地 IPC | 严禁绕过 `pre-receive` 门禁直接写引用 |
| `crates/fg-gate/` | 协议层身份认证、越权阻断、冲突标记扫描与并发配额控制 | 严禁执行高开销外部阻塞网络调用 |
| `src/lib.rs` | 统一顶层门面，一站式导出 9 大微 Crate 核心抽象与 API | 严禁退化为空包透传跳板（需包含实质承载契约） |
| `src/bin/` | 原生 CLI 二进制入口（`taxis` 命令），支持 Git 兼容操作 | 严禁反向被底层微 Crate 依赖 |
| `ts/orchestration/` | 多任务卡调度、MCTS 打擂评分与胜出提拔 | 严禁侵入底层 Git 二进制打解包逻辑 |

---

## 四、 架构扩展路径指引

扩展放置规则收敛至 [`docs/DIRECTORY_SPEC.md`](docs/DIRECTORY_SPEC.md)：
- **新增核心算法** $\to$ `crates/fg-algorithms/src/<domain>/`
- **新增通信协议** $\to$ `crates/fg-transport/src/<protocol>.rs`
- **新增门禁规则** $\to$ 微秒级置于 `crates/fg-gate/`，深度语义置于 `ts/gate-bridge.ts` 调用 Auto 规则库
- **新增存储后端** $\to$ `crates/fg-storage/src/`
- **新增 CLI 子命令** $\to$ `src/bin/taxis.rs`
