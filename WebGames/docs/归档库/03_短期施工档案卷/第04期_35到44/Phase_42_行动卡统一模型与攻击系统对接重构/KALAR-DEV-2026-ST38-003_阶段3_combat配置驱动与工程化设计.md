---
档号: KALAR-DEV-2026-ST38-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST38 (Phase_42_行动卡统一模型与攻击系统对接重构)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_42_行动卡统一模型与攻击系统对接重构 —— 阶段3：combat配置驱动与工程化设计
形成日期: 2026-09-02
归档日期: 2026-09-03（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: combat配置驱动; 工程化设计; combat.json
---

# 施工细则：行动卡统一模型与攻击系统对接重构 —— 阶段3：combat.json 卡池/配置驱动、审计校验与工程化设计

> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST38-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST38-001_阶段1_行动卡卡池手牌AP轴数据契约与法式层级对齐.md) ｜ [阶段2](KALAR-DEV-2026-ST38-002_阶段2_行动卡收编真实伤害管线与魔法效果层设计.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST38-004_阶段4_既有战斗单测对齐验收矩阵与门禁.md)

> **施工开始日期**：2026-09-02（23:58 下午）
> **施工状态**：✅ 已施工完毕（2026-09-03 获批并闭环，combat.json扩展段 + magic_rules对齐键 + 热重载已落地）

## 一、改造范围

将阶段1/2 的收编方案落到配置驱动层：扩展现有 `config/domains/combat.json`（**只扩展不重写既有段**），新增卡池/效果层/出牌合法域配置段；登记 audit_config 结构校验与热重载守卫；Phase 41 的 `magic_rules.json` 变体段补 `normative_form`/`ranked_form_branch` 层级对齐键（阶段1 契约 D5）。**禁止将手牌数、池成员、AP 区间、发牌算法硬编码为唯一规则**。

## 二、combat.json 扩展段（字段真源，数值示例标注）

```json
{
  "_note": "Phase 42 扩展段：卡池/效果层/出牌域（示例默认值，正式定版后收敛）",
  "card_pool_defaults": {
    "card_category": "ATTACK",
    "magic_ref": "",
    "effects": [],
    "card_pool": "random"
  },
  "round_hand": {
    "hand_cap": 5,
    "draw_per_round": 3,
    "mulligan_stamina_cost": 1,
    "mulligan_max_per_round": 1,
    "end_of_round_policy": "DISCARD"
  },
  "draw_algorithm": {
    "mode": "PRD",
    "prd_compensation_step": 0.02,
    "guarantee_pity": 0
  },
  "card_pool_weights": {
    "random_attack": 0.5,
    "random_buff": 0.15,
    "random_debuff": 0.1,
    "random_recover": 0.15,
    "random_item": 0.1
  },
  "ap_axis": {
    "init_min": -10,
    "init_max": 10,
    "stagger_min": -10,
    "even_state_policy": "AGI_TIEBREAK"
  },
  "ultimate_slot": {
    "enabled": true,
    "trigger": { "op": "LEAF", "kind": "rage_gte", "args": { "min_rage": 100.0 } }
  }
}
```

> 三层分离沿袭仓库既有例：`combat.json` 承载**参数层**（随机/技能/奥义卡池权重、手牌上限、AP 区间）；发牌算法（PRD/混合）由 `DeterministicRNG` 驱动；具体示例数值显式标注非默认业务，audit_config 只校验结构与键型，不约束数值。

## 三、魔法规则表补层级对齐键（D5 收敛）

`config/domains/magic_rules.json` 的 `attribute_schools` / `variants` 段新增（**向后兼容：缺失键按既有语义兜底**）：

| 键 | 挂载段 | 语义 |
| :--- | :--- | :--- |
| `normative_form: "LIGHT"` / `"DARK"` | `attribute_schools.<school>` | 声明属性大类归属「元素/规范魔法」法式分支（真源：需求表2 §4.3 元素/规范魔法——固定数目与驱动顺序之法式） |
| `ranked_form_branch: "HOLY"` / `"ABYSSAL"` | `variants.<variant>` | 声明派生变体归属「位阶魔法」（异能/英雄/神圣 三等九阶分支），替代 Phase 41 的 `variant_of_form=2` 直挂枚举做法 |
| `variant_of_form` | `variants.<variant>` | 保留（兼容既有 MagicForm 查询），但**不再作为层级权威**，权威迁移至 `ranked_form_branch` |

