---
name: rule-catalog-governance
description: >-
  全工作区单源规则目录（SSOT）、元数据一致性与规则反虚构治理规范。指导 Agent 聚合全仓跨项目规则，
  落实标准 3-3-3 命名拓扑与 104 项权威词典、三阶别名等价网络、底层诊断与表现层去重解耦及 RCFG-RULE-DRIFT 防虚构门禁。
---

# rule-catalog-governance — 全仓单源规则目录与元数据一致性治理

本技能规范了工作区静态分析与审查规则的单源聚合机制（Single Source of Truth, SSOT）、标准 3-3-3 命名拓扑公理、权威 104 项三字母映射词典、三阶双轨别名等价网络、底层完备诊断与表现层语义去重双层解耦公理、跨项目规则族命名空间边界、三大项目规范注册流程与规则防虚构门禁（`RCFG-RULE-DRIFT`）。

---

## 一、 适用场景与触发条件

在以下任一开发或治理场景中，必须激活本技能：
1. **新增、修改或弃用静态分析/审查规则**（涉及 `auto-refactor`、`workspace-timing` 或 `WebGames`）；
2. **在 Git 提交说明（Commit Message）中引用规则 ID**；
3. **维护度量评估系统与评分算法**（CAI 自研率、质量置信度区间估算）；
4. **执行全仓单源规则目录同步更新与校验**（`scripts/common/generate-rule-catalog.js`）；
5. **排查 `RCFG-RULE-DRIFT`（规则未登记或虚构代号）门禁阻断**。

---

## 二、 全仓单源规则目录架构 (`rule-catalog.json`)

工作区维护全局唯一的规则真源注册表，任何规则必须在注册表中登记后方可在代码、配置、分析报告或提交说明中生效：
- **SSOT 文件路径**：`scripts/common/rule-catalog.json`
- **生成与聚合脚本**：`scripts/common/generate-rule-catalog.js`
- **纳管规模与形态**：跨三大项目聚合活跃规则（计数以 `scripts/common/rule-catalog.json` 为准），结构元数据如下：
  ```json
  {
    "schema": "workspace-rule-catalog/v1",
    "totalRules": "<generated>",
    "counts": {
      "autoRefactor": 338,
      "workspaceTiming": 49,
      "webGames": 29,
      "globalTooling": 12
    },
    "rules": [
      {
        "id": "ARCH-FAC-001",
        "title": "门面模块必须满足实质承载与不可变性预算",
        "category": "architecture",
        "severity": "error",
        "analyzer": "architecture",
        "family": "ARCH",
        "dimension": "topological_coupling"
      }
    ]
  }
  ```

### 规则分布矩阵
1. **`autoRefactor` (338 条)**：涵盖 30 个内置分析器与四层金字塔体系，通用多语言代码重构、AST 语法树、Rust 双轨算子与架构质量模型；
2. **`workspaceTiming` (49 条)**：涵盖 VS Code 扩展审查体系的 L0~L5 六层刚性防线（编译、存储崩溃安全、时间守恒、i18n、性能与 UI 对比度）；
3. **`webGames` (29 条)**：涵盖 Godot 游戏工程的文档治理（`DOC-`、`LINK-`）、高性能脚本契约（`ADV-`）与配置架构审查规则；
4. **`globalTooling` (12 条)**：涵盖提交规范与禁词风格拦截（`CMG-STY-001`~`006`, `CMG-PRJ-001`）以及平台脚本工程化、AST 切片隔离与门面实质承载守卫（`GUARD-AST-001`, `GUARD-ISO-001`, `ARCH-ABS-001`, `ARCH-FAC-001` 等）。

---

## 三、 标准 3-3-3 命名拓扑公理与 104 项权威词典

工作区所有通用规则统一遵循「标准 3-3-3 命名拓扑公理」，杜绝随意缩写与序号断层：
$$\text{Family (3 字母)} - \text{Topic (3 字母)} - \text{Sequence (3 位数字)}$$

