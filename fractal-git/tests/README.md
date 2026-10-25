# Fractal Git 测试工程化体系与基准规范

> **所属模块**：`fractal-git/tests/`  
> **核心使命**：提供跨栈确定性测试套件，杜绝孤儿用例，看守并发无锁性能与分形生命周期状态机。

---

## 目录分层架构

## 深度测试套件矩阵 (31 项 Rust 集成测试 + 3 项 TypeScript 端到端测试)

| 领域分类 | 测试套件文件 | 覆盖的核心机制与断言重点 |
| :--- | :--- | :--- |
| **底层对象与序列化** | `test_object_codec.rs`<br>`test_tag_codec.rs`<br>`test_pack_generation.rs` | Git Blob/Tree/Commit/Tag 规范二进制序列化、黄金指纹、Packfile v2 生成与 delta 压缩往返 |
| **偏序算法与图遍历** | `test_algorithms.rs`<br>`test_algebraic_conflicts.rs`<br>`test_commit_graph.rs`<br>`test_benchmarks.rs` | FastCDC 变长分块、3-Way Merge、偏序集冲突代数化简、CommitGraph 图链、TB-REGRESSION 耗时棘轮 |
| **存储底座与原位引擎** | `test_storage.rs`<br>`test_in_place_engine.rs`<br>`test_commit_materializer.rs` | CAS 存储、WAL 事务、**TIPSE 逆向截断/打洞/SpacePlan 水位推演/低磁盘微包 GC 轮转**、Commit 原子物化 |
| **虚拟索引与工作树** | `test_index.rs`<br>`test_in_memory_index.rs`<br>`test_bounded_worktree.rs`<br>`test_relocate.rs`<br>`test_project_leases.rs` | 无锁内存虚拟树并发构建、冲突槽四阶段解析、有界工作树生命周期、Junction 重定位、租约控制 |
| **Git 对等与差分** | `test_git_differential.rs`<br>`test_config_parity.rs`<br>`test_read_commands.rs`<br>`test_edge_porcelain.rs`<br>`test_conflict_modes.rs`<br>`test_submodules.rs` | 系统 Git baseline 57 个向量逐字节差分、配置读写、读命令退出码、瓷器命令边缘用例、子模块路径防护 |
| **治理生命周期与传输** | `test_governance.rs`<br>`test_governance_pipeline.rs`<br>`test_git_hooks.rs`<br>`test_operations.rs`<br>`test_interactive_operations.rs`<br>`test_pools.rs`<br>`test_refs.rs`<br>`test_uac_promotions.rs`<br>`test_self_hosted_ipc.rs`<br>`test_remote_transport.rs` | 提交信息规范与禁词拦截、分级 Hook 管道、Git 钩子执行器、操作图撤销、内存池复用、引用事务、晋级账本、IPC 帧协议与 Smart Protocol |
| **TypeScript 端到端** | `fractal-lifecycle.test.ts`<br>`git-parity.test.ts`<br>`workspace-orchestration.test.ts` | 门禁拦截与物理回收、Pure-TS 对象物化差分、多 Agent MCTS 变体打擂与提拔编排 |

---

## 验收断言与质量红线
1. **并发无锁率**：并发多线程构建测试必须保证 `0%` 锁等待或冲突；
2. **生命周期回收率**：瞬态工作树在合入后物理槽位必须完全回收；
3. **零孤儿用例**：所有测试用例必须有清晰的断言意图与结构化输入输出，严禁无断言的假测试。