## 四、结构审计与校验（audit_config 扩展）

| 校验项 | 断言 |
| :--- | :--- |
| combat 新段存在性 | `card_pool_defaults`/`round_hand`/`draw_algorithm`/`card_pool_weights`/`ap_axis` 均为对象且键型正确 |
| 数值域 | hand_cap/draw_per_round ≥ 1；ap_axis init_min ≤ init_max；权重合计 ≈ 1.0（容差 0.01） |
| magic_rules 层级键闭合 | `attribute_schools[].normative_form` ∈ {LIGHT, DARK}（若存在）；`variants[].ranked_form_branch` ∈ {HOLY, ABYSSAL}（若存在）；既有键缺失不报错（向后兼容） |
| 条件树 | `ultimate_slot.trigger` 复用既有 MagicRuleCondition 结构（op/kind/args），结构非法即违规 |
| 禁改既有段 | 既有 `verbs`/`card_defaults`/`participant_defaults`/`interrupt`/`defense_multipliers`/`kinetic`/`phase_transition` 语义与键不被本卷改动（回归防扩散） |

**热重载**：`combat.json` 与 `magic_rules.json` 经 `GameConfig.reload_config()` 原子刷新；`CombatCardResolver`/`MagicRuleRegistry` 快照随重载刷新，坏快照保留旧版本（复用既有守卫），禁返回半成品。

## 五、零硬编码与文案

- 新卡字段/出牌合法域/发牌算法全部读配置类型化获取器（GameConfig.get_*），代码零数值/类别字面量（枚举常量除外）；
- 行动卡展示文案走 i18n（ui.fe04 / combat 文案键）与 `EventBus.render_narrative`，代码零中文文案；
- audit_gd / audit_hardcode 对改动文件 0 新增违规。

## 六、可扩展性设计（引擎层扩展点）

| 扩展场景 | 做法 | 改动面 |
| :--- | :--- | :--- |
| 新增卡池分类 | `card_pool_weights` 加键 + `card_pool_defaults.card_category` 枚举扩展 | 配置 + 枚举一处 |
| 新增魔法动词域 | `verbs` 注册 + `CombatActionCardEntity.verb_type` 引用 | 配置 |
| 新增机制效果层 | `effects[]` 声明新 kind + 对应效果处理器注册 | 一处注册点 |
| 新属性/派生变体 | magic_rules 配置（含 normative_form/ranked_form_branch） | 零引擎改动 |
| 前端手牌 UI 接入 | 消费后端 Round/手牌事件流（契约先行） | 前端卷（登记 BND-42-FRONT-01） |

## 七、命令式施工执行清单（Agent Execution Checklist）

- [x] **Step 3.1: combat.json 扩展段建档** - card_pool/round_hand/draw_algorithm/ap_axis/ultimate 落盘（既有段不动）
- [x] **Step 3.2: magic_rules 层级对齐键补齐** - normative_form/ranked_form_branch（缺失键兜底兼容）
- [x] **Step 3.3: audit_config 结构校验接线** - combat/magic_rules 新键型与闭合校验
- [x] **Step 3.4: 文案与零硬编码复核** - i18n 键补齐，audit_gd/hardcode 0 新增

## 八、工程化验收矩阵（DoD Matrix）

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-CARD-S3-01` | combat 扩展段热读取 | 修改 round_hand 后 reload | 类型化读取即时生效，既有 verbs 段未变 |
| `TC-CARD-S3-02` | 配置缺失兜底 | 删除 magic_rules 新层级键 | 按既有语义兜底，不抛 Fatal |
| `TC-CARD-S3-03` | 结构审计通过 | audit_config 运行 | combat/magic_rules 新键 0 error |
| `TC-CARD-S3-04` | 既有 combat 段回归 | 全量 audit + 单测 | verbs/card_defaults 语义零回归 |
| `TC-CARD-S3-05` | 热重载坏配置保旧 | 注入坏 JSON | 旧快照继续服务，版本不推进 |
