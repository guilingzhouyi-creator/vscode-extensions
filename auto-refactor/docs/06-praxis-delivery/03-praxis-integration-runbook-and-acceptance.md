# 03. Praxis 团队联调操作手册与交付验收矩阵

> **所属层级**：L6 Praxis 团队交付专层 (`docs/06-praxis-delivery/`)  
> **对应代码真源**：[`praxis-review-client.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/praxis/praxis-review-client.ts)、[`semantic-correlation.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/praxis/presentation/semantic-correlation.ts)、[`presentation-adapter.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/praxis/presentation/presentation-adapter.ts)、[`sliceAuditService.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/praxis/sliceAuditService.ts)、[`scripts/test-parallel.js`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/scripts/test-parallel.js)

---

## 1. 快速接入与环境要求

### 1.1 运行时环境契约
- **Node.js 版本**：`>= 20.0.0`
- **模块入口**：CommonJS `dist/api.js`，TypeScript 类型声明 `dist/api.d.ts`
- **Rust N-API 原生算子自动降级**：
  - 若 `crates/*/index.node` 存在，自动启用 Rust 原生加速；
  - 若处于无编译环境的沙箱或轻量容器中，[`native-bridge.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/native/native-bridge.ts) 自动无缝降级至 100% 字节等价的纯 TypeScript 算子实现，调用端零感知。

---

## 2. 端到端最佳实践：基于 `createPraxisClient` 的双载荷审查

Praxis 推荐统一使用 [`createPraxisClient`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/praxis/praxis-review-client.ts) 进行代码审查，一次调用即可同时获得给 **AI Agent 消费的机器指令** 与给 **人类审查者消费的 UI 诊断卡片**：

```ts
import { createPraxisClient } from 'auto-refactor';

async function executePraxisReview() {
    // 1. 初始化客户端实例（配置根路径、默认多智能体上下文与本地化语言）
    const client = createPraxisClient({
        root: process.cwd(),
        defaultLocale: 'zh-CN',
        defaultCardContext: {
            cardId: 'card-payment-refactor-01',
            cellId: 'cell-checkout',
            agentUid: 'agent-coder-9',
        },
    });

    // 2. 发起全工作区/增量代码审查
    const verdict = await client.reviewWorkspace({
        failOnSeverity: 'warning',
        includeDualFacedPresentation: true,
    });

    console.log(`审查状态: ${verdict.status}`); // 'passed' | 'warning' | 'blocked'

    // 3. 【机器平面消费】直接注入 AI Agent Prompt 上下文
    if (verdict.directivesMarkdown) {
        console.log('=== 供 Agent 消费的 Markdown 指令 ===');
        console.log(verdict.directivesMarkdown);
    }
    if (verdict.cappDirectiveText) {
        console.log('=== 超紧凑 CAPP 单行 DSL ===', verdict.cappDirectiveText);
    }

    // 4. 【表现平面消费】渲染至 IDE WebView 或 PR 审查卡片
    if (verdict.presentationPayload) {
        const { summaryText, cards } = verdict.presentationPayload;
        console.log(`=== 表现层概要: ${summaryText} ===`);
        for (const card of cards) {
            console.log(`[${card.badgeText}] ${card.file}:${card.line} - ${card.title}`);
            console.log(`  修复建议: ${card.remediation}`);
            if (card.correlatedRules && card.correlatedRules.length > 0) {
                console.log(`  🔗 并查集已合并关联规则: ${card.correlatedRules.join(', ')}`);
            }
        }
    }
}
```

---

## 3. `SEMANTIC_OVERLAP_GROUPS` 并查集去重消费规范

在密集代码重构中，一个局部坏味道往往会并发触发 3~4 条相关规则（例如深层嵌套同时触发圈复杂度、卫语句缺失与扁平化建议）。为了消除开发者认知疲劳，[`semantic-correlation.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/praxis/presentation/semantic-correlation.ts) 维护了 **11 组语义重叠规则族**，并在表现层通过并查集算法聚合：

### 3.1 十一组语义重叠规则族权威清单

