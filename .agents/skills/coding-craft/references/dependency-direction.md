# 依赖方向与分层契约

> 依赖箭头只许向下。任何反向或环形依赖都会让编译、测试与替换同时失效。

---

## 一、 四层拓扑

| 层 | 职责 | 允许依赖 |
| :---: | :--- | :--- |
| **L4 界面 / 入口** | CLI、命令、Webview、状态栏 | L3、L2、L1 |
| **L3 应用编排** | 用例编排、事务边界、流程调度 | L2、L1 |
| **L2 领域模型** | 纯数据结构、业务规则、算法 | L1 |
| **L1 基础设施** | 文件、网络、存储、日志、时钟 | 仅标准库 |

判据：**L1 中出现任何 L2 及以上的 import，即 `DEP-INV-001`（error 级）**。

---

## 二、 依赖倒置的正确形态

```ts
// L2 领域层：声明需要什么，不知道谁提供
export interface Clock { now(): number }
export interface RuleStore { loadAll(): Promise<readonly Rule[]> }

export function findExpired(rules: readonly Rule[], clock: Clock): readonly Rule[] {
  const current = clock.now();
  return rules.filter((rule) => rule.expiresAt <= current);
}

// L1 基础设施层：实现接口
export class SystemClock implements Clock {
  now(): number { return Date.now(); }
}
```

组合根（L4 入口）负责把实现注入领域层。领域层永不 import 基础设施层。

---

## 三、 依赖类型矩阵

| 类型 | 判据 | 规则 |
| :--- | :--- | :--- |
| 生产依赖 | 运行时必需，进入产物 | — |
| 开发依赖 | 仅构建/测试期需要 | 进生产路径即 `DEP-DEV-001` |
| 延迟导入 | 函数内 `await import()` | 必须有审计说明，否则 `DEP-LAZ-001` |
| 幽灵依赖 | 未在清单声明却被 import | `DEP-PHANTOM-001` |
| 未固定版本 | `^` / `*` / `latest` 在锁文件缺失时 | `DEP-PIN-001` |
| 高危许可证 | AGPL / GPL 进闭源产品 | `DEP-LIC-001` |
| 循环导入 | A→B→A | `import-cycle` |
| 未使用模块 | 声明但零引用 | `unused-module` |

---

## 四、 环检测方法

1. **静态**：`node scripts/common/validate-rule-id-closure.js` 与各项目 lint 的 `import/no-cycle`；
2. **人工**：从任一模块出发做 DFS，记录路径；出现重复节点即环；
3. **消解**：把环上共享的部分上提到更低的层，或将其中一个方向改为依赖注入。

> [!WARNING]
> 「用动态 import 打破环」是假修复：环依然存在于运行时的加载顺序中，只是编译器看不见。

---

## 五、 跨层调用边界

- **允许**：上层 import 下层的公开入口；
- **禁止**：上层直接 import 下层内部文件路径（`../infra/internal/driver`）；
- **禁止**：下层通过回调反向持有上层的具体类型；
- **要求**：跨层数据结构必须是下层定义的接口或纯数据，不得是上层的 UI 模型。

---

## 六、 模块边界与导出

| 判据 | 要求 |
| :--- | :--- |
| 模块职责 | 单一，可由一句话描述 |
| 导出面 | 最小化，见 [api-surface-minimization.md](api-surface-minimization.md) |
| 反向依赖 | 零（`MOD-BWD-001`） |
| 扁平化 | 禁止跨层扁平引用（`MOD-FLB-001`） |
| 依赖声明 | 显式，禁止隐式全局 |

---

## 七、 自检清单

- [ ] 基础设施层是否 import 了领域模型？（应为 0）
- [ ] 是否存在循环导入？
- [ ] 开发依赖是否出现在生产路径？
- [ ] 延迟导入是否都有审计说明？
- [ ] 跨层调用是否只经过公开入口？
