---
档号: KALAR-DEV-2026-ST17-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST17 (Phase_21_物品描述系统三位一体)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_21_物品描述系统三位一体 —— 阶段3：描述模板配置与audit校验
形成日期: 2026-09-01
归档日期: 2026-09-01
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 描述模板配置; audit校验; items.json
---

# 施工细则：物品描述系统（物品侧三位一体）—— 阶段3：描述模板配置与audit校验

> [!NOTE]
> **【施工目标】**：确立物品描述模板配置结构（`config/descriptions/items.json`，按 canonical_id + 状态条件组合）；audit 新增描述校验（模板引用已注册物品 / 占位符语法与未填充 / 配置为源零内联 / **不反向定义属性**）；登记描述键进名称注册表。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST17-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST17-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：立项需求 ③（配置驱动）④（audit 校验）⑤（描述不反向定义属性/不绕过注册系统）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST17-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST17-001_阶段1_分层数据契约与职责边界.md) ｜ [阶段2](KALAR-DEV-2026-ST17-002_阶段2_描述解析器与状态组织实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST17-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 描述模板配置结构

```json
{
  "descriptions": {
    "steel_sword": {
      "base": "{name}：{quality_tier}品质的{weapon_category}，基础攻击 {atk}。",
      "conditions": [
        { "when": { "quantity_min": 2 }, "text": "（持有 {quantity} 件）" },
        { "when": { "durability_max": 30 }, "text": "耐久将尽，剑刃已有缺口。" },
        { "when": { "enchant": "FLAME" }, "text": "附魔烈焰，剑身泛红。" }
      ]
    }
  }
}
```

| 项 | 约定 |
| :--- | :--- |
| 表名 | `descriptions.items`（GameConfig 递归扫描自动发现，零装配） |
| 模板键 | `item.<canonical_id>.desc`（名称注册表登记，域所有者 = item） |
| 占位符 | `{param}` 语义化（`{name}`/`{quality_tier}`/`{atk}`/`{quantity}`/`{durability}`/`{enchant}`…），`%s` 禁入 |
| 状态条件 | `conditions[].when`（quality/quantity/durability/enchant 组合）→ 匹配则拼接 `text` 段 |

**契约红线（配置不得成为后门）**：

1. **不反向定义属性**：模板 `{param}` 与 `when` 键**只允许引用已注册字段白名单**（本体属性 + 运行时状态），禁出现核心属性**定义**（如新增 `"atk": 999` 之类覆盖本体字段的条目）；audit 静态校验白名单；
2. **不绕过注册系统**：`descriptions.items` 的模板条目键必须是 `ItemRegistryCatalog` 已注册 canonical_id（未注册 → 阻断）；描述配置禁含 `canonical_id`/`numeric_id`/`english_name` 等身份字段（身份由注册系统唯一持有）；
3. **配置为源零内联**：描述文本 100% 来自配置，代码零内联剧情式文案。

---

## 二、 audit 物品描述校验（新增脚本或并入既有链）

| 校验项 | 规则 | 违规级别 |
| :--- | :--- | :--- |
| 已注册引用 | 描述模板键 ∉ 物品注册表 canonical_id → 违规 | 阻断 |
| 身份字段禁入 | 描述配置含 `canonical_id`/`numeric_id`/`english_name` 身份字段 → 违规 | 阻断 |
| 占位符残留 | 模板含 `%s`/`%d` 或空 `{}` → 违规 | 阻断 |
| 属性白名单 | `{param}`/`when` 键 ∉ 已注册字段白名单 → 违规（防反向定义） | 阻断 |
| 零内联 | 后端代码出现物品描述文案字面量 → 违规 | 阻断 |

- 事实源：`config/descriptions/items.json` + `ItemRegistryCatalog` 已注册清单 + 属性白名单（本体字段集合）；
- 接线：挂入 `audit_runner.py`（`task_id="item_descriptions"`）；规则声明同步 `audit_docs.py --rules` 或独立规则注释。

---

## 三、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-ITEMDESC-S3-01` | 已注册引用 | 描述键 vs 注册表 | 模板键 ⊆ 已注册 canonical_id；未注册引用被阻断 |
| `TC-ITEMDESC-S3-02` | 身份字段禁入 | 含身份字段样本 | audit 阻断（身份唯一归属注册系统） |
| `TC-ITEMDESC-S3-03` | 占位符残留归零 | 模板扫描 | `%s`/`%d`/空 `{}` 归零 |
| `TC-ITEMDESC-S3-04` | 不反向定义属性 | 属性白名单扫描 | `{param}`/`when` 键全部在白名单内，零新属性定义 |
| `TC-ITEMDESC-S3-05` | 配置为源零内联 | 后端文案扫描 | 描述文本零代码内联 |
| `TC-ITEMDESC-S3-06` | 键登记 | `item.<canonical>.desc` | 名称注册表登记可查，跨域唯一 |
