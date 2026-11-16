---
档号: KALAR-DEV-2026-ST121-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST121 (Phase_125_JSON全域高纯度二进制封装转化系统与GameConfig双轨引擎施工细则)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_125_JSON全域高纯度二进制封装转化系统与GameConfig双轨引擎施工细则 —— 阶段3：引擎端极速解码器与GameConfig双轨接入规范
形成日期: 2026-10-15
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: BinaryConfigReader; 解码器核心流程; GameConfig.gd 双轨接入
---

# 施工细则：Phase 125 JSON全域高纯度二进制封装转化系统与GameConfig双轨引擎施工细则 —— 阶段3：引擎端极速解码器与GameConfig双轨接入规范

> [!NOTE]
> **【施工目标】**：在 Godot 引擎层实现零瞬态堆分配的极速二进制解码器（`res://backend/infrastructure/binary_config_reader.gd`）；重构升级全域配置中心（`GameConfig.gd`）支持 `.kdat` 与 `.json` 智能双轨自适应加载与全库单包（Monolithic Bundle）解析；在并发辅助线程池（`AuxiliaryWorkerPool.gd`）无感适配二进制流装载。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST121-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST121-ATT_附件_案卷共享契约与上下文.md)。
> 施工开始日期: 2026-10-15
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST121-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST121-001_阶段1_高纯度二进制流格式标准与数据契约设计规范.md) ｜ [阶段2](KALAR-DEV-2026-ST121-002_阶段2_离线转化编译器与CLI工具链实现规范.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST121-004_阶段4_全量回归验收与性能基准测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [`GameConfig`](../../../../../backend/infrastructure/game_config.gd)：全域配置中心与静态表字典
  * [`ConfigRouterEngine`](../../../../../backend/infrastructure/config_router_engine.gd)：泛化路由分发与子表加载引擎
  * [`StorageResourceCatalog`](../../../../../backend/domains/persistence_protocol/storage_resource_catalog.gd)：统一资源目录索引
  * [`AuxiliaryWorkerPool`](../../../../../backend/domains/persistence_protocol/auxiliary_worker_pool.gd)：双域存储并发辅助线程池
* **核心不变量约束断言**：
  * **Inv-DUAL-TRACK-EQUIVALENCE-1**：通过 `.kdat` 加载的数据表内容必须与通过 `.json` 加载在键名、层级与数值类型上 100% 一致；
  * **Inv-ZERO-HEAP-DECODE-2**：二进制解码过程除产出的数据字典外，严禁在循环内部实例化临时对象（落实 `ADV-PRF-002` 与 `PRF-MEM-001`）；
  * **Inv-GRACEFUL-FALLBACK-3**：当 `.kdat` 文件不存在且处于调试模式时，自动回退至同名 `.json`，确保开发期敏捷度与热重载。
* **工程化重构最高指示**：重构严格维持现有 `GameConfig.get_int`、`get_dict` 等业务公共 API 契约不变，实现业务层 100% 无感升级。

---

## 一、 引擎端解码器实现与双轨接入

### 1.1 解码器核心流程 (`BinaryConfigReader.gd`)
1. **Header 校验与防攻击熔断**：
   - 检查文件长度 $\ge 32$ 字节；
   - 验证魔数 `0x4B444154`（'KDAT'）；
   - 验证主版本号与头部定长尺寸；
2. **校验与解压**：
   - 计算数据体 CRC32 并比对；
   - 若 `FLAG_COMPRESSED` 开启，调用 `PackedByteArray.decompress()` 进行 C++ 级底层极速解压；
3. **TLV 数据流装配**：
   - 解析字符串驻留表（String Pool）；
   - 利用 `StreamPeerBuffer` 顺序读取强类型字段，装配最终的 `Dictionary` 或 `Array`；
   - 全过程零文本词法扫描，无多余瞬态中间变量。

### 1.2 `GameConfig.gd` 双轨接入
- 升级 `_load_table()` 与 `_ensure_table_loaded_jit()`：优先探测同名 `.kdat`；
- 升级 `_scan_dir()`：在构建期包体内支持直接遍历扫描 `.kdat` 目录或解包单文件 `config.kdat`；
- `AuxiliaryWorkerPool.gd` 异步适配：在后台线程中支持 `.kdat` 的直接反序列化，剥离主线程开销。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] **Step 1**: 在 `WebGames/backend/infrastructure/` 编写 `binary_config_reader.gd`
- [x] **Step 2**: 改造 `game_config.gd` 支持 `.kdat` 优先与 `.json` 优雅回退双轨机制
- [x] **Step 3**: 改造 `auxiliary_worker_pool.gd` 支持后台线程 `.kdat` 异步流式解码
- [x] **Step 4**: 运行架构静态检查与代码复杂度审查，确保符合指标预算

---

## 三、 DoD 完成态验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-KDAT-S3-01` | 解码器异常与熔断 | `BinaryConfigReader.load_kdat_buffer(bad_data)` | 返回空并记录显式错误码 |
| `TC-KDAT-S3-02` | GameConfig 双轨兼容 | `GameConfig.ensure_loaded()` | 正确装载配置表，双轨加载无感知 |
| `TC-KDAT-S3-03` | 异步工作池解码 | `AuxiliaryWorkerPool._load_resource_payload(kdat_path)` | 成功解包二进制数据，无异常崩溃 |
