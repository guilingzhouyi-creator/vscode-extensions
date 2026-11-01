# Fractal Git (分形 Git) — Agent-Native 版本时空与分形协同内核

> **模块名称**：`fractal-git`  
> **所属架构层级**：工作区第四大核心系统 (`fractal-git/`)  
> **设计使命**：解决传统 Git 低频串行假设与多智能体（Multi-Agent）高频并发试错的冲突。  
> 通过 Rust 无锁对象模型、LayerVFS CAS 虚拟底座、自相似四层分形拓扑与按需物理回收，  
> 为智能体演化提供纳秒/微秒级版本控制基础设施。  
> **权威目录职责与扩展指引**：详见 [`docs/DIRECTORY_SPEC.md`](docs/DIRECTORY_SPEC.md)

---

## 一、 核心架构原则

1. **Plumbing 级纯净吸纳**：吸纳现代 Rust Git（`gix` / `git2`）底层对象编解码与 ODB 算子，
   解耦传统单工作区与 `index.lock` 锁机制；
2. **无锁内存虚拟索引**：并发 Agent 各自在独立内存树中记录变动，直写不可变 ODB 对象，
   并发锁冲突率归零；
3. **双专属自动化区域与内核验证器**：设立 Direct-Bypass 极速自动化测试缓存区（`<20ms` 回收）与
   提交预审区（Pre-Review Zone），内嵌 TKCV 形式化推导验证器（5 维不变式）与 IKCE 隐藏微变异盲测
   评估验证引擎（击杀率 $K\ge 60\%$），拦截无效断言与规避性代码；
4. **两道人类关卡与一体两面**：SubAgent 仅允许合入父级私有工作树；部门集成主树与全局系统主树
   作为人类掌舵的战略关口，贯穿机器可执行指令与人类双语卡片的一体两面数据结构；
5. **系统接管与物理按需回收**：提交流程由宿主系统调度接管，独立于模型自主行为；
   SubAgent 与任务卡工作树在合入后完成物理卸载释放（`<50ms`），DAG 历史全息保留；
6. **密码学防篡改独立审计链**：独立维护 `refs/fractal/telemetry/*` 遥测审计分支体系，单向哈希链
   结合操作系统级底层加固（Win32 只读锁 + Linux `chattr +a` 仅追加属性），提供不可伪造的质量凭证。

---

## 二、 完备目录层级与职责矩阵

```
fractal-git/
├── Cargo.toml                       // Rust 统一工作区配置 (10 大内核子系统 Workspace)
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
│   ├── 06-anthropic-scion-benchmark-and-parity-spec.md
│   ├── 07-taxis-construction-progress.md
│   ├── 08-taxis-in-place-storage-engine.md
│   └── 09-test-cache-and-telemetry-audit-spec.md
│
├── crates/                          // 【10 大分层内核子系统矩阵 (L1~L3 分层解耦)】
│   ├── fg-core/                     // L1: 基础对象模型、OID 哈希、提权权限与 Trait 抽象
│   ├── fg-object/                   // L1: Git 底层对象二进制序列化 (Blob / Tree / Commit)
│   ├── fg-index/                    // L1: 无锁内存虚拟树索引 (消融 index.lock 锁争用)
│   ├── fg-algorithms/               // L1: 核心数学算法库 (CCD v2, SWAR Diff, FastCDC, SpacePlan, 3-Way Merge)
│   ├── fg-pools/                    // L2: 高承压资源池 (BufferPool, WorktreePool, LRU 缓存)
│   ├── fg-storage/                  // L2: CAS 内容寻址存储、Loose ODB、In-Place 原位对象库与 WAL
│   ├── fg-native/                   // L2: TAXC 分节容器、七类原生节与仓库布局
│   ├── fg-topology/                 // L3: 分形引用拓扑 (refs/fractal/...)、状态机与提拔账本
│   ├── fg-transport/                // L3: Smart Protocol v2 (Packet-line) 与 Agent 本地 IPC
│   └── fg-gate/                     // L3: 协议层身份认证、越权阻断、冲突扫描与配额控制
│
├── src/                             // 【Rust 顶层统一门面与 CLI 入口】
│   ├── lib.rs                       // Rust 内核统一导出门面 (统摄导出 10 大内核子系统)
│   ├── bin/                         // 原生命令行二进制入口 (taxis.rs 支持全量 Git 兼容命令)
│   └── bench.rs                     // TB-REGRESSION 微基准性能测试套件
│
├── ts/                              // 【TypeScript 上层编排与应用层】
│   ├── index.ts                     // TS 统一公共门面 (ELOC >= 15)
│   ├── client/                      // Praxis Agent SDK 客户端
│   ├── vfs/                         // LayerVFS 虚拟文件系统适配器
│   ├── native-binding.ts            // 跨语言安全桥接与 Pure-TS 回退
│   ├── gate-bridge.ts               // 对接审查系统的互锁门禁桥
│   └── orchestration/               // 智能体工作树调度编排 (workspace-manager, variant-evaluator)
│
├── scripts/                         // 跨平台构建与门禁维护脚本 (ps1 CRLF / sh LF)
│   ├── README.md                    // 脚本职责与调用契约
│   ├── ps1/build.ps1 / sh/build.sh  // 跨平台全量构建与自测脚本
│   └── ps1/audit-taxis.ps1          // Taxis 5 级质量与性能门禁总督
│
└── tests/                           // 双轨确定性测试套件
    ├── README.md                    // 测试架构与分类准则
    └── rust/                        // 内核子系统单元、集成与微基准测试套件
```

