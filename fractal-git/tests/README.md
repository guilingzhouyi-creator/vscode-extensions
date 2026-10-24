# Fractal Git 测试工程化体系与基准规范

> **所属模块**：`fractal-git/tests/`  
> **核心使命**：提供跨栈确定性测试套件，杜绝孤儿用例，看守并发无锁性能与分形生命周期状态机。

---

## 目录分层架构

```
tests/
├── README.md                          // 本规范说明
├── rust/                              // Rust 深度单元与子系统回归测试 (共 21 项子系统测试)
│   ├── support/git_oracle.rs          // 以系统 git 生成期望对象的差分测试夹具
│   ├── test_object_codec.rs           // Rust 原生对象编解码与分形拓扑断言测试
│   ├── test_algorithms.rs             // FastCDC, TreeDiff, 3-way merge, DAG walker 算法测试
│   ├── test_algebraic_conflicts.rs    // 偏序集冲突代数与化简不变量测试
│   ├── test_benchmarks.rs             // 微基准耗时包络与性能基线回归测试
│   ├── test_commit_graph.rs           // 提交图遍历与代数去重测试
│   ├── test_commit_materializer.rs    // 提交物化、文件模式与工作树写入测试
│   ├── test_git_differential.rs       // 对象字节与系统 git oracle 逐字节差分测试
│   ├── test_git_hooks.rs              // Git 钩子契约运行器（参数/stdin/环境/退出码/超时）测试
│   ├── test_governance.rs             // 提交信息守卫与权限凭证治理测试
│   ├── test_governance_pipeline.rs    // 分级钩子管道与放行判定测试
│   ├── test_in_memory_index.rs        // 无锁内存虚拟树多线程并发构建测试
│   ├── test_index.rs                  // 冲突槽解析、阶段状态与索引版本测试
│   ├── test_operations.rs             // 操作图与撤销记录测试
│   ├── test_pools.rs                  // 内存池复用、页面缓冲与 Quota 配额守卫测试
│   ├── test_read_commands.rs          // 读命令退出码与输出对系统 git 的差分测试
│   ├── test_refs.rs                   // 引用校验、引用事务、reflog 与 packed-refs 测试
│   ├── test_relocate.rs               // 仓库迁移与工作树重定位测试
│   ├── test_self_hosted_ipc.rs        // 本地 IPC 帧协议与 Smart Protocol 编解码测试
│   ├── test_storage.rs                // CAS 块读写, WAL 日志与 Loose ODB 存储测试
│   ├── test_tag_codec.rs              // 标签对象编解码与黄金指纹测试
│   └── test_uac_promotions.rs         // 晋级请求与质量包络测试
└── ts/                                // TypeScript 端到端生命周期与编排测试 (共 3 项端到端测试)
    ├── fractal-lifecycle.test.ts      // 基础门禁拦截、原子物化与物理按需回收测试
    ├── git-parity.test.ts             // Pure-TS 对象物化与系统 git 的逐字节差分测试
    └── workspace-orchestration.test.ts// 多 Agent MCTS 变体打擂与优胜提拔编排测试
```

---

## 验收断言与质量红线
1. **并发无锁率**：并发多线程构建测试必须保证 `0%` 锁等待或冲突；
2. **生命周期回收率**：瞬态工作树在合入后物理槽位必须完全回收；
3. **零孤儿用例**：所有测试用例必须有清晰的断言意图与结构化输入输出，严禁无断言的假测试。
