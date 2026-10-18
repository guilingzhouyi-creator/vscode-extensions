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
├── Cargo.toml                       // Rust 核心 Crate 配置 (flate2, sha1, parking_lot, dashmap, serde)
├── package.json                     // TypeScript 工程包配置 (双轨构建与测试脚本)
├── tsconfig.json                    // TypeScript 严格类型编译器配置
├── README.md                        // 项目总览、六字段契约与一级路由表
│
├── docs/                            // 【全局技术文档库】
│   ├── README.md                    // 文档全宗导航与关键指标
│   ├── ARCHITECTURE.md              // 顶层架构规范与 Mermaid 拓扑
│   ├── DIRECTORY_SPEC.md            // 全域目录职责矩阵、单向依赖流与后续扩展路由指南
│   ├── 01-architecture-principles.md
│   ├── 02-ecosystem-survey-and-lessons.md
│   ├── 03-pre-review-zone-and-auto-gating.md
│   └── 04-lockless-in-memory-engine.md
│
├── src/                             // 【Rust 高性能版本内核 Core Engine】
│   ├── lib.rs                       // Rust 内核统一导出与宏定义
│   ├── error.rs                     // 全域强类型错误体系
│   ├── object/                      // ① 原生 Git 对象模型 (Plumbing 算子: blob, tree, commit)
│   ├── index/                       // ② 无锁内存虚拟索引 (消融 index.lock: entry, tree_builder)
│   ├── fractal/                     // ③ 自相似分形拓扑与生命周期状态机 (refs, topology, state_machine)
│   ├── cas/                         // ④ 内容寻址存储与变长切块 (FastCDC chunker, materializer)
│   ├── server/                      // ⑤ 自托管协议与通信服务端 (ipc, smart_protocol v2)
│   ├── gate/                        // ⑥ Rust 侧内生预审门禁拦截 (pre_receive, conflict_guard)
│   └── reclaimer/                   // ⑦ 本地工作树物理按需回收引擎 (cleaner, quota)
│
├── ts/                              // 【TypeScript 上层编排与应用层】
│   ├── index.ts                     // TS 统一公共门面 (ARCH-FAC-001, ELOC >= 15)
│   ├── contracts.ts                 // 语义接口契约 (PraxisCardContext, DTOs)
│   ├── native-binding.ts            // 跨语言安全桥接与 Pure-TS 回退
│   ├── gate-bridge.ts               // 对接 Auto 审查系统的互锁门禁桥
│   ├── orchestration/               // ⑧ 智能体工作树调度编排 (workspace-manager, tournament-runner)
│   └── cli/                         // ⑨ 开发者 CLI 命令与诊断工具 (status, graph, reclaim)
│
├── scripts/                         // ⑩ 跨平台构建与门禁维护脚本
│   ├── README.md                    // 脚本职责与调用契约
│   ├── build.ps1                    // Windows PowerShell 构建与本地验证
│   └── build.sh                     // Linux / WSL Bash 构建与测试
│
└── tests/                           // ⑪ 双轨确定性测试套件
    ├── README.md                    // 测试架构与分类准则
    ├── test_object_codec.rs         // Rust 原生对象编解码与拓扑测试
    ├── rust/                        // Rust 深度单元与子系统回归测试
    └── ts/                          // TypeScript 端到端生命周期与编排测试
```

---

## 三、 模块职责速查

| 目录/模块 | 负责什么 | 严禁做什么 |
| :--- | :--- | :--- |
| `src/object/` | Git 对象二进制序列化、zlib 压缩与 Loose Object 存储 | 严禁包含业务状态机、拓扑逻辑或网络传输 |
| `src/index/` | 内存树构建，消融 `.git/index.lock` | 严禁依赖上层服务或物理工作区操作 |
| `src/fractal/` | 四层拓扑断言与状态转移（Sub $\to$ Card $\to$ Cell $\to$ Trunk） | 严禁绕过层级直接跨级合入 |
| `src/cas/` | FastCDC 变长分块与 LayerVFS 优胜快照原子物化 | 严禁在分块层引入网络协议 |
| `src/server/` | Git Smart Protocol v2 (Packet-line) 与 Agent 本地 IPC | 严禁绕过 `pre-receive` 门禁直接写引用 |
| `src/gate/` | 协议层身份认证、越权阻断与微秒级物理卫生扫描 | 严禁执行高开销外部阻塞网络调用 |
| `src/reclaimer/` | 临时工作树物理目录卸载删除与磁盘配额守卫 | 严禁删除永久 Git Commit DAG 对象 |
| `ts/orchestration/` | 多任务卡调度、MCTS 打擂评分与胜出提拔 | 严禁侵入底层 Git 二进制打解包逻辑 |
| `ts/cli/` | 开发者终端交互、ASCII 拓扑可视化与诊断命令 | 严禁直接侵入底层调度状态机 |

---

## 四、 后续扩展路径指引

扩展放置规则收敛至 [`docs/DIRECTORY_SPEC.md`](docs/DIRECTORY_SPEC.md)：
- **新增通信协议** $\to$ `src/server/<protocol>.rs`
- **新增门禁规则** $\to$ 微秒级置于 `src/gate/`，深度语义置于 `ts/gate-bridge.ts` 调用 Auto 规则库
- **新增存储后端** $\to$ `src/cas/backends/`
- **新增 CLI 子命令** $\to$ `ts/cli/commands.ts`
