---
档号: KALAR-DEV-2026-ST22-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST22 (Phase_26_魔法双维度体系)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_26_魔法双维度体系 —— 阶段3：配置落地与audit
形成日期: 2026-09-01
归档日期: 2026-09-02（下午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: rank_gradient; ability_tiers; i18n; magic_tiers.json
---

# 施工细则：魔法双维度体系（阶位梯度 × 能力分级）—— 阶段3：配置落地与audit

> **施工开始日期**：2026-09-01

> [!NOTE]
> **【施工目标】**：`magic_tiers.json` 重构为**双段结构**（`rank_gradient` + `ability_tiers`）；弱映射**参考区间表**落地（含重叠样例）；i18n 键迁移（`magic.rank.mortal_1` → `magic.rank.rank_N` + 新增 `magic.ability_tier.*`）；**audit_magic_dimensions.py** 校验双维度独立性（阶位严格递增无前缀 / 区间自洽可重叠 / 禁 1:1 枚举表 / 键存在）。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST22-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST22-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：用户纠正 + S1/S2 契约。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST22-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST22-001_阶段1_双维度数据契约.md) ｜ [阶段2](KALAR-DEV-2026-ST22-002_阶段2_双体系实现设计.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST22-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 配置落地（magic_tiers.json 双段结构）

### 1.1 rank_gradient（阶位梯度段，11 阶纯梯度）

```json
{
  "rank_gradient": {
    "rank_1":  { "rank": 1,  "strength_weight": 1.0, "name_key": "magic.rank.rank_1" },
    "rank_2":  { "rank": 2,  "strength_weight": 1.2, "name_key": "magic.rank.rank_2" },
    "rank_3":  { "rank": 3,  "strength_weight": 1.5, "name_key": "magic.rank.rank_3" },
    "rank_4":  { "rank": 4,  "strength_weight": 1.9, "name_key": "magic.rank.rank_4" },
    "rank_5":  { "rank": 5,  "strength_weight": 2.4, "name_key": "magic.rank.rank_5" },
    "rank_6":  { "rank": 6,  "strength_weight": 3.0, "name_key": "magic.rank.rank_6" },
    "rank_7":  { "rank": 7,  "strength_weight": 3.8, "name_key": "magic.rank.rank_7" },
    "rank_8":  { "rank": 8,  "strength_weight": 4.8, "name_key": "magic.rank.rank_8" },
    "rank_9":  { "rank": 9,  "strength_weight": 6.0, "name_key": "magic.rank.rank_9" },
    "rank_10": { "rank": 10, "strength_weight": 7.5, "name_key": "magic.rank.rank_10" },
    "rank_11": { "rank": 11, "strength_weight": 9.5, "name_key": "magic.rank.rank_11" }
  }
}
```

### 1.2 ability_tiers（能力分级段，四等 + 超位 + 参考区间）

```json
{
  "ability_tiers": {
    "ESP":      { "tier": 1, "reference_interval": [1, 3],  "weight": 1.0, "name_key": "magic.ability_tier.esp",      "reference_label": "magic.ability_tier.esp_ref" },
    "HEROIC":   { "tier": 2, "reference_interval": [3, 6],  "weight": 1.6, "name_key": "magic.ability_tier.heroic",   "reference_label": "magic.ability_tier.heroic_ref" },
    "DIVINE":   { "tier": 3, "reference_interval": [6, 9],  "weight": 2.5, "name_key": "magic.ability_tier.divine",   "reference_label": "magic.ability_tier.divine_ref" },
    "GOD":      { "tier": 4, "reference_interval": [9, 11], "weight": 4.0, "name_key": "magic.ability_tier.god",      "reference_label": "magic.ability_tier.god_ref" },
    "SUPERTIER": { "tier": 5, "reference_interval": [11, 11], "weight": 6.0, "name_key": "magic.ability_tier.supertier", "reference_label": "magic.ability_tier.supertier_ref", "allow_break": true }
  }
}
```

- **参考区间允许重叠**（弱映射样例）：3 阶 ∈ ESP∩HEROIC；6 阶 ∈ HEROIC∩DIVINE；9 阶 ∈ DIVINE∩GOD；11 阶 ∈ GOD∩SUPERTIER（超位含 `allow_break: true` 越级容忍）；
- **无 Tier↔Rank 一一枚举表**（禁 1:1 判定）——区间查询即全部映射关系。

### 1.3 i18n 键迁移（config/i18n/）

| 旧键（嵌套） | 新键 |
| :--- | :--- |
| `magic.rank.mortal_1~3` / `heroic_1~3` / `divine_1~3` / `god_1~2` | `magic.rank.rank_1` ~ `magic.rank.rank_11`（值迁移：异能一阶→一阶…真神二阶→十一阶 或按展示语义调整） |
| —（新增） | `magic.ability_tier.esp/heroic/divine/god/supertier`（异能/英雄/神圣/真神/超位）+ `*_ref` 参考标签键（如 5 阶→「通常被概括为英雄级」） |

- 键经 Phase 19 名称注册表登记（跨域唯一；`magic.rank.*` 与 `magic.ability_tier.*` 同域不同前缀，无冲突）。

---

## 二、 audit_magic_dimensions.py（双维度校验，挂 audit_runner task_id="magic_dimensions"）

| 校验项 | 规则 | 级别 |
| :--- | :--- | :--- |
| 阶位严格递增 | rank_gradient 键 rank_1~11 连续、rank/strength_weight 严格递增 | 阻断 |
| **无能力前缀** | rank_gradient 键不含 mortal/heroic/divine/god 等能力分级前缀 | 阻断 |
| 能力分级独立 | ability_tiers 四等 + 超位独立键，不嵌入阶位名 | 阻断 |
| 区间自洽 | 参考区间均在 1~11 内且 [lo, hi] 合法（lo≤hi）；**允许重叠** | 阻断 |
| **禁 1:1 枚举表** | 配置/代码不得存在 Tier↔Rank 逐阶一一映射表（区间覆盖即上限） | 阻断 |
| i18n 键存在 | rank_* 与 ability_tier.* 键在 en_US/zh_CN 登记 | 阻断 |

---

## 三、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-MD-S3-01` | 双段配置加载 | magic_tiers.json | rank_gradient 11 阶 + ability_tiers 5 项（四等+超位）GameConfig 加载成功 |
| `TC-MD-S3-02` | 区间重叠样例 | infer 3/6/9/11 阶 | 3→[ESP,HEROIC]、6→[HEROIC,DIVINE]、9→[DIVINE,GOD]、11→[GOD,SUPERTIER] |
| `TC-MD-S3-03` | i18n 键迁移 | en_US/zh_CN 键集 | 旧嵌套键清零、新 rank_*/ability_tier.* 齐全、名称注册表登记可查 |
| `TC-MD-S3-04` | audit 双维度校验 | audit_magic_dimensions 运行 | 六校验零违规（含禁 1:1 表） |
| `TC-MD-S3-05` | 越级容忍 | SUPERTIER allow_break | 超位区间 11 且 allow_break=true；特殊装备可突破 |
| `TC-MD-S3-06` | 既有消费方读取 | registry/baseline_resolver | 双段读取兼容，零行为回归（见 S4） |
