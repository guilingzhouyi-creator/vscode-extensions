# 多硬件输入感知、死区滤波与文字交互 (`hardware_input`)

> 对应源码：`backend/domains/hardware_input/`（5 个 `.gd`）。支撑键盘、鼠标、手柄与触屏外设热切换感知、手柄摇杆径向死区归一化、Tab 连按双击检测（供命令补全联动）、自定义改键以及鼠标热区命中判定。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置驱动 |
| :--- | :--- | :--- | :--- |
| [input_device_state_aggregate.gd](../../../../backend/domains/hardware_input/input_device_state_aggregate.gd) | `InputDeviceStateAggregate` | 输入设备状态聚合根 | 定义 `ActiveInputDevice` 枚举；`resolve_escape_menu_action()`、`get_ui_button_prompt()` |
| [adaptive_input_filter_solver.gd](../../../../backend/domains/hardware_input/adaptive_input_filter_solver.gd) | `AdaptiveInputFilterSolver` | 径向死区与热切换求解 | `filter_radial_deadzone()`（基于 `stick_deadzone/{inner,outer}`）、`handle_device_input_event()` |
| [text_interaction_solver.gd](../../../../backend/domains/hardware_input/text_interaction_solver.gd) | `TextInteractionSolver` | 鼠标热区与快捷键分发 | `hit_test_mouse_click()`、`dispatch_shortcut()`、`handle_hardware_event()`、`shortcut_prompt()` |
| [tab_double_tap_detector.gd](../../../../backend/domains/hardware_input/tab_double_tap_detector.gd) | `TabDoubleTapDetector` | Tab 双击节奏检测器 | `feed_key_press()`、`reset()`；双击时间窗由 `tab_double_tap/window_ms` 控制 |
| [action_rebinding_service.gd](../../../../backend/domains/hardware_input/action_rebinding_service.gd) | `ActionRebindingService` | 按键重绑定与冲突校验 | `rebind_action()` |

---

## 二、关联配置与验证

- **配置映射**：`domains.hardware_input.core`、`narratives.hardware_input`。
- **测试入口**：[test_hardware_input.gd](../../../../tests/unit/domains/test_hardware_input.gd)。
