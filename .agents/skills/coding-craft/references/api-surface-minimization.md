# 接口暴露最小化

> 导出面是承诺，承诺就要维护。每多一个导出符号，就多一份未来兼容性负担。

---

## 一、 默认不导出

| 场景 | 是否导出 |
| :--- | :--- |
| 跨模块调用方需要 | 导出 |
| 仅同文件内使用 | 私有 |
| 仅测试需要 | **不导出**，改为依赖注入 |
| 类型被导出函数的签名引用 | 导出（`export type`） |
| 常量被外部配置覆盖 | 导出且声明为只读 |

---

## 二、 禁止 `export *`

```ts
// 反模式：导出面随内部文件增长而失控
export * from './internal/parser';
export * from './internal/writer';

// 正模式：显式列出承诺面
export { parseRule } from './internal/parser';
export type { ParsedRule } from './internal/parser';
```

`export *` 的三重危害：
1. 内部新增符号自动成为公开 API，且无人察觉；
2. 重命名内部符号即构成破坏性变更；
3. 消费方无法从 import 语句看出依赖边界。

---

## 三、 门面实质承载

门面（facade / index）必须满足以下之一，否则应删除并让调用方直达：

- 聚合 ≥ 3 个子领域；
- 含不可变冻结（`Object.freeze` / 深度冻结）；
- 含实质调度、适配或降级逻辑；
- ELOC ≥ 15。

不满足即 `ARCH-ABS-001`（≤ 3 行纯转发跳板），必须内联消融。参见 [facade-discipline](../../facade-discipline/SKILL.md)。

---

## 四、 类型泄漏

```ts
// 泄漏：内部实现类型出现在公开签名中
import { InternalBuffer } from './internal/buffer';
export function createReader(): InternalBuffer { ... }

// 收敛：公开签名只用公开类型
export interface Reader { read(): string }
export function createReader(): Reader { ... }
```

判据：**公开签名引用的每个类型，都必须是公开导出的，或其结构被显式声明**。否则消费方被迫 import 内部路径。

---

## 五、 演进与废弃

| 阶段 | 动作 |
| :--- | :--- |
| 新增 | 加导出，同步文档与类型 |
| 修改签名 | 先加新签名（可选参数或新函数名），旧签名标注 `@deprecated` |
| 废弃 | `@deprecated` 注释 + 迁移示例，保留至少一个发布周期 |
| 删除 | 确认零调用方后移除，同步更新所有文档指针 |

禁止「静默改语义」：函数名不变但行为改变，是比删除更危险的变更。

---

## 六、 自检清单

- [ ] 每个导出符号是否都有至少一个跨模块调用方？
- [ ] 是否存在 `export *`？（应为 0）
- [ ] 公开签名引用的类型是否全部公开？
- [ ] 门面是否满足实质承载判据？
- [ ] 废弃项是否带 `@deprecated` 与迁移路径？
