# 卡拉尔世界引擎 · 吞吐量基线表

- 引擎: KalarWorldEngine  Godot: 4.7.2-stable (official)
- 时间: 2026-08-30T20:52:58  主机: LAPTOP-SVORFG3P
- 报告: bench_latest.json

| 指标 | 迭代次数 | 耗时(ms) | 吞吐量 (ops/s) |
|---|---:|---:|---:|
| Currency.arbitrage 跨大陆套利 | 50000 | 31.6 | 1,580,228.2 |
| GameConfig.get_dict 整表读取 | 50000 | 40.0 | 1,249,718.8 |
| GameConfig.get_string 热路径读取 | 100000 | 106.1 | 942,356.1 |
| GameConfig.get_float 热路径读取 | 200000 | 254.0 | 787,534.9 |
| GameConfig.get_int 热路径读取 | 200000 | 281.7 | 710,020.5 |
| EventBus.emit_log 日志广播 | 50000 | 94.3 | 530,487.1 |
| EventBus.render_narrative 模板渲染 | 100000 | 279.1 | 358,309.9 |
| Currency.mana 魔单晶换金 | 100000 | 291.8 | 342,695.8 |
| WorldClock.tick_combat 战斗滴答 | 100000 | 446.2 | 224,132.8 |
| Authority.audit_input_continuity 时序审计 | 100000 | 462.1 | 216,423.0 |
| Currency.wallet.get_total_copper_value 换算 | 200000 | 1268.0 | 157,733.1 |
| WorldClock.advance_travel_hours 行军推进 | 20000 | 153.6 | 130,226.1 |
| Currency.wallet 物理质量计算 | 100000 | 830.4 | 120,426.2 |
| EventBus.emit_narrative_by_key 叙事广播 | 50000 | 434.5 | 115,078.0 |
| Authority.transition_mode 模式流转 | 100000 | 1227.6 | 81,457.9 |
| SaveManager.compute_sha256 完整性签名 | 20000 | 274.2 | 72,938.4 |
| Currency.sink 刚性回收水池 | 50000 | 865.6 | 57,760.5 |
| JSON.stringify 存档信封序列化 | 20000 | 1498.5 | 13,346.4 |
| JSON.parse 存档信封反序列化 | 20000 | 1726.0 | 11,587.3 |
| GameConfig 全量加载+热重载 | 20 | 32.5 | 616.2 |
| SaveManager save+load 往返 | 30 | 323.5 | 92.7 |
