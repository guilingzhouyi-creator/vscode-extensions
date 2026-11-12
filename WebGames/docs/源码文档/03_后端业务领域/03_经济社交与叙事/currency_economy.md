# 货币体系、物理负重与魔单晶本位 (`currency_economy`)

> 对应源码：`backend/domains/currency_economy/`（3 个 `.gd`）。实现铜/银/金/白金与战略能源魔单晶的多币种钱包账本、货币物理质量约束、阶梯折算扣除与购买力平价套利核算。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [currency_entities.gd](../../../../backend/domains/currency_economy/currency_entities.gd) | `CharacterWalletEntity` | 多币种钱包聚合实体 | `apply_delta()`（增量账本）、`apply_transaction()`、`try_spend()`（阶梯找零扣除）、`calculate_total_currency_mass_kg()`、`incur_debt()`；读取 `domains.currency:{rates,coin_mass_kg,debt}/*` |
| [currency_sinks_fsm.gd](../../../../backend/domains/currency_economy/currency_sinks_fsm.gd) | `CurrencySinksAndFaucetsFSM` | 通胀水池消费状态机 | `apply_rigid_sink_transaction()` 执行刚性货币回收 |
| [mana_standard_solver.gd](../../../../backend/domains/currency_economy/mana_standard_solver.gd) | `CurrencyAndManaStandardSolver` | 魔单晶本位求解器 | `convert_mana_crystals_to_gold()`、`calculate_cross_continent_arbitrage()` |

---

## 二、关联配置、存档与验证

- **配置与存档**：`domains.currency.core`（别名 `domains.currency`）、`narratives.currency`；在 `domains.json` 登记为 `dirty` 策略可存档域（序列化类 `CurrencyEconomyEntity`）。
- **测试入口**：[test_currency_economy.gd](../../../../tests/unit/domains/test_currency_economy.gd)。
