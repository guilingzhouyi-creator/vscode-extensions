# 施工细则：存档二次载入与复合鉴权双轨分流引擎 —— 阶段3：全链路HUD聚合与ESC停机反装配串联

> [!NOTE]
> **【施工目标】**: 将双轨进入流汇聚至游戏世界主页 HUD 快照聚合服务，并串接 ESC 呼出菜单与优雅停机（Graceful Shutdown）反装配管线，确保资源有序释放与存档安全刷盘。
> **施工开始日期：** 2026-10-02
> **阶段状态：** ✅ 已验收 (Completed)；状态以[路线图总索引](../../路线图总索引.md)为准。

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `WebGames/docs/README.md`、`res://backend/domains/world_state/hud_state_sync_service.gd`、`res://backend/domains/game_lifecycle/game_lifecycle_service.gd`
- **核心不变量约束断言**: HUD 快照通过 `apply_snapshot()` 统一消费后端无头领域数据；退出流必须经由 ESC 菜单触发优雅停机序列，资源释放按优先级降序严格回收，会话令牌安全注销。
- **防漂移最高指示**: 停机序列严禁遗留内存泄漏或悬挂任务，存档数据在退出前必须原子写入。

## 一、 阶段目标与数据契约设计
1. 双轨汇聚：无论是序章重放初始化还是成熟存档恢复，最终均通过 `HudStateSyncService.trigger_initial_world_sync` 构建主界面 HUD 状态快照。
2. 串接 ESC 交互逻辑：支持 ESC 动作响应，生成菜单数据与选项路由。
3. 停机管线闭环：调用 `GameLifecycleService.execute_graceful_shutdown`，完成脏数据刷盘、对象池复位与子系统反注册。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 整合双轨流输出至 `HudStateSyncService`。
- [x] Step 2: 验证 HUD 快照在成熟存档数据下的一致性呈现。
- [x] Step 3: 对接 ESC 菜单路由与停机指令触发。
- [x] Step 4: 验证优先级资源回收队列与会话注销。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-101-03-01 | 成熟存档 HUD 快照一致性 | 成熟存档数据载入并触发 HUD 同步 | 快照包含存档中实际的生命、魔法、货币与背包数 |
| DoD-101-03-02 | ESC 停机优雅反装配 | 触发 ESC 菜单并确认退出 | 存档原子刷盘，资源按优先级有序释放，会话状态变为 STOPPED |

