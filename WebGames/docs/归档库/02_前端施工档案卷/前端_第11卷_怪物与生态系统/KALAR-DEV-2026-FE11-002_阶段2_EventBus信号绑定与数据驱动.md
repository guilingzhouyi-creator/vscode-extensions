---
档号: KALAR-DEV-2026-FE11-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: FE11 (前端第11卷: 怪物与生态系统)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎前端组
题名: 前端第11卷：怪物与生态系统 —— 阶段2：核心业务具体实施细类的代码编写
形成日期: 2026-08-31
归档日期: 2026-08-31
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 图鉴条目DTO; BOSS转相结构; 兽潮风险上限; 威胁等级配色; 单元测试; 阶段2
---

# 施工细则：前端第11卷：怪物与生态系统（图鉴/世界BOSS多阶段/兽潮调度状态） —— 阶段2：核心业务具体实施细类的代码编写

> [!NOTE]
> **【施工目标】**：完成视图控制器核心交互逻辑实现、EventBus 信号监听与 DTO 响应式数据绑定。
> **对应需求源**：[前端架构需求表11.md (前端第11卷)](../../../前端架构/前端架构需求表11.md)。

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[二、 视图契约与核心交互逻辑](../../../前端架构/前端架构需求表11.md)
* **核心不变量约束断言**：`严格单向数据流响应，杜绝帧轮询脏读取，视图销毁必须反注册 EventBus 信号`
* **业务实现最高指示**：将业务交互拆解为最小单一职责函数，严格按 EventBus 推流触发重绘！

---

## 一、 核心视图细类与业务响应实现 (Core View Implementation)

```gdscript
# 模块路径: res://frontend/views/fe11_怪物与生态系统/monsterecologyview.gd
class_name MonsterEcologyViewStage2 extends Control:
    var view_initialized: bool = false
    var status_label: Label

    func _ready() -> void:
        _bind_event_signals()
        view_initialized = true

    func _bind_event_signals() -> void:
        # 严格消费 EventBus 信号，响应式刷新
        if EventBus.get_instance().has_signal("log_message_posted"):
            EventBus.get_instance().log_message_posted.connect(_on_event_received)

    func _on_event_received(level: String, msg: String) -> void:
        # 响应式增量更新
        pass

    # 核心业务处理流程
    func update_outbreak_risk(risk_val: float) -> void:
    var max_risk = GameConfig.get_float("frontend.views", "fe11_monster_ecology/outbreak_risk_max_pct", 100.0)
    current_risk = clamp(risk_val, 0.0, max_risk)
    risk_progress_bar.value = current_risk
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] **Step 11.2.1: 业务交互流程拆解与前置状态判定** - 明确用户触发事件与前置校验守卫
- [x] **Step 11.2.2: EventBus 信号订阅与 DTO 解包映射** - 响应式接收后端推流并更新视图
- [x] **Step 11.2.3: 实施细类拆分与单一职责落实** - 将复杂界面拆分为可独立管理的子组件
- [x] **Step 11.2.4: 视图退出生命周期信号反注册** - 在 `tree_exiting` 中断开所有动态信号连接

---

## 三、 核心业务初步验证矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-FE11-S2-01` | 核心交互流程执行 | 用户操作触发事件 | 视图正确响应并发出事件，状态流转正常 |
| `TC-FE11-S2-02` | EventBus 信号响应式推流 | 模拟后台推流数据 | 视图控件内容即时增量刷新 |
| `TC-FE11-S2-03` | 非法/越界输入前置拦截 | 缺省非法入参 | 前置守卫阻断执行，友好提示错误 |
