# 05 业务视图层 (`frontend/views/`)

> 本目录映射 [frontend/views/](../../../../frontend/views/) 全部 **18 个业务视图子目录**（35 个 `.gd` 脚本，11,984 LOC + 17 个 `.tscn` 场景），覆盖从账号入口、主 HUD、战斗、经济、祈愿、养成、社交、世界地图、工坊到过场演出的完整客户端界面。

---

## 一、主视图 + 子委托混合模式

除 `cutscene_player` 由 `CutsceneEventBridge` 按需动态挂载外，其余 17 个主视图均在 `NavManager._init_default_registry()` 中注册 `.tscn` 场景，并在脚本层面采用**「宿主 View + 子控制器 (`*Tabs` / `*Subpanels`) 委托」**模式拆分超过阈值体积的面板逻辑：

- **宿主 View (`*_view.gd`)**：继承 `BaseScreen`，承载视图级状态机、`apply_snapshot()`、公共组件懒装配及核心 Tab/交互信号响应。
- **子控制器 (`*_tabs.gd` / `*_subpanels.gd`)**：由宿主 View 通过 `_register_owned_subcontroller()` 托管并在 `setup(view)` 中注入宿主引用，统一经 `_view` 访问共享节点树（单一数据源），页面销毁时自动连带清理。
- **零计算纪律**：业务公式、抽奖概率、掉落结算、权限校验与配置阈值读取均收敛至 `ServiceLocator.get_instance().*()` 服务边界，视图层只消费响应与只读规则快照。

---

## 二、6 大功能群组索引（全量覆盖 18 个视图）

| 分册文档 | 覆盖视图目录 | 脚本 + 场景数 | 核心画面范围 |
| :--- | :--- | :---: | :--- |
| [01_基础入口与系统设置视图.md](01_基础入口与系统设置视图.md) | `account_entry`、`main_hud`、`settings_center`、`system_save` | 8 `.gd` + 4 `.tscn` | 闪屏/登录/创角/选服、常驻 HUD 与 GM 命令终端、音画设置、多档与回放审计 |
| [02_角色养成与战斗视图.md](02_角色养成与战斗视图.md) | `character_progression`、`combat_view` | 4 `.gd` + 2 `.tscn` | 8-Tab 角色全览/潜能/体质/技能/装备/背包/称号/传记、BOSS 多部位血条与战报结算 |
| [03_经济交易与祈愿视图.md](03_经济交易与祈愿视图.md) | `economy_trade`、`gacha_wish` | 4 `.gd` + 2 `.tscn` | 钱包四级货币/商铺/拍卖/商队/物价/兑换/资源水池、卡池切换与保底祈愿演出 |
| [04_世界探索与社交视图.md](04_世界探索与社交视图.md) | `world_map`、`quest_causality`、`mail_system`、`guild_social`、`monster_ecology` | 10 `.gd` + 5 `.tscn` | 七大洲地图与行军寻路、因果链 DAG 与悬赏、邮箱附件、公会 RBAC/聊天/交易、怪物图鉴与兽潮 |
| [05_工坊魔典与过场视图.md](05_工坊魔典与过场视图.md) | `crafting_workshop`、`grimoire_authoring`、`cutscene_player` | 5 `.gd` + 2 `.tscn` | 强化/配方图鉴/分解/材料库、魔典书库/3D AST 编排/著书版税/反编译、全屏 CG 硬件播放与文字占位演播 |
| [06_通知公告与边缘视图.md](06_通知公告与边缘视图.md) | `notification_bulletin`、`misc_edge` | 4 `.gd` + 2 `.tscn` | Toast/Modal 测试台、公告栏与红点树、假名面具/突变词条/地面拾取与命名空间检索 |
