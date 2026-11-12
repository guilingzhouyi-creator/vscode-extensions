# 登录公告板、停服维护与准入闸门 (`bulletin_board_maintenance`)

> 对应源码：`backend/domains/bulletin_board_maintenance/`（3 个 `.gd`）。管理登录界面动态公告卡片列表、停服维护倒计时，以及维护期对普通玩家准入拦截（放行 GM 白名单）的登录检定逻辑。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与职责 |
| :--- | :--- | :--- | :--- |
| [bulletin_board_aggregate.gd](../../../../backend/domains/bulletin_board_maintenance/bulletin_board_aggregate.gd) | `BulletinBoardAggregate` | 公告与维护状态聚合根 | `add_card()` 维护公告卡片与优先级排序、维护窗口时间与白名单 |
| [bulletin_board_solver.gd](../../../../backend/domains/bulletin_board_maintenance/bulletin_board_solver.gd) | `BulletinBoardSolver` | 登录准入检定求解器 | `check_login_permission()` 判定是否处于维护阻断状态及倒计时 |
| [bulletin_push_pipeline.gd](../../../../backend/domains/bulletin_board_maintenance/bulletin_push_pipeline.gd) | `BulletinPushPipeline` | GM 公告与维护推送管线 | `set_maintenance()` 切换维护状态并下发停机告示 |

---

## 二、关联配置与验证

- **配置映射**：`domains.bulletin_board_maintenance.core`、`narratives.bulletin_board_maintenance`。
- **测试入口**：[test_bulletin_board_maintenance.gd](../../../../tests/unit/domains/test_bulletin_board_maintenance.gd)。
