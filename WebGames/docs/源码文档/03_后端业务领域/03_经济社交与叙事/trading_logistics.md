# 供需价格弹性与跨大陆商队物流 (`trading_logistics`)

> 对应源码：`backend/domains/trading_logistics/`（3 个 `.gd`）。建模城镇局部商品库存与供需价格弹性、动态市场均值回归定价方程及商队护卫遇袭风险状态推进。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置驱动 |
| :--- | :--- | :--- | :--- |
| [trading_entities.gd](../../../../backend/domains/trading_logistics/trading_entities.gd) | `TownMarketCommodity` | 集市商品与商队实体 | 读取 `domains.trading:{commodity_defaults,caravan_defaults}/*` |
| [market_elasticity_solver.gd](../../../../backend/domains/trading_logistics/market_elasticity_solver.gd) | `MarketElasticityAndTradingSolver` | 供需弹性纯求解器 | `calculate_market_price()`、`simulate_dumping_impact()`（结合共享表 `domains.economy:dynamic_market/*` 衰减与涨跌幅限制） |
| [caravan_logistics_fsm.gd](../../../../backend/domains/trading_logistics/caravan_logistics_fsm.gd) | `CaravanLogisticsFSM` | 商队运输与劫掠状态机 | `advance_caravan_progress()` 计算沿途遇袭与护卫减伤结转 |

---

## 二、关联配置与验证

- **配置映射**：`domains.trading.core`、共享表 `domains.economy`、`narratives.trading`。
- **测试入口**：[test_trading_logistics.gd](../../../../tests/unit/domains/test_trading_logistics.gd)、[test_dynamic_economy.gd](../../../../tests/unit/infrastructure/test_dynamic_economy.gd)。
