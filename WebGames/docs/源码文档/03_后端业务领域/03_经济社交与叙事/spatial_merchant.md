# 空间地缘商铺与游荡行商 (`spatial_merchant`)

> 对应源码：`backend/domains/spatial_merchant/`（3 个 `.gd`）。将商店交互绑定物理欧氏距离与有限货架库存，并控制游荡商人的刷新停靠与时限拔营离开。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置键 |
| :--- | :--- | :--- | :--- |
| [merchant_shop_aggregate.gd](../../../../backend/domains/spatial_merchant/merchant_shop_aggregate.gd) | `MerchantShopAggregate` | 物理商铺聚合根 | 定义 `ShopType` 与 `add_shelf_item()`；读取 `shop/interaction_radius_meters` |
| [roaming_merchant_fsm.gd](../../../../backend/domains/spatial_merchant/roaming_merchant_fsm.gd) | `RoamingMerchantFSM` | 游荡商人驻留状态机 | `spawn_roaming_peddler()`、`is_peddler_active()` 管理停留期与过期撤离 |
| [shop_proximity_transaction_solver.gd](../../../../backend/domains/spatial_merchant/shop_proximity_transaction_solver.gd) | `ShopProximityTransactionSolver` | 空间邻近交易求解器 | `check_spatial_proximity()`（$D \le R$ 判定）、`buy_item()` 扣减货架库存与货币 |

---

## 二、关联配置与验证

- **依赖域**：`world_navigation`；配置 `domains.spatial_merchant.core`、`narratives.spatial_merchant`。
- **测试入口**：[test_spatial_merchant.gd](../../../../tests/unit/domains/test_spatial_merchant.gd)。
