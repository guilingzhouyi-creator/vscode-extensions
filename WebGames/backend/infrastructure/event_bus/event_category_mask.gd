# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_category_mask.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 定义五大正交二进制位掩码，支撑事件流分频治理与隔离， 热路径零字符串匹配与反射，杜绝跨类别隐式穿透。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name EventCategoryMask
extends RefCounted

## 核心业务因果流 (1): 伤害判定/生命归零/技能冷却/槽位绑定/网关跃迁（强一致内联）
const CORE_STATE: int       = 1 << 0

## 空间视觉流 (2): 刀光/粒子/跳字/屏幕震动（AoI 裁剪与帧合批）
const SPATIAL_VFX: int      = 1 << 1

## 空间音频流 (4): 武器碰撞/环境声/脚步/受击喊叫（空间衰减与帧合批）
const SPATIAL_AUDIO: int    = 1 << 2

## 叙事文案流 (8): 战报/对白/系统广播/提示文案
const NARRATIVE_TEXT: int   = 1 << 3

## 系统遥测流 (16): 指标/Profiling/审计日志
const SYSTEM_TELEMETRY: int = 1 << 4

## 常用组合掩码
const MASK_ALL_SPATIAL: int = SPATIAL_VFX | SPATIAL_AUDIO
const MASK_ALL: int         = 0xFFFFFFFF
