---
档号: KALAR-DEV-2026-ST38-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST38 (Phase_42_行动卡统一模型与攻击系统对接重构)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_42_行动卡统一模型与攻击系统对接重构 —— 阶段1：行动卡卡池手牌AP轴数据契约与法式层级对齐
形成日期: 2026-09-02
归档日期: 2026-09-03（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 权威载体; 效果层与行动卡分类; 行动卡 ↔ 魔法定义桥接; combat.json
---

# 施工细则：行动卡统一模型与攻击系统对接重构 —— 阶段1：行动卡/卡池/手牌/AP 轴数据契约与位阶法式层级对齐

> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST38-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST38-002_阶段2_行动卡收编真实伤害管线与魔法效果层设计.md) ｜ [阶段3](KALAR-DEV-2026-ST38-003_阶段3_combat配置驱动与工程化设计.md) ｜ [阶段4](KALAR-DEV-2026-ST38-004_阶段4_既有战斗单测对齐验收矩阵与门禁.md)

> **施工开始日期**：2026-09-02（23:58 下午）
> **施工状态**：✅ 已施工完毕（2026-09-03 获批并闭环，CombatActionCardEntity 权威收编 + 卡池/手牌/AP轴契约 + 法式层级对齐已定稿）

## 一、立项范围与需求溯源

本卷承接需求 P 后续调查结论（Phase 42 重构立项）：Phase 41 建立的统一魔法规则后端中，`ActionCardDefinition` 与魔法伤害结算绕开了既有攻击系统，属**新造而非复用**。经逐项取证（前端 `combat_view` / 后端 `physics_thermodynamics` 域 / `config/domains/combat.json` / 后端架构需求表 1/2/8/12 / 玩法需求设计稿一），确认本项目战斗为**回合抽卡卡牌打出制（动态行动轴 + 随机/固定卡牌池 + 响应式反击打断的复合回合制）**，脱节点登记如下：

| # | 脱节点 | 现状 | 本卷收敛方向 |
| :--- | :--- | :--- | :--- |
| D1 | 行动卡载体新造 | Phase 41 自建 `ActionCardDefinition`（card_type=魔法机制类型） | 收编为既有 `CombatActionCardEntity`（verb_type/ap_cost/base_potency 由 combat.json 驱动）的统一行动卡模型 |
| D2 | 结算管线绕行 | `MagicSettlementSolver` 用 `base_power × rank_weight` 简化虚拟结算 | 伤害接入真实管线（物理侵彻 `calculate_penetration_damage` / 魔法能量密度公式），魔法结算仅作适配层 |
| D3 | AP 轴语义缺失 | 仅 `consumes_play=1`，未与正负 AP 动态势能轴挂钩 | 出牌合法域 = 手牌持有 + AP 判定（AP<0 硬直禁主动出牌） |
| D4 | 手牌/卡池/重掷缺失 | 无手牌、无随机池/职业技能池、无 Mulligan | 补齐 Round 发牌、随机池+固定技能池、Mulligan(Stamina) 数据契约 |
| D5 | 法式/位阶层级挂点错位 | Phase 41 变体 `variant_of_form=2` 挂 MagicForm.INCANTATION 枚举 | 对齐真源层级：咒术→术式(<10句)/法式(≥10句)→位阶魔法(三等九阶)与元素/规范魔法(固定数目驱动顺序之法式)；光/暗属性体系挂**元素/规范魔法**法式，神圣/暗黑派生挂**位阶魔法**变体 |
| D6 | 前端骨架未体现 | `combat_view` 技能栏 6 槽 Mock，无手牌区 | 本卷只做后端数据契约与引擎层，前端骨架不在此卷范围（登记边界） |

**不在本卷范围**：前端手牌 UI/打字机表现、完整反击链与推条状态机的重写（复用既有 `combat_pipeline_fsm` 不重造）、联机权威仲裁、技能图云 AST。

## 二、行动卡统一模型数据契约（收编既有 CombatActionCardEntity）

### 2.1 权威载体

以 `backend/domains/physics_thermodynamics/physical_verb_registry.gd::CombatActionCardEntity` 为**唯一行动卡权威载体**（Phase 41 的 `magic_system/action_card_definition.gd` 退役或降级为效果层描述，由本卷阶段2 决策收敛），字段契约：

