---
档号: KALAR-DEV-2026-ST93-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST93 (Phase_97_后端数据泥团聚合与冗余代理委托消解治理施工细则)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_97_后端数据泥团聚合与冗余代理委托消解治理施工细则 —— 阶段1：数据泥团参数聚合与强类型DTO上下文设计
形成日期: 2026-09-29
归档日期: 2026-10-03（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 数据泥团参数聚合; 强类型DTO上下文设计
---

# 施工细则：后端数据泥团聚合与冗余代理委托消解治理 —— 阶段1：数据泥团参数聚合与强类型DTO上下文设计

> [!NOTE]
> **施工开始日期**: 2026-09-29
> **【施工目标】**: 针对后端核心服务中散落的超标标量入参函数（>= 5 个参数），提取领域强类型 Context / DTO 契约，杜绝参数泥团（GOV-DAT-001），并提供 100% 向后兼容的重载或可选字典支持。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST93-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST93-002_阶段2_冗余代理委托消除与直接底层调用链路重构.md) ｜ [阶段3](KALAR-DEV-2026-ST93-003_阶段3_高承压残余热点优化与超大文件子模块治理.md) ｜ [阶段4](KALAR-DEV-2026-ST93-004_阶段4_全域无头回归验收测试矩阵与二十项门禁对齐.md)

## 📌 第一性原理溯源指针
- **精准上游规范指针**: `WebGames/docs/README.md`、`WebGames/config/README.md`
- **核心不变量约束断言**: 零标量参数泥团违规（`GOV-DAT-001 = 0`）、业务入参封装为强类型 DTO 上下文、对外公开 API 100% 向后兼容。
- **防漂移最高指示**: 保持对外公开 API 与行为 100% 向后兼容，纯内部实现重构，杜绝契约漂移。

## 一、 核心算法与数据契约设计
1. **账号槽位创建契约**：在 `account_slot_binding_solver.gd` 中提取 `AccountSlotCreationDTO`，收敛 6 参数为单一上下文对象。
2. **沙盒追回事务契约**：在 `clawback_service.gd` 中提取 `ClawbackTransactionDTO`，聚合追回类型、货币、道具及审计标量。
3. **兑换券核销契约**：在 `cdkey_redemption_solver.gd` 中提取 `CDKeyRedemptionDTO`，聚合批次、平台、签名及用户上下文。
4. **属性换算与任务状态机契约**：提取 `AttributeConversionDTO` 与 `CommissionAcceptanceDTO`，规范事件提取器与抽卡执行器入参。

## 二、 命令式施工执行清单 (Agent Execution Checklist)
- [x] Step 1: 创建 `account_slot_creation_dto.gd`、`clawback_transaction_dto.gd`、`cdkey_redemption_dto.gd` 等强类型 DTO。
- [x] Step 2: 重构 `account_slot_binding_solver.gd`、`clawback_service.gd`、`cdkey_redemption_solver.gd`，支持 DTO 与平铺参数双向兼容。
- [x] Step 3: 重构 `attribute_conversion_engine.gd`、`commission_fsm.gd`、`composite_event_extractor.gd`、`gacha_execution_service.gd`。
- [x] Step 4: 同步更新所有关联单测与集成管线用例，确保断言完全通过。

## 三、 阶段验收矩阵 (DoD Matrix)
| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| DoD-97-01-01 | 数据泥团参数收敛 | `audit_refactor_metrics.py` 扫描全域 DTO 与服务方法 | 目标方法参数数量 <= 4 或封装为 DTO，`GOV-DAT-001 = 0` |
| DoD-97-01-02 | DTO 构造与兼容性 | 运行对应领域单元测试套件 | DTO 默认实例化与解构正常，测试 100% 通过 |
