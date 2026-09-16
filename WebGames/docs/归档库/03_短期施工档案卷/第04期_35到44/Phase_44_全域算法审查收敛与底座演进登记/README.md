# Phase 44 · 全域算法审查结论与立项登记（本卷 README）

> 状态：🔲 已审查登记 · 待四阶段细则获批后开工（严禁未经细则批准编写业务代码）

## 一、立项源

2026-09-03 项目负责人发起的**全域只读算法审查**（合理性与效率 / 现代化要求 / 文字版 → 2D 可操作版 → 3D 角色扮演控制版的底座演进可行性），结论为「需修改」（无阻塞项）。本卷即审查结论的路线图登记与后续收敛实施的源头案卷。审查全程纯只读，未改动任何业务代码。

## 二、审查结论摘要（登记基线）

- **算法正确性 / 确定性 / 配置驱动**：战斗侵彻伤害、魔素相变能损、属性三层换算、动态供需弹性均验证正确；DeterministicRNG 全量取代裸随机（backend 零残留，TC-ARCH-04 兜底）；GameBootstrap 幂等装配、事件双通道结构化、17 处序列化契约、TODO/FIXME=0。
- **主要负债（按收益排序）**：
  - P1 `item_instance_factory.gd:17-23` 每建带品质实例即整表重建 QualityTierRegistry（十连/批量发放放大）；
  - P2 `GameConfig.get_*` 热路径无路径缓存（每调用 `_split_path` 重建 + 逐段遍历）；
  - P3 `account_item_library` 记账全树线性反查 + 自底向上整棵非增量重算；
  - P4 多处超容裁剪 `while…erase(keys()[0])` O(k²)（clawback/commission/gacha/mail）；
  - P5 `equipment_fsm` 每次穿/脱无条件全仓深快照；P6 server_grant_registry/npc_legacy_fsm 无界容器未收口；P7 multi_cast 逐击 ctx 拷贝 / ground_loot cleanup 整表重建。
- **底座演进缺口（E1~E4）**：E1 坐标模型未集中抽象（Vector2 各域自造、无 z、SpatialMath 仅 2D）；E2 `monster.killed`/掉落链路缺坐标（现缺省 0.0）；E3 时间模型与实时渲染未打通（dt=20ms 仅注释、位移桥接未内化 dt，需固定逻辑步长 + 渲染插值）；E4 表现层零接线（17 视图骨架、18 个 tscn 全 Control、无 Node2D/3D/相机/精灵）。

## 三、本卷收敛范围（建议，待细则拆分定稿）

1. **P 类性能反模式收敛**（短期施工区）：P1 装配期单例化复用（循 GameBootstrap 既有 MagicTier/MagicRule 先例）；P2 值表缓存或批量读；P3 canonical→(major,minor) 索引 + 增量/脏标记聚合；P4 统一「最旧先出」或容量前置；P5 快照分级/仅在写路径；P6 无界容器补上限（循 Phase 43 有界化纪律）；P7 ctx 冻结共享 + 尾部压缩清理。
2. **E 类底座演进契约收口（引擎层，可扩展设计）**：E1 统一 WorldPosition（Vector3 兼容升维 + SpatialMath 泛化）在 2D 阶段先行引入；E2 击杀/掉落链路补结构化坐标；E3 「固定逻辑步长 + 渲染插值」调度契约与位移桥接 dt 内化。
3. **现代化补缺（可选）**：hardware_input 由纯求解器接 Godot InputEvent 的适配层设计。

## 四、范围外 / 待授权（不擅入本卷细则）

- E4 渲染宿主（2D/3D 场景层、相机、精灵、动画通道）属**表现层新建工程**，非后端求解器改造——按分层治理默认归 **02_长期演进区**，需另行显式授权立项。
- 各 E 项若后续决定全量落地为可操作/3D 底座，应在对应演进卷中重新立项，本卷仅做引擎层契约准备，不做前端场景搭建。

## 五、验收预期（登记口径，最终以获批细则为准）

- P 类：全量门禁（check-gdscript → test-run → audit-config --strict → audit-arch → audit-all 17/17 → audit-docs）0 新增违规，既有 379/379 断言零回归；
- E1/E2/E3：以「既有调用零行为变化 + 新契约测试覆盖」为收口判据（语义不漂移）。
