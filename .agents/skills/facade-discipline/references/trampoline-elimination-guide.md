# 单行空包跳板判定与全库安全消融指南 (`ARCH-ABS-001`)

本指南规范了在代码库演进与模块重构过程中，识别、拦截与彻底消除单行空包跳板文件（Trampoline / Bounce Forwarder）的作业标准。

---

## 一、 单行空包跳板定义与判定标准

凡同时满足以下所有特征的文件，即判定为 `ARCH-ABS-001` 空包跳板违规：

1. **体积极小**：源码文件（`.ts` / `.js`）除去文件头版权与注释后，有效代码行 $\text{ELOC} \le 3$；
2. **纯转发导出**：内容仅为透传导出语句，形如：
   ```typescript
   export * from './internal/submodule';
   // 或
   export { SubComponent } from './internal/submodule';
   ```
3. **本地零实质声明**：文件内无任何本地定义的类、接口、类型别名、函数、常量或枚举；
4. **单一透传目标**：仅向单一目标文件进行无脑透明转发，未聚合任何其他正交子模块。

---

## 二、 架构危害与认知惩罚模型

1. **认知跃迁惩罚（Hop Penalty）**：跨层调用链每增加一层无实质承载的空包转发，产生认知跃迁惩罚（$\text{HopPenalty} = +3.0\text{ units/hop}$），严重增加代码阅读与审查心智负担；
2. **调试与调用栈模糊**：在调试断点或异常堆栈中引入无意义的跳转帧；
3. **破坏重构工具静态分析**：IDE 符号追踪（Find References / Go to Definition）被迫跨越中间跳板，降低开发体验。

---

## 三、 标准消融作业流程 (SOP)

### 步骤 1：扫描并定位跳板引用
使用 `git grep` 找出全库所有导入该跳板文件的上游消费者：
```bash
git grep -n "from ['\"].*old-trampoline['\"]"
```

### 步骤 2：原子重定向引用源头
批量修改上游调用方，将其 `import` 路径直接修改为底层的真实源头：
```typescript
// 修改前：
import { CoreEngine } from '../bridges/engine-bridge';

// 修改后：
import { CoreEngine } from '../engine/core-engine';
```

### 步骤 3：物理删除跳板文件
严禁保留空文件或纯注释文件，使用 `git rm` 物理移除：
```bash
git rm src/bridges/engine-bridge.ts
```

### 步骤 4：运行门禁验证跳板清零
运行静态门面治理审计，确保全仓跳板违规数为 0：
```bash
node auto-refactor/scripts/validate-facade-governance.js
```
控制台必须确认 `✔ [PASS] 0 trampolines found`。
