# Fractal Git 测试工程化体系与基准规范

> **所属模块**：`fractal-git/tests/`  
> **核心使命**：提供跨栈确定性测试套件，杜绝孤儿用例，看守并发无锁性能与分形生命周期状态机。

---

## 目录分层架构

```
tests/
├── README.md                          // 本规范说明
├── test_object_codec.rs               // Rust 原生对象编解码与分形拓扑断言测试 (根级集成测试)
├── rust/                              // Rust 深度单元与子系统回归测试
│   ├── test_in_memory_index.rs        // 无锁内存虚拟树多线程并发构建测试
│   └── test_self_hosted_ipc.rs        // 本地 IPC 帧协议与 Smart Protocol 编解码测试
└── ts/                                // TypeScript 端到端生命周期与编排测试
    ├── fractal-lifecycle.test.ts      // 基础门禁拦截、原子物化与物理按需回收测试
    └── workspace-orchestration.test.ts// 多 Agent MCTS 变体打擂与优胜提拔编排测试
```

---

## 验收断言与质量红线
1. **并发无锁率**：并发多线程构建测试必须保证 `0%` 锁等待或冲突；
2. **生命周期回收率**：临时工作树在合入后物理删除率必须达到 `100%`；
3. **零孤儿用例**：所有测试用例必须有清晰的断言意图与结构化输入输出，严禁无断言的假测试。
