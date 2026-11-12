# 祈愿卡池与大小保底概率系统 (`gacha_wish`)

> 对应源码：`backend/domains/gacha_wish/`（3 个 `.gd`）。基于 `DeterministicRNG` 实现软/硬保底递增概率模型（70 抽软保底、90 抽硬保底与大小保底切换），并经统一物品注册表将抽中道具实例化入包。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与约束说明 |
| :--- | :--- | :--- | :--- |
| [gacha_banner_entity.gd](../../../../backend/domains/gacha_wish/gacha_banner_entity.gd) | `GachaBannerAggregate` | 卡池与保底状态聚合体 | `snapshot_progress()`、`restore_progress()`、`serialize()`/`deserialize()` |
| [gacha_probability_solver.gd](../../../../backend/domains/gacha_wish/gacha_probability_solver.gd) | `GachaProbabilitySolver` | 软硬保底概率求解器 | `calculate_current_5star_rate()`、`roll_single_draw()`（批量调用严格共用同一个 `DeterministicRNG` 实例） |
| [gacha_execution_service.gd](../../../../backend/domains/gacha_wish/gacha_execution_service.gd) | `GachaExecutionService` | 十连扣款与入包服务 | `execute_multi_pull()` 扣除金币/魔单晶后通过物品注册表三元组 `canonical_id` 实例化入包 |

---

## 二、关联配置与验证

- **依赖域**：`currency_economy`、`inventory`；配置 `domains.gacha.core`、`narratives.gacha`。
- **测试入口**：[test_gacha_wish.gd](../../../../tests/unit/domains/test_gacha_wish.gd)。