| 字段 | 类型 | 真源 | 说明 |
| :--- | :--- | :--- | :--- |
| `card_id` | String | 运行时生成/登记 | 全局唯一 |
| `card_name` | String | i18n/combat 文案 | 展示名键 |
| `verb_type` | String | `combat.json::verbs` 键（STAB/SLASH/UPPER/PARRY/BLOCK/CRUSH/INTER/TWIST + 可注册扩展） | 物理动词类型；魔法卡可扩展魔法动词域 |
| `magic_form` | int | `PhysicalVerbRegistry.MagicForm`（1 始源/2 咒术/3 集成/4 超位） | 施法形态 |
| `ap_cost` | int | `combat.json::card_defaults/ap_cost` | 出牌 AP 消耗（正负轴语义见三） |
| `base_potency` | float | `combat.json::card_defaults/base_potency` | 基础威力（送入真实伤害公式） |
| `required_weapon_category` | String | `combat.json::card_defaults/required_weapon_category` | 武器类别门槛（魔法卡可空/改由属性体系判据） |

### 2.2 效果层与行动卡分类（本卷新增契约，对齐玩法稿 4.3 卡池分类）

行动卡在**卡池维度**分类（非引擎硬类型，由配置段声明）：

| 卡池分类 | 覆盖 | 对应真源/配置 |
| :--- | :--- | :--- |
| 随机卡池（基础卡） | 攻击类（魔法/物理/混合）、状态增益/减益类、恢复类、道具类 | 玩法稿一 4.3.A；`combat.json` 新 `card_pool` 段 |
| 技能卡池（职业固定） | 职业专属固定技能 + 奥义（怒气/魔力条件激活） | 玩法稿一 4.3.B；预留 `ultimate` 槽 |
| 魔法机制卡（Phase 41 收编） | 封印/升格/延时/解放/几重化 → 降级为**效果层修饰**（effect layer），不再是独立卡牌大类 | 挂接行动卡 `effects[]`，见阶段2 |

### 2.3 行动卡 ↔ 魔法定义桥接

Phase 41 `MagicDefinition.canonical_id` 作为 `CombatActionCardEntity` 的魔法侧扩展键（`magic_ref`），一张行动卡可引用零/一/多个魔法效果；封印/升格/延时状态仍由 `magic_system` 状态实体承载，**行动卡只是其触发入口**。

## 三、回合/手牌/AP 轴数据契约（Round 生命周期）

对齐玩法稿一 4.1~4.3 与后端需求表 1/2 的「小回合 Round」语义：

| 阶段 | 契约 | 配置/真源 |
| :--- | :--- | :--- |
| R1 回合开始 | 按 AGI/等级/环境计算双方初始 AP 差值（Clamp 到 [-10,10] 区间，区间配置化） | 需求表1 §5.1 / 需求表2 §3.1 |
| R2 发牌 | 每小回合从**随机卡池 + 职业固定技能池**抽取 N 张行动卡入**手牌**（N、池权重、保底算法 PRD/混合 配置化，DeterministicRNG 注入） | 玩法稿一 4.3 |
| R3 战术重掷 | 玩家可消耗 1 点行动力（Stamina）执行一次 Mulligan 重洗手牌；次数/消耗配置化 | 玩法稿一 4.3.3 |
| R4 出牌序列 | 玩家按手牌**逐个打出行动卡**，每打出一次消耗 `ap_cost` 并推进 AP 轴；AP>0 可连续出牌，AP<0 硬直禁止主动出牌（仅可被动招架），AP=0 均势判定 | 需求表2 §3.1 / combat.json |
| R5 结算 | 每张行动卡走 `CombatPipelineFSM`/真实伤害管线结算；打断/反击/优先级抢夺复用既有 FSM | `combat_pipeline_fsm.gd` |
| R6 回合结束 | 清扫本回合即时增益、剩余手牌处理（弃置/保留配置化）、进入下一小回合 | — |