---

## 三、 模块职责速查

| 目录/模块 | 负责什么 | 严禁做什么 |
| :--- | :--- | :--- |
| `crates/fg-core/` | 基础 OID、身份凭证、提权授权模型与核心 Trait 契约 | 严禁包含复杂 I/O 操作或网络通信 |
| `crates/fg-object/` | Git 对象二进制序列化、zlib 压缩与解压 | 严禁包含拓扑状态机或业务门禁规则 |
| `crates/fg-index/` | 内存树递归组装与虚拟索引，消融 `.git/index.lock` | 严禁依赖上层服务或物理工作区阻塞 I/O |
| `crates/fg-algorithms/` | 算法层：CCD v2 偏序剪枝、SWAR 文本差分、FastCDC 分块、SpacePlan 水位模拟、分层树状归约与三方合并 | 严禁在密集循环体内触发瞬态堆分配 |
| `crates/fg-pools/` | 线程本地 FreeList 缓冲池、Direct-Bypass 内存测试缓存池（`<20ms` 回收）与 LRU 缓存 | 严禁无限膨胀无上限占用内存 |
| `crates/fg-storage/` | CAS 内容寻址存储、Loose ODB、In-Place 原位对象库与分片包重打包 | 严禁非原子直接覆盖写对象 |
| `crates/fg-native/` | TAXC 分节容器、七类原生节（`META`/`HEAD`/`REFS`/`INDX`/`OPLG`/`PROM`/`WKTR`）与仓库布局 | 严禁持有 git 格式知识，格式解析归兼容投影层 |
| `crates/fg-topology/` | 四层拓扑断言、工作树状态机（含检疫隔离）、`refs/fractal/telemetry/*` 密码学遥测审计哈希链与 OS 级文件加固 | 严禁越级跨层直接合入 |
| `crates/fg-transport/` | Git Smart Protocol v2 与 Agent 本地 IPC | 严禁绕过 `pre-receive` 门禁写引用 |
| `crates/fg-gate/` | TKCV 5 维形式化推导验证器、IKCE 内核微变异击杀率验证、贝叶斯动态信用评级与越权拦截 | 严禁执行高开销外部阻塞网络调用 |
| `src/lib.rs` | 统一顶层门面，一站式导出 10 大内核子系统核心抽象与 API | 严禁退化为空包透传跳板（需包含实质承载契约） |
| `src/bin/` | 原生 CLI 二进制入口（`taxis` 命令），支持 Git 兼容操作及 `quality`/`quarantine` 高级指令 | 严禁反向被底层内核子系统依赖 |
| `ts/orchestration/` | 多任务卡调度、分支候选变体质量评估与胜出提拔 | 严禁侵入底层 Git 二进制打解包逻辑 |

---

## 四、 架构扩展路径指引

扩展放置规则收敛至 [`docs/DIRECTORY_SPEC.md`](docs/DIRECTORY_SPEC.md)：
- **新增核心算法** $\to$ `crates/fg-algorithms/src/<domain>/`
- **新增通信协议** $\to$ `crates/fg-transport/src/<protocol>.rs`
- **新增门禁规则** $\to$ 微秒级置于 `crates/fg-gate/`，深度语义置于 `ts/gate-bridge.ts` 调用 Auto 规则库
- **新增存储后端** $\to$ `crates/fg-storage/src/`
- **新增 CLI 子命令** $\to$ `src/bin/taxis.rs`
