# Fractal Git 核心技术文档库索引

> **模块定位**：工作区第四大核心顶级系统 (`fractal-git/`) 权威技术案卷全宗  
> **关联蓝图真源**：[`docs/agent-native-system-blueprint.md`](../../docs/agent-native-system-blueprint.md) §4.2~§4.3

---

## 专册目录导航

| 案卷编号 | 案卷标题 | 核心议题与解决的关键痛点 |
| :--- | :--- | :--- |
| [**`01-architecture-principles.md`**](01-architecture-principles.md) | **架构第一性原理与自相似拓扑规范** | 阐明分形自相似性与尺度不变性公理；明确父级私有工作树 $\neq$ 部门集成主树的物理隔离铁律；确立两道人类战略关卡与一体两面双载荷机制。 |
| [**`02-ecosystem-survey-and-lessons.md`**](02-ecosystem-survey-and-lessons.md) | **现代 Git 生态与实验性路线经验吸纳** | 吸纳 `gix` (Gitoxide) 纯无锁 Plumbing 算子并抛弃其单工作区 Porcelain；剖析 `jj` (Jujutsu) 在 Agent 场景下的“提交吞噬”败局；超越 `plasma-ai/fractal` 的 Python 磁盘 I/O 悬崖。 |
| [**`03-pre-review-zone-and-auto-gating.md`**](03-pre-review-zone-and-auto-gating.md) | **提交预审区双轨互锁与物理回收机制** | 确立从盲目“暂存区”到智能“提交预审区”的范式跃迁；三级双轨审查网矩阵；Praxis 底层宿主自动物化与瞬时物理按需回收（零依赖模型自觉）。 |
| [**`04-lockless-in-memory-engine.md`**](04-lockless-in-memory-engine.md) | **无锁内存虚拟索引与 CAS 原子物化内核** | 剖析彻底消融 `.git/index.lock` 锁争用的内存虚拟树数据结构；递归嵌套 Git Tree 规范排序与二进制构建；LayerVFS CAS 快照到 Git Commit 的微秒级原子物化流水线。 |
| [**`05-advanced-algorithms-and-poset-mathematics.md`**](05-advanced-algorithms-and-poset-mathematics.md) | **顶会数学体系与算法算子第一性原理演进** | 系统推导并落地偏序集单调保序 Corrected Commit Date (CCD v2, 12ns/77.8M op/s)、范畴论推标（Pushout）直和简并、Kirsch-Mitzenmacher 256-bit 路径 Bloom 过滤（161ns/6.2M op/s）、SWAR 64 位整字并行文本差分与 Elias-Fano 准简洁位向量压缩。 |
| [**`06-anthropic-scion-benchmark-and-parity-spec.md`**](06-anthropic-scion-benchmark-and-parity-spec.md) | **Anthropic Scion 架构解构与 Taxis 工业级五维基准压测规范** | 复盘 Claude 团队日均 30,000+ 次代码合并崩溃场景与 Scion 三级解耦流式架构；确立 Taxis 正式版本五维基准测试套件（检出延迟、高并发合并、路径 Bloom 剪枝、内存零堆分配与离线弹性）及演进路线。 |
| [**`ARCHITECTURE.md`**](ARCHITECTURE.md) | **系统架构总览与快速规范查阅手册** | 包含 Mermaid 分形拓扑图、生命周期状态转移矩阵与核心接口速查表。 |

---

## 关键技术指标总览 (Key Metrics)

- **并发锁争用率**：`0.0%`（完全脱离 `.git/index.lock`）
- **CCD v2 偏序祖先可达性判定**：`12 ns / 77,881,620 op/s`（$O(1)$ 严格单调保序排除）
- **路径 Bloom 过滤器查询延迟**：`132 ~ 161 ns / 6,199,628 op/s`（绕过 $99\%+$ 树解包）
- **流式树差分吞吐**：`11.13 µs / 89,820 op/s`（层次化双指针流扫描 + $O(1)$ 子树剪枝）
- **SWAR 64 位并行文本差分**：`10.52 µs / 95,028 op/s`（单块扁平连续磁带 + 零堆分配）
- **线程局部缓冲池分配耗时**：`98 ns / 10,175,010 op/s`（3 阶尺寸桶零锁复用）
- **虚拟分支物化耗时**：`5 ~ 10ms`（从 LayerVFS 快照到写入 `.git/objects/`）
- **SubAgent 物理空间回收耗时**：`< 50ms`（完成即物理卸载，DAG 拓扑全息留存）
- **代码质量免疫拦截**：`100% 形式化刚性门禁`（三层拓扑 Diff + `<10ms` AST 切片扫描）
