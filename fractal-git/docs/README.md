# Fractal Git 核心技术文档库索引

> **模块定位**：工作区第四大核心系统 (`fractal-git/`) 权威技术案卷全宗  
> **关联蓝图真源**：[`docs/agent-native-system-blueprint.md`](../../docs/agent-native-system-blueprint.md) §4.2~§4.3  
> **历史档案归档说明**：Taxis 早期阶段性施工进度记录已封存至工作区归档目录 [`archive/fractal-git/07-taxis-construction-progress.md`](../../archive/fractal-git/07-taxis-construction-progress.md)（只读存证，不参与活跃维护）。

---

## 专册目录导航

| 案卷编号 | 案卷标题 | 核心议题与解决的关键痛点 |
| :--- | :--- | :--- |
| [**`01-architecture-principles.md`**](01-architecture-principles.md) | **架构第一性原理与自相似拓扑规范** | 阐明分形自相似性与尺度不变性公理；明确父级私有工作树 $\neq$ 部门集成主树的分层物理工作树隔离机制；确立两道人类战略关卡与一体两面双载荷机制。 |
| [**`02-ecosystem-survey-and-lessons.md`**](02-ecosystem-survey-and-lessons.md) | **现代 Git 生态与实验性路线经验吸纳** | 吸纳 `gix` 纯无锁 Plumbing 算子；剖析 `jj` 在 Agent 场景下的设计错配；超越 `plasma-ai/fractal` 磁盘悬崖；内化 `hatchzip` 原位解压为具备事务一致性的 In-Place ODB 原位对象库引擎。 |
| [**`03-pre-review-zone-and-auto-gating.md`**](03-pre-review-zone-and-auto-gating.md) | **提交预审区双轨互锁与物理回收机制** | 确立从传统工作区缓冲到智能“提交预审区”的范式跃迁；三级双轨审查网矩阵；Praxis 底层宿主自动物化与瞬时物理按需回收（免依赖模型自觉）。 |
| [**`04-lockless-in-memory-engine.md`**](04-lockless-in-memory-engine.md) | **无锁内存虚拟索引与 CAS 原子物化内核** | 剖析消除 `.git/index.lock` 集中争用的内存虚拟树数据结构；递归嵌套 Git Tree 规范排序与二进制构建；LayerVFS CAS 快照到 Git Commit 的微秒级原子物化流水线。 |
| [**`05-advanced-algorithms-and-poset-mathematics.md`**](05-advanced-algorithms-and-poset-mathematics.md) | **数学体系与算法算子第一性原理演进** | 系统推导并落地偏序集单调保序 Corrected Commit Date (CCD v2, 12ns/77.8M op/s)、范畴论推标（Pushout）直和简并、Kirsch-Mitzenmacher 256-bit 路径 Bloom 过滤（161ns/6.2M op/s）、SWAR 64 位整字并行文本差分与 Elias-Fano 准简洁位向量压缩。 |
| [**`06-anthropic-scion-benchmark-and-parity-spec.md`**](06-anthropic-scion-benchmark-and-parity-spec.md) | **Anthropic Scion 架构解构与 Taxis 五维基准压测规范** | 复盘 Claude 团队高频代码合并场景与 Scion 三级解耦流式架构；确立 Taxis 正式版本五维基准测试套件（检出延迟、高并发合并、路径 Bloom 剪枝、内存零堆分配与离线弹性）及演进路线。 |
| [**`08-taxis-in-place-storage-engine.md`**](08-taxis-in-place-storage-engine.md) | **Taxis 原位存储引擎 (In-Place ODB Engine) 规约** | 阐明逆向尾部截断（Tail-First）、前向打洞（Hole Punching）、离散水位模拟器（SpacePlan）、WAL 崩溃可逆恢复与分片包递进轮转（Pack Slicing）。 |
| [**`09-test-cache-and-telemetry-audit-spec.md`**](09-test-cache-and-telemetry-audit-spec.md) | **专属测试与缓存区、内核验证器与密码学独立遥测审计规约** | 阐明 Direct-Bypass 独占测试与编译缓存直通空间、TKCV 形式化抽象推导器、IKCE 内存微变异击杀率验证引擎、贝叶斯动态信用与 `refs/fractal/telemetry/*` 密码学防篡改遥测审计哈希链及分层树状归约台账。 |
| [**`10-single-threaded-e2e-benchmark-and-progressive-projection.md`**](10-single-threaded-e2e-benchmark-and-progressive-projection.md) | **单串行端到端基准评测与渐进切分投影规约** | 规范单串行隔离环境下标准 Git 贪婪检出与 Taxis 渐进投影评测流水线；明确时延、物理零写、首字节时延（TTFB）、FastCDC `apply_edits` 局部自愈与微秒级 WAL 同步回写等五阶段技术度量体系与基准对比。 |
| [**`ALGORITHMIC_OPTIMIZATION_SURVEY.md`**](ALGORITHMIC_OPTIMIZATION_SURVEY.md) | **Taxis 紧凑数据结构与渐进投影算法全景调研报告** | 涵盖 PTHash/RecSplit 最小单射哈希、分层增量 Merkle 拓扑、FastCDC 边界自愈与两阶段日志解耦的前沿与冷门算法全景调研。 |
| [**`ARCHITECTURE.md`**](ARCHITECTURE.md) | **系统架构总览与快速规范查阅手册** | 包含 Mermaid 分形拓扑图、生命周期状态转移矩阵、端到端评测集成与核心接口速查表。 |
| [**`DIRECTORY_SPEC.md`**](DIRECTORY_SPEC.md) | **全域目录职责矩阵与单向依赖扩展指引** | 规范 10 大内核子系统物理职责、单向依赖 DAG 拓扑图与架构扩展路由准则。 |