**关键不变量**：
1. 一次「行动卡打出」= 手牌中一张行动卡的完整出牌-结算事务（几重化等效果层在事务内多次攻击，仍只占一张手牌与一次行动语义）；
2. 出牌合法域必须同时满足「在手牌中 + AP 允许」双条件，缺一不可（`HAND_NOT_CONTAIN` / `AP_INSUFFICIENT_OR_STAGGERED` 受控失败码）；
3. 所有池/数/算法/区间配置化，禁止把发牌数、池成员、AP 区间硬编码为唯一规则；
4. 手牌与卡池均以确定性 RNG 驱动，可复现可回放（全域确定性契约）。

## 四、法式→位阶/元素规范层级对齐（修正 Phase 41 variant 挂点错位 D5）

依据后端架构需求表2 §4.3（咒术魔法细分）真源层级：

```
咒术魔法 (M2, INCANTATION)
 ├─ 术式魔法: 魔法句子 < 10 句
 └─ 法式魔法: 魔法句子 >= 10 句
     ├─ 位阶魔法: 按句子规模划分之法式（异能/英雄/神圣 三等九阶）← 神圣系/暗黑系变体挂此层
     └─ 元素/规范魔法: 固定数目与驱动顺序之法式 ← 光系(金木水火土)/暗系(风雷)属性大类挂此层
```

| Phase 41 现状 | Phase 42 对齐 |
| :--- | :--- |
| 光/暗属性大类为孤立配置段 | 声明归属「元素/规范魔法」法式（`normative_form` 键），与既有法式魔法句子数分级兼容 |
| 神圣/暗黑派生变体 `variant_of_form=2`（INCANTATION 枚举） | 挂「位阶魔法」层级：变体声明 `ranked_form_branch`（异能/英雄/神圣 三等九阶分支），派生条件仍为可配置融会贯通条件组 |
| 位阶维度独立（1~11 复用 MagicTierRegistry） | 不变，与三等九阶语义做映射说明（`rank_gradient` 关联异能/英雄/神圣带），由阶段2 收敛 |

**不变量**：不新增 MagicForm 枚举值（四大宏观形态为既有闭集）；层级扩展全部经配置声明 + 注册表校验。

## 五、待定义边界登记（引擎可扩展承诺）

| 边界 ID | 内容 | 当前处置 |
| :--- | :--- | :--- |
| `BND-42-CARD-01` | 手牌上限与回合末弃置/保留策略未获业务裁决 | 配置预留 `hand_cap`/`end_of_round_policy`，默认示例值非唯一规则 |
| `BND-42-CARD-02` | 技能卡池/奥义解锁条件（怒气/魔力阈值）未定 | 预留 `ultimate_trigger` 配置槽，引擎不造隐含规则 |
| `BND-42-FORM-01` | 三等九阶与 rank_gradient 1~11 的精确映射未定 | 登记映射说明表占位，运行时不实施隐式换算（保持可扩展） |
| `BND-42-FRONT-01` | 前端手牌 UI 不在本卷 | 后端契约先行，前端骨架后续卷接入 |

## 六、命令式施工执行清单（Agent Execution Checklist）

- [x] **Step 1.1: 行动卡统一模型契约落定** - 收编 `CombatActionCardEntity`，明确效果层/卡池分类与魔法桥接
- [x] **Step 1.2: Round/手牌/AP 轴生命周期契约落定** - R1~R6 与配置键、受控失败码
- [x] **Step 1.3: 法式层级对齐契约落定** - 元素/规范魔法、位阶魔法三等九阶分支声明键
- [x] **Step 1.4: 待定义边界与禁止越界登记** - BND-42-* 落表，引擎零隐含规则

## 七、数据结构验收矩阵（DoD Matrix）

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-CARD-S1-01` | 行动卡权威载体收编 | CombatActionCardEntity 字段全集 | 与 combat.json 驱动一致，无旁路新卡类型 |
| `TC-CARD-S1-02` | 卡池分类配置可解析 | card_pool 段（随机/技能/奥义） | 结构校验通过，成员引用既有 verb/magic 真源 |
| `TC-CARD-S1-03` | Round 生命周期契约 | R1~R6 状态机草表 | 出牌合法域=手牌+AP 双条件成立 |
| `TC-CARD-S1-04` | 法式层级对齐 | 光/暗↔元素规范、神圣/暗黑↔位阶魔法分支 | 不新增 MagicForm 枚举；层级声明键存在且闭合 |
| `TC-CARD-S1-05` | 确定性发牌可复现 | 同种子两次发牌 | 手牌序列一致 |
