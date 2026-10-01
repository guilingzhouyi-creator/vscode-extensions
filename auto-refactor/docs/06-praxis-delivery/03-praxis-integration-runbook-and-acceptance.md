# 03. Praxis 团队联调操作手册与交付验收矩阵

> **所属层级**：L6 Praxis 团队交付专层 (`docs/06-praxis-delivery/`)  
> **对应代码真源**：`src/api.ts`、`scripts/validate-praxis-foundation.js`、`scripts/validate-self-slice-audit.js`、`scripts/validate-feedback-adaptive-supervisor.js`

---

## 1. 快速接入与环境要求

### 1.1 运行时依赖契约

- **Node.js 版本**：`>= 20.0.0`
- **构建产物入口**：CommonJS 入口 `dist/api.js`，TypeScript 类型声明入口 `dist/api.d.ts`
- **原生算子加速（自动探测）**：若 `crates/*/index.node` 存在则自动启用 Rust N-API 原生加速；若在无编译工具链的沙箱环境中运行，`src/core/native/native-bridge.ts` 自动无缝切换至 100% 字节等价的纯 TypeScript 算子实现，调用方无需编写任何平台判断分支。

---

## 2. 端到端集成代码范例

### 2.1 场景一：单 Agent 增量编码切片毫秒级自审与 CAPP 指令生成

```ts
import {
    defaultPraxisSliceAuditService,
    CallGraph,
} from 'auto-refactor';

async function runAgentInnerLoopAudit() {
    const callGraph = new CallGraph();
    callGraph.addEdge('src/controllers/order.ts', 'createOrder', 'src/services/payment.ts', 'chargeCard');

    const sliceInput = {
        filePath: 'src/services/payment.ts',
        oldContent: 'export function chargeCard(amount: number): boolean { return amount > 0; }',
        newContent: 'export function chargeCard(amount: number, currency: string): boolean { return amount > 0; }',
        changedLines: [1],
    };

    // 1. 获取结构化切片审计裁决与 Sparse MoE 路由计划
    const verdict = await defaultPraxisSliceAuditService.auditSlice(sliceInput, callGraph);
    console.log('Bypass Ratio:', verdict.routingPlan.bypassRatio);
    console.log('Impact Files:', verdict.callImpact?.affectedCallers);

    // 2. 生成可直接注入 Agent Prompt 的紧凑英文修复指令 (CAPP)
    const capp = await defaultPraxisSliceAuditService.auditAgentSlice(sliceInput, callGraph);
    console.log('CAPP Prompt:\n', capp.formattedPrompt);
}
```

### 2.2 场景二：多 Agent 并发补丁合入前冲突与循环依赖仲裁

```ts
import { defaultPraxisMultiAgentGovernanceService } from 'auto-refactor';

async function arbitrateCellMerge() {
    const result = await defaultPraxisMultiAgentGovernanceService.reviewMultiAgentPatches(
        [
            {
                agentId: 'agent-alpha',
                cardId: 'card-101',
                filePath: 'src/auth/token.ts',
                beforeContent: 'export const v = 1;',
                afterContent: 'import { user } from "../user/profile";\nexport const v = 2;',
                addedImports: [{ from: 'src/auth/token.ts', to: 'src/user/profile.ts' }],
            },
            {
                agentId: 'agent-beta',
                cardId: 'card-102',
                filePath: 'src/user/profile.ts',
                beforeContent: 'export const user = "a";',
                afterContent: 'import { v } from "../auth/token";\nexport const user = "b";',
                addedImports: [{ from: 'src/user/profile.ts', to: 'src/auth/token.ts' }],
            },
        ],
        { duplicateWorkThreshold: 0.5 },
    );

    if (result.verdict !== 'approved') {
        console.error('Merge Blocked:', result.blockingIssues.map((i) => `${i.rule}: ${i.message}`));
    }
}
```

### 2.3 场景三：流式 Diff 订阅、环形缓冲 R4 冷存转储与卡级原子回滚

