---
档号: KALAR-DEV-2026-ST99-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST99 (Phase_103_双域储存架构与异步流式加载引擎施工细则)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_103_双域储存架构与异步流式加载引擎施工细则 —— 阶段1：双域储存抽象契约_配置驱动底座与最小世界状态DTO
形成日期: 2026-10-03
归档日期: 2026-10-03（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 双域储存抽象契约_配置驱动底座; 最小世界状态DTO; storage.json
---

# 施工细则：双域储存架构与异步流式加载引擎 —— 阶段1：双域储存抽象契约、配置驱动底座与最小世界状态DTO

> [!NOTE]
> **【施工目标】**: 拆分主要数据与辅助数据双域储存抽象契约，建立配置驱动表 `storage.json`，并定义轻量化最小世界状态 DTO 与九维储存度量 DTO，消除硬编码与大资产耦合。
> **施工开始日期：** 2026-10-03
> **阶段状态：** ✅ 已验收 (Completed)；状态以[路线图总索引](../../../../路线图/路线图总索引.md)为准。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST99-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST99-002_阶段2_主要数据极速恢复引擎与辅助资源并发调度管道.md) ｜ [阶段3](KALAR-DEV-2026-ST99-003_阶段3_主线程切片预算提交器_动态预加载滑动窗口与DAG定向热重载.md) ｜ [阶段4](KALAR-DEV-2026-ST99-004_阶段4_全域无头回归测试矩阵_观测指标看板与二十项门禁对齐.md)

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `WebGames/docs/README.md`、`WebGames/config/infrastructure/storage.json`、`res://backend/infrastructure/save_manager.gd`
- **核心不变量约束断言**: 主要数据域专注于账号、角色进度、核心状态与不可重建数据，严格与地图/纹理/音频等辅助资源解耦；最小状态恢复必须在毫秒预算内完成；所有储存路径、并发度与缓存上限必须由 `storage.json` 驱动。
- **防漂移最高指示**: 业务代码严禁直接依赖具体文件格式或底层 IO 实现，统一通过 `StorageContractInterfaces` 定义的契约交互。

## 一、 阶段目标与数据契约设计
1. 建立 `WebGames/config/infrastructure/storage.json`，集中管理主数据与辅助资源的路径、批大小、并发度、帧预算与超时时间。
2. 建立 `res://backend/domains/persistence_protocol/storage_contract_interfaces.gd`，定义 `LoadPriority` 优先级枚举与主/辅抽象契约接口。
3. 建立 `res://backend/domains/persistence_protocol/dto/minimum_world_state_dto.gd`，支持首个可交互时间（TTFI）极速达成。
4. 建立 `res://backend/domains/persistence_protocol/dto/storage_metrics_dto.gd`，覆盖九维运行时观测度量。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 创建 `WebGames/config/infrastructure/storage.json` 并注册至 `GameConfig._required_tables`。
- [x] Step 2: 实现 `storage_contract_interfaces.gd` 抽象契约与优先级常量。
- [x] Step 3: 实现 `minimum_world_state_dto.gd` 与 `storage_metrics_dto.gd`，接入 `reset_state()`。
- [x] Step 4: 静态语法与配置校验 100% 通过。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-103-01-01 | 储存配置规范加载 | `GameConfig.get_section("infrastructure.storage")` | 包含 `primary`、`auxiliary`、`preload_window` 键，字段类型完整正确 |
| DoD-103-01-02 | 抽象契约接口就绪 | 实例化契约基类与枚举派发 | `StorageContractInterfaces.LoadPriority` 枚举包含 5 级优先级，契约函数默认安全回退 |
| DoD-103-01-03 | 最小世界状态 DTO 往返 | 创建 DTO 实例调用 `to_dict()` 与 `from_dict()` | 往返数据严格一致，`reset_state()` 正确复位为初始值 |
