---
档号: KALAR-DEV-2026-ST51-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST51 (Phase_55_配置值域schema化与语义守卫加固)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_55_配置值域schema化与语义守卫加固 —— 阶段1：配置值域schema与数值不变量契约设计
形成日期: 2026-09-04
归档日期: 2026-09-06（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: audit_config; 配置值域 schema 规则族; 读取侧语义守卫清单
---

# 施工细则：阶段1_配置值域schema与数值不变量契约设计

> 施工开始日期: 2026-09-04 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: ✅ 已闭环（第2轮施工已完成并验证闭环）

> [!NOTE]
> **【施工目标】**：根治「配置只验结构不验值域」类缺陷（L1 全族 + L11 + L3 + L12）：建立**两级防线契约**——① 代码读取侧语义守卫（运行时热重载即时防护，`maxi/maxi(1,…)/clampi/符号守卫`）；② 配置表静态值域 schema 校验（audit_config 升级，CI 阻断「表本身写坏」）。并修复金库负数取款（L3）与 as-Array 转型（L12）两处语义缺口。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST51-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST51-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：全域质量与边界专项审查报告（2026-09-04）→ L1 / L11 / L3 / L12
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST51-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST51-002_阶段2_除数下限与符号钳制语义守卫算法实现.md) ｜ [阶段3](KALAR-DEV-2026-ST51-003_阶段3_audit_config值域校验与缺省兜底工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST51-004_阶段4_值域注入与语义边界验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游证据指针**：
  - L1 除零/越界族：`potential_growth/targeted_attribute_solver.gd:25`（`tier_size` 无 >0 守卫）；`telemetry_account_lifecycle/telemetry_sidecar_engine.gd:19`（`% _salt_modulus()` 可 0）；`lattice_skill_book/lattice_decompiler_service.gd:21`（`learner_normalize` 可 0 → inf）；`trading_logistics/market_elasticity_solver.gd:19-20`（`safe_supply_floor` 与 supply 双 0 → 0/0）；`hardware_input/adaptive_input_filter_solver.gd:26`（`(outer − inner)` 可 ≤0）；`character_creation/attribute_init_solver.gd:27-30`（`drop_lowest` 无域校验：负值 → `rolls[-k]` 越界；≥cnt → 静默全丢恒 1 级）
  - L11 clamp/域直写：`inventory/item_attribute_evaluation_solver.gd:58`（`clampf(eff, value_min, value_max)` 而注册表不验 min≤max）；`character_creation/character_baseline_attribute_solver.gd:17-23`（无修正分支时配置越界等级直写输出，绕过 1~6 级域）
  - L3 符号/口径：`organization_guild/organization_governance_solver.gd:38-46`（`withdraw_from_treasury` 负数 amount 恒通过比较，`-=` 变入账）；`currency_economy/currency_entities.gd:91-95`（allow_signed 欠账上限折算漏 `mana_monocrystals` 且 `_rate` 可为 0）
  - L12 转型：`spatial_movement/movement_vector_bridge_solver.gd:16-18`（`aliases[key] as Array` 失败 → `for null` 崩溃）
* **核心不变量约束断言**：`Inv-VD-1`：任何参与除法/取模/缩放的配置分母读取处，运行时值必须 `> 0`（由语义守卫保证，含热重载后）；`Inv-VD-2`：资产/扣减入参（金额/数量/指数）必须非负（符号守卫）；`Inv-VD-3`：clamp 区间参数恒满足 `min ≤ max`（注册表不变量）；`Inv-VD-4`：跨表引用（配置值域 schema）在审计层可静态断言，0 值/负值/倒置表在 CI 即红
* **防漂移最高指示**：读取侧守卫与静态 schema 是**双防线**——禁止只补一侧而宣称闭环；schema 规则由 `audit_config.py` 单一登记（规则 ID 稳定），不在文档里另立规则孤本

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

### 1. 配置值域 schema 规则族（audit_config 扩展目标）

| 规则族（拟登记进 audit_config 值域段） | 匹配表/键形态 | 约束 | 覆盖缺陷 |
| :--- | :--- | :--- | :--- |
| `VD_POSITIVE_INT` | `domains.potential/point_cost/tier_size`；`domains.telemetry_account_lifecycle/event_id/salt_modulus` | `int > 0` | L1(tier_size/salt_modulus) |
| `VD_POSITIVE_FLOAT` | `domains.lattice/…/learner_normalize`；`domains.trading/market/supply_floor` 等分母类 | `float > 0` | L1(normalize/elasticity) |
| `VD_RANGE_ORDERED` | `domains.hardware_input/…/inner < outer`；物品属性 `value_min ≤ value_max` | 双键序关系 | L1(deadzone) / L11(clamp) |
| `VD_INT_RANGE` | `character_creation/attribute_init/dice/drop_lowest ∈ [0, count-1]` | 含跨键参照 | L1(drop_lowest) |
| `VD_NON_NEGATIVE` | 资产类配置键族（金库/扣减相关如适用） | `≥ 0` | L3 |

> 键路径以实际表结构为准（实现轮先 `--rules` 查 audit_config 现有规则登记格式再扩展）；规则以**最小侵入**优先：先覆盖本卷 L 项真实键，其余同类键按 `VD_*` 族增量登记，严禁一次性扩大审计面导致基线噪变。

### 2. 读取侧语义守卫清单（运行时防线，本卷逐点落地）

| 落点（file:line） | 守卫写法（示例语义，非最终代码） | 契约 |
| :--- | :--- | :--- |
| `targeted_attribute_solver.gd:24-25` | `tier_size := maxi(1, GameConfig.get_int(...))` | Inv-VD-1 |
| `telemetry_sidecar_engine.gd:19` | `_salt_modulus(): return maxi(1, GameConfig.get_int(...))` | Inv-VD-1 |
| `lattice_decompiler_service.gd:21` | `learner_normalize := maxf(1.0, GameConfig.get_float(...))`（分母语义） | Inv-VD-1 |
| `market_elasticity_solver.gd:19` | `safe_supply_floor := maxf(1.0, …)`（0/0 → 有界） | Inv-VD-1 |
| `adaptive_input_filter_solver.gd:26` | 读取后收敛：`outer := maxf(inner + EPS, outer)` 或公式侧 `denom := maxf(EPS, outer - inner)` | Inv-VD-1 |
| `attribute_init_solver.gd:27-30` | `drop := clampi(drop_lowest, 0, maxi(0, rolls.size() - 1))` | Inv-VD-1/域内 |
| `item_attribute_registry` 注册 | 登记时校验 `value_min ≤ value_max`（否则拒绝/告警+收敛） | Inv-VD-3 |
| `organization_governance_solver.gd:38-46` | 取款前 `amount_gold < 0 or amount_crystals < 0 → INVALID_AMOUNT`（符号守卫） | Inv-VD-2 |
| `currency_entities.gd:91-95` | 欠账口径收敛：`_rate` 取 `maxi(0, …)` 折算；**魔单晶入欠账总额口径**需领域决策（本卷默认**纳入**，见阶段2 设计） | Inv-VD-2 |
| `movement_vector_bridge_solver.gd:16-18` | `if not (aliases[dir_key] is Array): return 空/告警`（转型守卫） | L12 |

### 3. 语义定论登记（本卷需在实现轮同步落注释/文档）

- `withdraw_from_treasury` 注释「金库出纳审计」补符号校验语义：负金额一律 `INVALID_AMOUNT` 拦截（审计面不记负出纳）；
- `debt/max_debt_copper` 口径：折算总额含 `mana_monocrystals`（若实现轮确认魔单晶存在对铜折算率配置则纳入；无折算率则维持排除并在代码注释登记口径边界——**禁止静默含混**）。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] **Step 1.1**: 逐点通读 L1/L11/L3/L12 全部证据行（12 处），确认现状读取方式与调用链
- [x] **Step 1.2**: 查询 `audit_config.py` 规则登记格式（`--rules`/头注释），起草 `VD_*` 规则族最小集
- [x] **Step 1.3**: 核对 `currency_entities.gd` 的 `_rate()` 实现与 config 币种折算表，定夺魔单晶入账口径
- [x] **Step 1.4**: 固化守卫清单（§一.2）与 DoD 矩阵（§三）

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-VD-S1-01` | 守卫点全覆盖 | 对 §一.2 清单逐行打勾 | 10 处落点全部有守卫设计，无遗漏 |
| `TC-VD-S1-02` | schema 规则可达 | audit_config 扩展后 --rules | VD_POSITIVE_INT/RANGE_ORDERED/… 可查且指向真实键 |
| `TC-VD-S1-03` | 双防线映射 | L1/L11/L3/L12 → (守卫, schema) | 每缺陷至少一侧防线存在，优先双线 |
| `TC-VD-S1-04` | 口径定论落档 | 魔单晶欠账口径决策 | 纳入或排除均有注释/文档留痕，无含混 |

---

## 附录：实施收敛登记（第2轮闭环，2026-09-04）

- S1 契约已全量收敛进 Phase 55 S2 运行时语义守卫与 S3 audit_config 静态 schema；
- Inv-VD-1~4 不变量全部建立并在对应模块与单测中严格保持。