- **Family**：核心分析器或业务治理域（如 `ARCH`、`PRF`、`SIM`、`SEC`、`NAM`，少数平台脚本为 2 字母如 `SH`, `PS`, `UI`）；
- **Topic**：权威 3 字母大写缩写（如 `FAC` 门面、`MEM` 内存、`TOK` 凭证、`ARG` 参数）；
- **Sequence**：3 位定长递增数字，自 `001` 起始单调递增（全仓仅 5 项历史规则因双生背景从 `002` 起始：`ARCH-DEC-002`, `ARCH-DSP-002`, `GOV-RTC-002`, `NAM-JRG-002`, `SIM-FLAT-002`）；
- **104 项权威词典**：在 `auto-refactor/src/core/rules/topic-catalog.ts` 中单源收录，通过 `normalizeTopicCode` 与 `toCanonicalRuleId` 强制将 4+ 字母历史形归一化为标准 3 字母。

---

## 四、 三阶双轨别名等价网络与平滑演进

为兼顾 3-3-3 规范演进与历史基线、行内抑制注释 100% 兼容，`auto-refactor/src/core/rules/aliases.ts` 提供三阶等价网络：
1. **一阶（精确字符串全等）**：`left === right` 直接命中；
2. **二阶（历史 Legacy 映射）**：通过 `LEGACY_RULE_ALIASES` 兼容旧版 kebab-case 规则名：
   ```typescript
   // 历史别名映射示范
   'high-complexity': 'CPX-CYC-001',
   'large-file': 'BIG-SIZE-001'
   ```
3. **三阶（3-3-3 规范形态等价）**：通过 `toCanonicalRuleId` 互认 4+ 字母历史形与 3 字母规范形：
   ```typescript
   // 规范主题归一化等价示范
   toCanonicalRuleId('ARCH-DISP-001') === 'ARCH-DSP-001';
   ```

---

## 五、 底层完备诊断与表现层语义去重双层解耦公理

针对度量证据完整性与人类审查认知负荷的矛盾，实行双层解耦：
1. **扫描底座 100% 完备无损发射 (Stage 0~3)**：分析器遍历 AST 与符号图时必须保持完备发射，严禁在扫描底座私自过滤丢弃 Issue，确保质量模型证据链完整；
2. **表现层并查集语义聚合 (`semantic-correlation.ts`)**：呈现给 IDE 诊断卡片时，使用并查集对同文件同行的 11 组重叠规则族聚类，按严重级别权重（`block > warn > info > pass`）选举主卡片，次级规则收拢至 `correlatedRules` 数组，彻底消除刷屏认知疲劳。

---

## 六、 跨项目规则族前缀命名空间规范

严格划分四大项目域的规则族前缀边界，杜绝跨项目命名踩踏与误杀：

| 项目领域 (`Project`) | 规则规模 | 权威合法规则族前缀 / 命名空间 | 治理范围与职责边界 |
| :--- | :---: | :--- | :--- |
| **`auto-refactor`** | 338 条 | 30 个分析器内置家族：`ARCH`, `BIG`, `CMP`, `CMT`, `CONST`, `CPX`, `DAT`, `DEP`, `DOC`, `ERR`, `GATE`, `GDM`, `GOM`, `GOV`, `HYG`, `NAM`, `NUM`, `PRF`, `PROD`, `PS`, `PYM`, `RSM`, `SEC`, `SH`, `SIM`, `STDLIB`, `TSM`, `TST`, `UI`, `VSC` 及 15 条 Legacy 别名 | 通用多语言代码重构、AST 语法树、Rust 双轨算子、复杂度与架构质量模型 |
| **`workspace-timing`** | 49 条 | L0~L5 六层审查体系：`L0-`, `L1-`, `L2-`, `L3-`, `L4-`, `L5-`；扩展专属族：`ARF-`, `DOC-`, `HC-`, `LAY-`, `RCFG-`, `RES-`, `SCR-`, `TB-` | VS Code 扩展生命周期、分层存储安全、i18n 对齐、时间守恒与状态栏治理 |
| **`WebGames`** | 29 条 | Godot 专属契约：`ADV-`（高性能脚本与引擎约束）、`DOC-`、`LINK-`（文档与跨卷链接）、`PRF-`、`RES-`、`UUID-`、`SIM-` | Godot 4 游戏逻辑、节点树信号契约、文档双语归档与配置单源治理 |
| **`global-tooling`** | 12 条 | 通用门禁与治理族：`CMG-`（提交说明规范）、`GATE-`（平台脚本与 AST 隔离守卫）、`VOL-`、`ARCH-`（`ARCH-ABS-001`, `ARCH-FAC-001`） | 跨平台工作区门禁、提交说明防虚构、沙箱隔离、代码行预算与门面实质承载 |

