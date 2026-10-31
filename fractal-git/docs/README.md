# Fractal Git 核心技术文档库索引

> **模块定位**：工作区第四大核心系统 (`fractal-git/`) 权威技术案卷全宗  
> **关联蓝图真源**：[`docs/agent-native-system-blueprint.md`](../../docs/agent-native-system-blueprint.md) §4.2~§4.3

---

## 专册目录导航

| 案卷编号 | 案卷标题 | 核心议题与解决的关键痛点 |
| :--- | :--- | :--- |
| [**`01-architecture-principles.md`**](01-architecture-principles.md) | **架构第一性原理与自相似拓扑规范** | 阐明分形自相似性与尺度不变性公理；明确父级私有工作树 $\neq$ 部门集成主树的分层物理工作树隔离机制；确立两道人类战略关卡与一体两面双载荷机制。 |
| [**`02-ecosystem-survey-and-lessons.md`**](02-ecosystem-survey-and-lessons.md) | **现代 Git 生态与实验性路线经验吸纳** | 吸纳 `gix` 纯无锁 Plumbing 算子；剖析 `jj` 在 Agent 场景下的设计错配；超越 `plasma-ai/fractal` 磁盘悬崖；内化 `hatchzip` 原位解压为具备事务一致性的 TIPSE 引擎。 |
| [**`03-pre-review-zone-and-auto-gating.md`**](03-pre-review-zone-and-auto-gating.md) | **提交预审区双轨互锁与物理回收机制** | 确立从传统工作区缓冲到智能“提交预审区”的范式跃迁；三级双轨审查网矩阵；Praxis 底层宿主自动物化与瞬时物理按需回收（免依赖模型自觉）。 |
| [**`04-lockless-in-memory-engine.md`**](04-lockless-in-memory-engine.md) | **无锁内存虚拟索引与 CAS 原子物化内核** | 剖析消除 `.git/index.lock` 锁争用的内存虚拟树数据结构；递归嵌套 Git Tree 规范排序与二进制构建；LayerVFS CAS 快照到 Git Commit 的微秒级原子物化流水线。 |
| [**`05-advanced-algorithms-and-poset-mathematics.md`**](05-advanced-algorithms-and-poset-mathematics.md) | **数学体系与算法算子第一性原理演进** | 系统推导并落地偏序集单调保序 Corrected Commit Date (CCD v2, 12ns/77.8M op/s)、范畴论推标（Pushout）直和简并、Kirsch-Mitzenmacher 256-bit 路径 Bloom 过滤（161ns/6.2M op/s）、SWAR 64 位整字并行文本差分与 Elias-Fano 准简洁位向量压缩。 |
| [**`06-anthropic-scion-benchmark-and-parity-spec.md`**](06-anthropic-scion-benchmark-and-parity-spec.md) | **Anthropic Scion 架构解构与 Taxis 五维基准压测规范** | 复盘 Claude 团队高频代码合并场景与 Scion 三级解耦流式架构；确立 Taxis 正式版本五维基准测试套件（检出延迟、高并发合并、路径 Bloom 剪枝、内存零堆分配与离线弹性）及演进路线。 |
| [**`07-taxis-construction-progress.md`**](07-taxis-construction-progress.md) | **Taxis 1.0 施工进度实测对齐版** | 以代码与门禁实测替换计划书 §十九 的滞后陈述：批次状态总表、`fg-native` 实际构成、六处设计错误修正证据、`relocate` 实现要点与仍未开始部分。 |
| [**`08-taxis-in-place-storage-engine.md`**](08-taxis-in-place-storage-engine.md) | **Taxis 就地存储引擎 (TIPSE) 规约** | 阐明逆向尾部截断（Tail-First）、前向打洞（Hole Punching）、离散水位模拟器（SpacePlan）、WAL崩溃可逆恢复与微分型包递进轮转（Micro-Pack Slicing）。 |
| [**`09-test-cache-and-telemetry-audit-spec.md`**](09-test-cache-and-telemetry-audit-spec.md) | **专属测试与缓存区、内核验证器与密码学独立遥测审计规约** | 阐明 Direct-Bypass 独占测试与编译缓存直通空间、TKCV 形式化抽象推导器、IKCE 内存微变异击杀率验证引擎、贝叶斯动态信用与 `refs/fractal/telemetry/*` 密码学不可篡改遥测审计哈希链及分层树状归约台账。 |
| [**`ARCHITECTURE.md`**](ARCHITECTURE.md) | **系统架构总览与快速规范查阅手册** | 包含 Mermaid 分形拓扑图、生命周期状态转移矩阵与核心接口速查表。 |
| [**`DIRECTORY_SPEC.md`**](DIRECTORY_SPEC.md) | **全域目录职责矩阵与单向依赖扩展指引** | 规范 10 大内核子系统物理职责、单向依赖 DAG 拓扑图与架构扩展路由准则。 |

---

## 关键技术指标总览 (Key Metrics)

- **并发锁争用率**：`0.0%`（完全脱离 `.git/index.lock`）
- **CCD v2 偏序祖先可达性判定**：`12 ns / 77,881,620 op/s`（$O(1)$ 严格单调保序排除）
- **路径 Bloom 过滤器查询延迟**：`132 ~ 161 ns / 6,199,628 op/s`（绕过 $99\%+$ 树解包）
- **流式树差分吞吐**：`11.13 µs / 89,820 op/s`（层次化双指针流扫描 + $O(1)$ 子树剪枝）
- **SWAR 64 位并行文本差分**：`10.52 µs / 95,028 op/s`（单块扁平连续磁带 + 零堆分配）
- **线程局部缓冲池分配耗时**：`98 ns / 10,175,010 op/s`（3 阶尺寸桶零锁复用）
- **虚拟分支物化耗时**：`5 ~ 10ms`（从 LayerVFS 快照到写入 `.git/objects/`）
- **Direct-Bypass 槽位测试与缓存隔离物理回收**：`< 20ms`（完全绕过 LayerVFS，享受物理 SSD 原生 I/O）
- **TKCV 形式化推导全量校验耗时**：`< 5ms`（纯内存 AST/CFG 扫描，零外部进程开销）
- **IKCE 隐藏微变异盲测击杀率刚性下限**：`K >= 60.0%`（破除空断言与恒真测试虚假通过）
- **密码学防篡改审计收据体积**：`< 350B`（单行紧凑 NDJSON + HMAC-SHA1 链式签名）
- **SubAgent 物理空间回收耗时**：`< 50ms`（完成即物理卸载，DAG 拓扑全息留存）
- **原位解压峰值空间占用**：`max(S_archive, S_extracted) + Delta_batch`（根治 2x 磁盘悬崖与 ENOSPC）
- **全量回归测试套件通过率**：`100%`（911 项单元与集成测试全部绿灯通过）
- **代码质量免疫拦截**：`自动化复合刚性门禁`（TKCV 不变式推导 + IKCE 盲测金丝雀 + 三层拓扑 Diff）