---

## 关键技术指标总览 (Key Metrics)

- **并发锁机制**：基于内存树解耦传统 `.git/index.lock` 集中写争用
- **CCD v2 偏序祖先可达性判定**：`12 ns / 77,881,620 op/s`（$O(1)$ 严格单调保序排除）
- **路径 Bloom 过滤器查询延迟**：`132 ~ 161 ns / 6,199,628 op/s`（有效过滤树解包）
- **流式树差分吞吐**：`11.13 µs / 89,820 op/s`（层次化双指针流扫描 + $O(1)$ 子树剪枝）
- **SWAR 64 位并行文本差分**：`10.52 µs / 95,028 op/s`（单块扁平连续磁带 + 零堆分配）
- **线程局部缓冲池分配耗时**：`98 ns / 10,175,010 op/s`（3 阶尺寸桶无锁复用）
- **虚拟分支物化耗时**：`5 ~ 10ms`（从 LayerVFS 快照到写入 `.git/objects/`）
- **Direct-Bypass 槽位测试与缓存隔离物理回收**：`< 20ms`（绕过虚拟层，直接使用物理存储 I/O）
- **TKCV 形式化推导全量校验耗时**：`< 5ms`（纯内存 AST/CFG 扫描，无需外部进程开销）
- **IKCE 隐藏微变异盲测击杀率刚性下限**：`K >= 60.0%`（拦截空断言与恒真测试通过）
- **密码学防篡改审计收据体积**：`< 350B`（单行紧凑 NDJSON + 链式哈希签名）
- **SubAgent 物理空间回收耗时**：`< 50ms`（完成即物理卸载，DAG 拓扑保留）
- **原位解压峰值空间占用**：`max(S_archive, S_extracted) + Delta_batch`（避免双倍磁盘暂存占用）
- **E2E 渐进投影工作区就绪时延**：`20 ms`（较标准 Git 检出加速 13.6x）
- **E2E 虚拟工作区物理写入**：`0 文件 / 0 KB`（减少 100% 物理 I/O）
- **E2E 首字节读取时延 (TTFB)**：`20,677 µs`（较标准 Git 加速 13.6x，保持二进制一致）
- **E2E 局部修改分块复用率**：`81.8%`（FastCDC 边界愈合，13 µs 局部重分块）
- **E2E 同步事务落盘时延**：`2,998 µs`（WAL TAXW 帧，较完整 Git 提交加速 2.7x）
- **E2E 评测常驻内存峰值**：`6.45 MB`（严格受控于 `FGT-PRF-001`）
- **全量回归测试套件**：1,107 项内核单元、集成与微基准测试全数通过验证
- **代码质量免疫拦截**：`自动化复合刚性门禁`（TKCV 不变式推导 + IKCE 盲测金丝雀 + 三层拓扑 Diff）
