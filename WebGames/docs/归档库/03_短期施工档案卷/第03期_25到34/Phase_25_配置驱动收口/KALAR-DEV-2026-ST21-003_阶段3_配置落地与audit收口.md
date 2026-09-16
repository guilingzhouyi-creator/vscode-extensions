---
档号: KALAR-DEV-2026-ST21-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST21 (Phase_25_配置驱动收口)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_25_配置驱动收口 —— 阶段3：配置落地与audit收口
形成日期: 2026-09-01
归档日期: 2026-09-02（下午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: domains; items; 默认分类配置键
---

# 施工细则：配置驱动收口 —— 阶段3：配置落地与audit收口

> **施工开始日期**：2026-09-01

> [!NOTE]
> **【施工目标】**：默认分类配置落地（`domains.items` 表 `defaults/category_minor` 键）；**audit_cdc.py 收口审计**（代码物品 ID 引用 ⊆ 注册表 / AST kind 白名单单一真源从代码读取 / gacha 概率值域校验）；`audit_event_probability.py` 的 `KIND_WHITELIST` 删除 Python 副本改读代码真源；必需表确认（domains.items / domains.gacha 均已登记，键级补入）。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST21-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST21-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：立项需求 ③（配置落地）④（audit 收口）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST21-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST21-001_阶段1_改造边界与数据契约（含审查勘正）.md) ｜ [阶段2](KALAR-DEV-2026-ST21-002_阶段2_改造实现（勘正后范围）.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST21-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 配置落地

### 1.1 默认分类配置键（domains.items 表）

| 配置键 | 默认值 | 消费点 |
| :--- | :--- | :--- |
| `domains.items` → `defaults/category_minor` | `"WEAPON_BLADE"`（fallback，零行为变化） | item_loader_pipeline / item_registry_catalog（三处字面量 → 配置引用） |

- `domains.items` 表已登记 `_required_tables`（既有）；新增 `defaults/category_minor` 键（缺失回退默认值，不抛 Fatal）；
- `physical_verb_registry.gd:36` 已读 `domains.combat` 表（已配置驱动）——确认不改。

### 1.2 gacha 概率表（已存在，确认）

| 配置键（domains.gacha） | 当前值 | 校验 |
| :--- | :--- | :--- |
| `rates/base_5star` / `rates/base_4star` / `rates/up_rate` | 0.006 / 0.051 / 0.5 | 0~1 值域（audit 阻断越界） |
| `pity/soft_threshold` / `pity/hard_threshold` / `pity/soft_increment_per_pull` | 70 / 90 / 0.05 | 正整数且 soft < hard |

- **零行为改动**（test_gacha 断言 0.006 等保持）；仅 audit 补值域校验。

---

## 二、 audit_cdc.py 收口审计（新增脚本挂 audit_runner）

| 校验项 | 规则 | 级别 |
| :--- | :--- | :--- |
| **ID 引用一致性** | 代码 `"KALAR:..."` canonical ID 字面量（注释除外）∉ config/items 注册集 → 违规（防注册表漂移） | 阻断 |
| **kind 单一真源** | audit 白名单从 `narrative_causality_orchestrator.gd` match kind 分支解析（删 `audit_event_probability.py` Python 副本） | 阻断（无副本即通过） |
| **gacha 概率值域** | `domains.gacha` rates ∉ 0~1 / pity 非正整数或 soft ≥ hard → 违规 | 阻断 |

**接线**：

- 新增 `scripts/py/audit_cdc.py`（配置驱动收口审计）挂 `audit_runner.py`（`task_id="cdc"`）；
- `audit_event_probability.py`：`KIND_WHITELIST` 硬编码副本删除，改为 import/内联读取 `audit_cdc` 的代码解析结果（单一真源）。

---

## 三、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-CDC-S3-01` | 默认分类配置落地 | domains.items defaults/category_minor | 配置键存在；三处消费点读配置；缺失回退 "WEAPON_BLADE" |
| `TC-CDC-S3-02` | ID 一致性阻断 | 未注册 ID 样本 | audit_cdc 报告违规并阻断 |
| `TC-CDC-S3-03` | kind 单一真源 | audit 白名单生成路径 | Python 副本删除；从代码读取；新增 kind 一处改 |
| `TC-CDC-S3-04` | gacha 值域校验 | 越界 rates/pity 样本 | audit_cdc 阻断（0~1 / soft<hard） |
| `TC-CDC-S3-05` | 必需表登记 | domains.items / domains.gacha | 均已登记（键级补入，无新表） |
| `TC-CDC-S3-06` | 零行为回归 | test_gacha 全量 | 概率断言 0.006/0.051 等全部保持（配置值 = fallback） |