```ts
export const SEMANTIC_OVERLAP_GROUPS: ReadonlyArray<ReadonlySet<string>> = Object.freeze([
    new Set(['HYG-STB-002', 'GOV-SAN-001']),                              // 1. 空占位符与清理消毒
    new Set(['NAM-FIL-001', 'GOV-FIL-001']),                              // 2. 文件命名与文件治理
    new Set(['ARCH-FAC-001', 'ARCH-ABS-001']),                            // 3. 工厂模式与抽象泄漏
    new Set(['SIM-FLAT-002', 'SIM-GUARD-001', 'CPX-NEST-001', 'CPX-NEST-002']), // 4. 控制流嵌套与扁平卫语句
    new Set(['HYG-WRAP-001', 'ARCH-FAC-001']),                            // 5. 冗余封装与工厂边界
    new Set(['HYG-CLN-001', 'CPX-RED-001']),                              // 6. 代码克隆与冗余分支
    new Set(['SEC-LEAK-001', 'GOV-SAN-001']),                             // 7. 凭据泄露与敏感消毒
    new Set(['GDM-POOL-001', 'PRF-MEM-001', 'PRF-MEM-002']),              // 8. 对象池与内存瞬态分配
    new Set(['ARCH-DISP-001', 'ARCH-DSP-002']),                           // 9. 动态分发与调度契约
    new Set(['NAM-DIR-001', 'ARCH-DIR-001']),                             // 10. 目录命名与架构分层
    new Set(['NAM-ABR-001', 'NAM-VAG-001']),                              // 11. 模糊缩写与歧义命名
]);
```

### 3.2 并查集算法机制与双端消费规范
1. **坐标匹配与并查集归并**：
   - 针对相同文件与相同起始行（`file` + `line`）的多条诊断卡片；
   - 若卡片规则属于同一重叠族，并查集算法执行 `union(cardA, cardB)`。
2. **主卡选举与元数据保留**：
   - **严重度权重优先级**：`block (4) > warn (3) > info (2) > pass (1)`；
   - 选举集合内严重度最高的卡片作为唯一主卡展示，其余次级规则写入主卡的 `correlatedRules: string[]` 元数据。
3. **双端差异化消费原则**：
   - **UI 呈现端**：仅渲染主卡，在折叠标签中显示「同时关联：X 规则」，界面清晰清爽；
   - **Agent 执行端**：底层仍保留完整的 325 条细粒度规则诊断与 `sourceAgentDirective`，确保 AI 智能体拥有 100% 的准确依据以产出无遗漏的补丁。

---

## 4. 交付验收矩阵与 153/153 自动化门禁

Praxis 交付以 **153/153 套自动化门禁套件**（148 套独立并行验证套件 + 5 套串行守护进程套件）为刚性验收基线：

| 验收核心域 | 验证命令 / 脚本路径 | 核心断言内容 | 验收标准 |
| :--- | :--- | :--- | :---: |
| **规则完整性与注册一致性** | `npm run validate-rules-registry` | 30 个分析器与 325 条注册规则 100% 覆盖无孤儿规则 | **PASS** |
| **Praxis 统一 SDK 与双载荷** | `npm run validate-praxis-presentation` | `createPraxisClient` 全工作区、单文件、双载荷与 i18n 汉化 | **PASS** |
| **11 组语义重叠并查集去重** | `npm run validate-dual-faced-presentation` | 验证并查集 `findRoot`/`union` 正确归并，次级规则沉淀到元数据 | **PASS** |
| **毫秒级切片与 Sparse MoE 路由** | `npm run validate-self-slice-audit` | 单切片执行时延 **< 10ms**，分析器绕过率 $\ge 70\%$ | **PASS** |
| **Rust N-API 与纯 TS 字节等价性** | `npm run validate-native-parity` | 6 大原生算子与纯 TS Shim 逐字节等价无漂移 | **PASS** |
| **自研率 CAI 与贝叶斯置信区间** | `npm run validate-autonomy-scorer` | 6 维正交自研率、L1~L5 边界、Jeffreys Beta(0.5, 0.5) 置信下界 | **PASS** |
| **三平面风险融合与共振放大** | `npm run validate-risk-fusion-engine` | $Risk = S^{1.0} \cdot D^{1.2} \cdot H^{0.8}$，双向确认升级 Critical | **PASS** |
| **全量自动化测试套件矩阵** | `npm test` | **153/153 全量测试套件并行与串行回归验证** | **153/153 PASS** |

---

## 5. 关联文档导航

- [01. Praxis 对接架构全景与六大 SPI 契约手册](./01-praxis-architecture-and-spi-contracts.md)
- [02. Praxis 七大核心治理服务与开发者 SDK 门面手册](./02-praxis-six-governance-services-api.md)
- [PRAXIS_HANDOFF_REPORT.md](../PRAXIS_HANDOFF_REPORT.md)
