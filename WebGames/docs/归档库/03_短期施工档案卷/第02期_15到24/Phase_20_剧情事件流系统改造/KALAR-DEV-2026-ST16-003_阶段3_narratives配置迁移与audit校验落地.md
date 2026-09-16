---
档号: KALAR-DEV-2026-ST16-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST16 (Phase_20_剧情事件流系统改造)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_20_剧情事件流系统改造 —— 阶段3：narratives配置迁移与audit校验落地
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 配置结构; 登记与加载声明; events.json
---

# 施工细则：剧情事件流系统改造 —— 阶段3：narratives 配置迁移与audit校验落地

> [!NOTE]
> **【施工目标】**：`config/narratives/*.json` 全量 `%s`→`{param}` 迁移（占位符语义化）；audit 新增剧情事件流校验（占位符残留归零 / 占位符语法与未填充扫描 / 配置为源零内联 / 事件流键唯一）；明确必需表登记关系与热重载接入声明。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST16-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST16-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：立项需求 ③（配置为源）④（audit 校验）⑤（占位符统一）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST16-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST16-001_阶段1_事件流数据契约与既有体系盘点.md) ｜ [阶段2](KALAR-DEV-2026-ST16-002_阶段2_事件流解析器与热切换管线实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST16-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 narratives 配置结构与迁移批次

### 1.1 配置结构（沿用，值层迁移）

| 项 | 现状 | 迁移后 |
| :--- | :--- | :--- |
| 表名 | `narratives.<文件>`（GameConfig 递归扫描自动发现，与 `items.<文件>` 同机制） | 不变（零装配） |
| 键 | 事件流 ID（`parry_interrupt` / `strike_hit` …） | 不变（逻辑键，小写蛇形） |
| **模板值** | C 风格 `%s 施展【%s】… %.1f 点物理破坏` | **`{param}` 语义化**（`{attacker} 施展【{skill_name}】… {damage} 点物理破坏`） |
| 键登记 | 无 | 经名称注册表登记 `narrative.<域>.<事件流ID>`（可查可解析） |

**迁移批次（全量 `%s`→`{param}`）**：`config/narratives/*.json` 逐文件改写模板值（combat/character_creation/clock/account/admin/bulletin_board 等），占位符命名与语义绑定（`{attacker}`/`{target}`/`{skill_name}`/`{damage}`/`{remaining_hp}`…），迁移后全库 `%s` 归零。

### 1.2 登记与加载声明

- **必需表**：`narratives.*` 由 GameConfig 递归扫描自动加载（既有机制，零 `_required_tables` 变更）；若后续新增事件流专用表（如 `config/narratives/events.json`）按既有规则登记；
- **事件流键登记**：`NarrativeFlowResolver` 首次加载各域配置时，将 `narrative.<域>.<事件流ID>` 经 `register_name_key` 登记（域所有者 = `narrative`），en_US 兜底 = 事件流 ID（英文键本体）；
- **热重载**：`GameConfig.reload()` 后 `resolve_flow` 实时读最新配置（零缓存）；会话表经 `NarrativeFlowSession.migrate_on_reload` 保持触发状态。

---

## 二、 audit 剧情事件流校验（新增脚本或并入既有链）

| 校验项 | 规则 | 违规级别 |
| :--- | :--- | :--- |
| **占位符残留归零** | `config/narratives/*.json` 模板含 `%s`/`%d`/`%.*f` → 违规 | 阻断 |
| **占位符语法** | 模板含裸 `{`/`}` 或空占位符 `{}` → 违规 | 阻断 |
| **配置为源零内联** | 后端代码出现剧情文案字符串字面量（含叙事关键词）→ 违规 | 阻断 |
| **事件流键唯一** | `narrative.<域>.<事件流ID>` 跨域重复 → 违规 | 阻断 |
| **名称键登记覆盖** | 事件流键未在名称注册表登记（audit 静态侧 = `narrative.*` 键集与配置一致） | 阻断 |

- 接线：挂入 `audit_runner.py`（`task_id="narrative_flows"`），事实源 = `config/narratives/*.json` + 事件流消费方代码扫描；
- 规则声明：同步 `audit_docs.py --rules` 或独立规则注释（与既有 audit 脚本同模式）。

---

## 三、 存量迁移批次清单（S2-1.4 的落地）

| 批次 | 范围 | 迁移动作 |
| :---: | :--- | :--- |
| **批次 1（文案）** | `config/narratives/*.json` 全部 `%s` 模板 | 改写 `{param}` 语义化（全量归零）；事件流键登记名称注册表 |
| **批次 2（消费方）** | 后端 `%` 格式化剧情文本处（combat/character_creation 等触发点） | 改 `NarrativeFlowResolver.resolve_flow` 传参填充（占位符与参数语义绑定） |
| **保留** | 既有 `NarrativeCausalityOrchestrator` AST 求值/仲裁/派发 | 零改动（文本生成出口切换即可） |

---

## 四、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-NAV-S3-01` | 占位符残留归零 | 全库 narratives 模板扫描 | `%s`/`%d` 归零，全部 `{param}` 语义化 |
| `TC-NAV-S3-02` | 占位符语法 | 裸 `{`/空 `{}` 样本 | audit 报告违规并阻断 |
| `TC-NAV-S3-03` | 配置为源零内联 | 后端剧情文案字面量扫描 | 零内联；新增剧情零装配（递归扫描自动发现） |
| `TC-NAV-S3-04` | 事件流键唯一与登记 | `narrative.*` 键集 | 跨域唯一 + 名称注册表登记可查 |
| `TC-NAV-S3-05` | 热重载零打断 | reload 后事件流会话 | 触发状态保持、文案刷新（运行期验证） |
| `TC-NAV-S3-06` | 消费方迁移完成 | 后端 `%` 格式化剧情点 | 全部改 `resolve_flow`，零残留格式化 |
