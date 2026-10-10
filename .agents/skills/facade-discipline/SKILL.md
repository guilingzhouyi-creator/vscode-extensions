---
name: facade-discipline
description: >-
  门面层实质承载、空包跳板消融与不可变性契约。指导 Agent 在重构、接口设计与模块导出时，
  落实最低 ELOC 预算（ELOC>=15）、深度不可变冻结保障、守护进程高可用门面与
  Praxis 客户端 SDK 门面实践，彻底根除单行空包跳板与虚空转发层。
---

# facade-discipline — 门面层实质承载与跳板消融工作流

本技能规范了系统架构中门面（Facade）、网关（Gateway）、适配器（Adapter）与顶层导出入口（Barrel Export）的设计与治理标准，建立实质业务承载底线，融入守护进程进程级容错与多智能体审查 SDK 门面工程实践，坚决清除单行空包跳板。

---

## 一、 适用场景与触发条件

在以下任一架构调整或代码重构场景中，必须激活本技能实施审查：
1. **创建或修改门面/网关模块**：凡模块命名或职责包含 `Facade`、`Gateway`、`Adapter`、`Manager` 或作为顶层公共入口 `index.ts`；
2. **构建子系统聚合与客户端 SDK**：如常驻后台守护进程中枢（`src/daemon/index.ts`）或跨域审查客户端 SDK（`PraxisReviewClient`）；
3. **重构或重命名底层模块**：移动或提取模块时，拟创建中间导出垫片以兼容旧引用；
4. **对外导出数据结构与快照**：门面层向外部消费者返回系统核心状态快照或跨域组合数据；
5. **门禁阻断排查**：本地或 CI 门禁触发 `ARCH-FAC-001`（门面虚假承载）或 `ARCH-ABS-001`（单行空包跳板）。

---

## 二、 门面层实质承载硬性预算 (`ARCH-FAC-001`)

门面层是跨子领域业务协同与防腐隔离的核心边界。任何门面、网关或顶层 Barrel 导出文件必须至少满足以下条件之一，杜绝“空壳转发”；同时必须严格遵守单文件双轨体积上限（$\text{ELOC} \le 900, \text{LOC} \le 1400$）与 1:3 动态反推包络约束，处于合法包络内的高内聚门面严禁破坏内聚性机械物理碎片化：

| 承载支柱 | 刚性约束指标 | 架构职责与防护目标 |
| :--- | :--- | :--- |
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
- **调试可追踪性损耗**：断点调试与 IDE 符号跳转陷入“跳板接力”，破坏调用栈直观性；
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

## 四、 核心门面实战工程范式

### 1. 守护进程中枢门面实践 (`src/daemon/index.ts`)
守护进程门面不只是一个纯粹的 Barrel 导出，它同时承担**进程生命周期高可用韧性守卫**的实质职责：
- **跨模块聚合**：同时聚合导出服务端（`server`）、客户端（`client`）、通信协议（`protocol`）、注册表（`registry`）与扫描处理器（`scanHandler`）等 5 大子模块；
- **进程级未捕获异常守卫 (`installDaemonRejectionGuard`)**：
  在模块加载期自动挂载 `unhandledRejection` 监听器，捕获全进程异步未决异常并记录至 stderr，阻止进程意外崩溃；
- **不可变诊断快照保障**：
  将异常上下文封装为不可变冻结对象，确保遥测链路安全：

```typescript
export function installDaemonRejectionGuard(
  onRejection?: (record: DaemonRejectionRecord) => void,
): () => void {
  const handler = (reason: unknown): void => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    const record: DaemonRejectionRecord = Object.freeze({
      timestamp: Date.now(),
      message: error.message,
      stack: error.stack,
    });
    process.stderr.write(`[auto-refactor daemon] unhandledRejection: ${record.message}\n`);
    if (typeof onRejection === 'function') {
      try {
        onRejection(record);
      } catch (callbackErr) {
        process.stderr.write(
          `[auto-refactor daemon] rejection callback failure: ${callbackErr instanceof Error ? callbackErr.message : String(callbackErr)}\n`,
        );
      }
    }
  };

  process.on('unhandledRejection', handler);
  return () => {
    process.off('unhandledRejection', handler);
  };
}

// 模块初始化时自执行守卫安装，落实实质承载
installDaemonRejectionGuard();
```

### 2. Praxis 统一审查客户端 SDK 门面实践 (`src/core/praxis/praxis-review-client.ts`)
作为面向开发者与自动化系统的旗舰级 SDK 门面，`PraxisReviewClient` 体现了高内聚门面的典范设计：
- **深度多系统编排（聚合度 $\ge 5$）**：
  统一整合并编排工作区扫描器（`Scanner`）、多语言语义图谱（`SemanticGraph`）、差异治理服务（`IPraxisDiffGovernanceService`）、门控路由器（`SparseMoEGateRouter`）、AST 切片审计服务（`IPraxisSliceAuditService`）与智能体指令协议包生成器（`AgentDirectives`）；
- **高阶统一语义 API**：
  对外暴露清晰的高阶方法，屏蔽底层流水线编排细节：
  - `reviewWorkspace(options)`：全工作区批量扫描与指令合成；
  - `reviewFile(filePath, content, options)`：单文件深度 AST 切片与 MoE 路由分析；
  - `reviewDiff(input, options)`：语义差异审查与爆炸半径（Blast Radius）控制；
  - `evaluateMergeGate(source, target, hunks)`：分支合并门禁评估与回滚风险检查；
- **双面 Diff (Dual-Faced Diff) 与 CAPP 协议合成**：
  门面自动合成面向机器执行的 AST 规则修复指令与面向人类审阅的交互式 UI 诊断卡片；
- **零配置工厂与开箱即用向后兼容**：
  提供 `createPraxisClient()` 工厂函数与单例导出 `defaultPraxisReviewClient`；
- **严格遵循复杂度与嵌套预算**：
  门面内部所有方法严控在 $\text{CC} \le 15$ 与 $\text{Depth} \le 4$ 预算之内，全量应用卫语句与防御性参数校验。

### 3. 消除跳板反模式前后对比
```typescript
// ❌ 错误示范：跳板文件 internal/bridge.ts (ELOC = 1, ARCH-ABS-001 违规)
export * from './real-service';

// ❌ 错误示范：虚假门面 gateway.ts (ELOC = 6, 仅透传单服务且无不可变保障)
import { RealService } from './real-service';
export class Gateway {
  private svc = new RealService();
  public run(): void { this.svc.run(); }
}

// ✅ 正确示范：消融跳板，上游调用方直接导入真实底层源头
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
- 门面模块代码行 $\text{ELOC} \ge 15$ 或通过 `Object.freeze` 落实深度不可变性，聚合 $\ge 3$ 个正交子系统；
- 关键守护中枢具备进程容错保护，审查 SDK 具备完备的多域协同编排能力；
- 全工作区 High/Critical 技术债务保持 0 项历史归零刚性基线，门面重构严禁引入任何新的技术债务反弹。

---

## 六、 关联模板与深度指引

- [contract-facade.ts](templates/contract-facade.ts)：实质承载门面标准实现模板；
- [trampoline-elimination-guide.md](references/trampoline-elimination-guide.md)：单行跳板全局消融作业指南。