```ts
import {
    scanDiffStream,
    CircularDiffBuffer,
    PraxisRollbackEngine,
    createDefaultPraxisHooks,
} from 'auto-refactor';

async function streamAndRollbackDemo() {
    const rollbackEngine = new PraxisRollbackEngine();
    const ringBuffer = new CircularDiffBuffer({
        capacity: 64,
        flushIntervalMs: 0,
        onEvictToR4: (payload, archiveId) => {
            console.log(`Evicted ${payload.byteLength} bytes to R4 archive: ${archiveId}`);
        },
    });

    const oldText = 'const timeout = 1000;\nexport function init() {}\n';
    const newText = 'const timeout = 5000;\nexport function init() {}\n';

    for await (const event of scanDiffStream(
        [
            {
                kind: 'full',
                filePath: 'src/net/client.ts',
                oldContent: oldText,
                newContent: newText,
            },
        ],
        { praxisHooks: createDefaultPraxisHooks() },
    )) {
        if (event.type === 'hunk_ready' && event.hunk) {
            ringBuffer.push(event.hunk);
            rollbackEngine.recordCardHunk('card-net-01', 'src/net/client.ts', newText, event.hunk);
        }
    }

    // 当下游门禁或集成测试失败时，按任务卡一键逆序原子回滚
    const rollbackResult = rollbackEngine.revertCard('card-net-01');
    console.log('Rolled back files:', Array.from(rollbackResult.restoredContents.keys()));
    ringBuffer.dispose();
}
```

---

## 3. 交付验收矩阵与自动化门禁脚本清单

Praxis 团队在版本升级或 CI 集成验收时，可直接运行以下内置验证套件确认全部交付能力 100% 达标：

| 验收域 | 验证命令 / 脚本路径 | 核心断言内容 | 验收标准 |
| :--- | :--- | :--- | :---: |
| **Diff 算子与五大 SPI 基座** | `npm run validate-praxis`<br/>(`scripts/validate-praxis-foundation.js`) | FNV-1a 行哈希、Myers Diff、Hunk 构建、`CircularDiffBuffer` R4 二进制转储、`L3A` 升级判定、`scanDiffStream` 事件流、Hunk/Card 原子回滚 | 6 大测试块全 PASS |
| **增量 AST 切片与自审门禁** | `npm run validate-self-slice-audit`<br/>(`scripts/validate-self-slice-audit.js`) | `ASTSliceExtractor` 边界提取、Sparse MoE 激活旁路率、局部切片自审门禁零漏报 | 100% PASS |
| **反馈自适应权重监督器** | `npm run validate-feedback-adaptive-supervisor`<br/>(`scripts/validate-feedback-adaptive-supervisor.js`) | 事故台账记录、$(W_s, W_d, W_f)$ 凸投影归一化、规则置信度阻尼、模式稳定性加分、快照持久化恢复 | 100% PASS |
| **变更质量仲裁器** | `npm run validate-change-quality-arbiter`<br/>(`scripts/validate-change-quality-arbiter.js`) | 补丁前后质量分差分、恶化阻断、重构净收益判定 | 100% PASS |
| **三平面风险融合引擎** | `npm run validate-risk-fusion-engine`<br/>(`scripts/validate-risk-fusion-engine.js`) | 静态评分、动态遥测与演化风险融合计算确定性 | 100% PASS |
| **智能体配额与可操作性** | `npm run validate-agent-quota-gateway` &<br/>`npm run validate-agent-actionable` | Agent 并发配额限流与 CAPP 提示词可执行性验证 | 100% PASS |

---

## 4. 异常处理与降级保障契约

| 异常工况 | 引擎内置自愈与降级策略 | 对 Praxis 调用方的影响 |
| :--- | :--- | :--- |
| **语法残缺代码（Agent 编写中途未闭合括号）** | `ASTSliceExtractor` 与词法状态机自动回退至行级括号深度启发式切片 | 永不抛出未捕获语法异常，`auditSlice` 正常返回降级切片诊断 |
| **守护进程未启动或命名管道受限** | `scanWarm` / `scanDiff` 自动透明回退至进程内冷扫描 (`in-process fallback`) | 报告字节级 100% 一致，仅首次冷扫耗时增加，零中断 |
| **Native `.node` 二进制缺失或平台不匹配** | `NativeBridge` 自动切换至纯 TypeScript/JS 等价算子 (`native-*-shim.ts`) | 语义与输出 100% 等价（由 `validate-native-parity` 门禁锁死） |

---

## 5. 关联文档导航

- [Praxis 团队对接交付总报告 (Executive Handoff)](../PRAXIS_HANDOFF_REPORT.md)
- [01. Praxis 对接架构全景与五大 SPI 契约手册](./01-praxis-architecture-and-spi-contracts.md)
- [02. Praxis 六大核心治理服务门面 API 手册](./02-praxis-six-governance-services-api.md)