---

## 七、 三项目规则纳管与规范注册 SOP

向工作区新增或调整规则时，必须依项目标准流程注册，严禁未注册先引用：
1. **`auto-refactor` (338 规则体系)**：在 `src/core/rules/entries/` 定义规则对象；在 `dimensionRuleTable.ts` 绑定权重（遵守 `MAX_AXES_PER_FINDING <= 4`）；在 `tests/rules/` 编写专属测试；若涉原生算子保证 Rust 与 TS 100% 等价；
2. **`workspace-timing` (49 规则体系)**：在 `scripts/config/review-rules.json` 中使用 `L0~L5` 六层体系前缀登记；
3. **`WebGames` (29 规则体系)**：在 `scripts/config/docs_governance_rules.json` 或 `scripts/py/audit_docs.py` 中登记规则元数据；
4. **全仓同步触发与 `--check-only` 零漂移断言**：新增或修改规则后必须运行 `node scripts/common/generate-rule-catalog.js` 同步真源；在门禁与 CI 中运行 `node scripts/common/generate-rule-catalog.js --check-only` 阻断规则漂移。

---

## 八、 提交说明规则反虚构门禁 (`RCFG-RULE-DRIFT`)

`commit-msg-gate` 集成 `scripts/common/validate-commit-msg.js`：
1. **正则精准捕获**：自动提取形如 `[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}`、`L[0-5]-[A-Z0-9\-]+` 与 `RCFG-[A-Z\-]+` 的规则词条；
2. **白名单过滤**：豁免标准协议与编码常量（`UTF-8`, `SHA-256`, `RFC-7231`, `HTTP-2`, `IEEE-754` 等）；
3. **一票否决阻断**：捕获的规则词条若在 `rule-catalog.json` 中查无记录，立即以 `[REJECT] RCFG-RULE-DRIFT` 阻断提交。

---

## 九、 客观度量求真与技术债务防反弹

- **客观统计零注水**：所有度量、自研率（CAI）与符号分析必须从 0 客观统计，基于 AST 真实符号索引追踪，严禁人工加分与注水；
- **统计模型委托**：度量置信度区间估算统一遵循经典贝叶斯后验模型，具体数学推导与参数约定收口至 [telemetry-statistical-modeling](../telemetry-statistical-modeling/SKILL.md)；
- **零高危技术债务刚性基线**：全工作区 High/Critical 技术债务历史性归零（0 项），新增或调整规则严禁引入技术债务反弹。

---

## 十、 常用命令与校验工具

```powershell
# 1. 扫描三大项目并全量生成单源规则目录 (SSOT)
node scripts/common/generate-rule-catalog.js

# 2. 校验规则注册表与磁盘快照 100% 零漂移（CI 与门禁预审断言）
node scripts/common/generate-rule-catalog.js --check-only

# 3. 本地验证提交说明中的规则 ID 是否真实存在
node scripts/common/validate-commit-msg.js <path-to-commit-msg-file>

# 4. 运行 pre-commit 门禁中的规则一致性校验 (SKILLS-SPEC-03)
pwsh -File scripts/ps1/pre-commit-gate.ps1

# 5. 执行全工作区快速审查中枢核验
pwsh -File scripts/ps1/audit-all.ps1 -Fast
```
