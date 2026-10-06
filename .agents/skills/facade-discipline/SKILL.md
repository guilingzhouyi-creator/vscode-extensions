---
name: facade-discipline
description: >-
  门面层实质承载、空包跳板拦截与不可变性契约。指导 Agent 在重构、接口设计与模块导出时，
  识别并消除虚空转发层，落实最低 ELOC 预算、运行时契约校验与不可变快照模式。
---

# facade-discipline — 门面层实质承载与跳板消融工作流

本技能规范了系统架构中门面（Facade）、网关（Gateway）、适配器（Adapter）与顶层导出入口（Barrel Export）的设计与治理标准，建立实质业务承载底线，坚决清除单行空包跳板。

---

## 一、 适用场景与触发条件

在以下任一架构调整或代码重构场景中，必须激活本技能实施审查：
1. **创建或修改门面/网关模块**：凡模块命名或职责包含 `Facade`、`Gateway`、`Adapter`、`Manager` 或作为顶层公共入口 `index.ts`；
2. **重构或重命名底层模块**：移动或提取模块时，拟创建中间导出垫片以兼容旧引用；
3. **对外导出数据结构**：门面层向外部消费者返回系统核心状态快照或跨域组合数据；
4. **门禁阻断排查**：本地或 CI 门禁触发 `ARCH-FAC-001`（门面虚假承载）或 `ARCH-ABS-001`（单行空包跳板）。

---

## 二、 门面层实质承载硬性预算 (`ARCH-FAC-001`)

门面层是跨子领域业务协同与防腐隔离的核心边界。任何门面、网关或顶层 Barrel 导出文件必须至少满足以下条件之一，杜绝“空壳转发”：

| 承载支柱 | 刚性约束指标 | 架构职责与防护目标 |
| :--- | :---: | :--- |
| **最低代码承载预算** | $\text{ELOC} \ge 15$ | 门面必须具备真实的业务编排、上下文生命周期管理或事件桥接逻辑，严禁仅包含 3~5 行简单转发 |
| **不可变快照封装保障** | `Object.freeze` / `deepFreeze` | 对外透出的状态快照、配置字典或聚合数据模型必须执行深度不可变冻结，封死外部调用方越权突变通道 |
| **多领域实质聚合度** | 聚合 $\ge 3$ 个正交子领域 | 门面必须统一整合编排 3 个及以上相互独立的底层子系统；若仅透传 1~2 个子模块且无额外业务逻辑，强制消融门面直连 |
| **运行时防腐数据守卫** | 参数断言 / 运行时 Schema 校验 | 包含显式契约断言（如 `assertValidOptions`、`validatePayload`），在系统边界阻断脏数据向内层领域渗透 |

---

## 三、 单行空包跳板拦截与物理消融 (`ARCH-ABS-001`)

### 1. 空包跳板判定特征
源码文件（`.ts` / `.js`）凡同时满足以下所有特征，即严格判定为空包跳板（Trampoline / Bounce Forwarder）：
- 除去文件头版权与注释外，有效代码行 $\text{ELOC} \le 3$ 行；
- 内容实质仅包含 `export * from './sub'` 或 `export { X } from './sub'`；
- 文件内本地无任何实质声明（无 `class`、`function`、`interface`、`type`、`const`、`let`、`enum`）；
- 仅向单一目标文件进行无脑透明透传。

### 2. 空包跳板架构危害与惩罚模型
- **认知跃迁惩罚（Hop Penalty）**：在架构依赖分析中，跨层调用链每增加一层无实质承载的空包转发，产生认知跃迁惩罚（$\text{HopPenalty} = +3.0\text{ units/hop}$）；
- **调试可追踪性损耗**：断点调试与 IDE 符号跳转（Go to Definition）陷入“跳板接力”，破坏调用栈直观性；
- **治理纪律**：全仓严禁保留或创建此类文件，跳板违规数必须严格归零。

### 3. 标准消融 SOP 作业流
1. **全局检索引用点**：
   使用 `git grep` 找出全库所有引用该跳板文件的上游调用方；
2. **原子重定向调用**：
   将所有调用方的 `import` 路径直接修改为底层的真实模块源头；
3. **物理删除跳板**：
   使用 `git rm` 物理删除该跳板文件，禁止保留 0 字节文件或纯注释文件；
4. **运行全域门禁验证**：
   执行 `node auto-refactor/scripts/validate-facade-governance.js` 确保全仓跳板违规数为 0。

---

## 四、 规范设计模式与参考实现

### 1. 优秀门面设计规范（实质承载范式）
- 统一协调生命周期（初始化、注销、健康心跳）；
- 防御性参数校验（卫语句提前抛出契约异常）；
- 多子领域聚合计算与只读快照冻结返回。

详见规范模板：[contract-facade.ts](templates/contract-facade.ts)。

### 2. 消除跳板反模式前后对比
```typescript
// ❌ 错误示范：跳板文件 internal/bridge.ts (ELOC = 1, ARCH-ABS-001 违规)
export * from './real-service';

// ❌ 错误示范：虚假门面 gateway.ts (ELOC = 6, 仅透传单服务且无不可变保障)
import { RealService } from './real-service';
export class Gateway {
    private svc = new RealService();
    public run(): void { this.svc.run(); }
}

// ✅ 正确示范：消融跳板，上游调用方直接导入底层源头
import { RealService } from './real-service';
```

---

## 五、 本地验证指令与断言标准

在提交代码前，执行以下命令进行本地离线验证：

```powershell
# 1. 验证门面实质承载与跳板清零守卫 (ARCH-FAC-001 & ARCH-ABS-001)
node auto-refactor/scripts/validate-facade-governance.js

# 2. 验证暂存区预审门禁 (Gate 2 架构纪律)
pwsh -File scripts/ps1/pre-commit-gate.ps1
```

**质性断言标准**：
- 控制台输出 `✔ [PASS] Facade governance check passed`；
- 全仓单行空包跳板数量为 0；
- 门面模块代码行 $\text{ELOC} \ge 15$ 或通过 `Object.freeze` 落实深度不可变性，聚合 $\ge 3$ 个正交子系统。
