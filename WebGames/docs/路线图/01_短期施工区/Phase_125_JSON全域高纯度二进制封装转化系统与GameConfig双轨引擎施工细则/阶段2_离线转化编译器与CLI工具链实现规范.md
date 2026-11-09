---
档号: KALAR-DEV-2026-ST121-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST121 (Phase_125_JSON全域高纯度二进制封装转化系统与GameConfig双轨引擎施工细则)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_125_JSON全域高纯度二进制封装转化系统与GameConfig双轨引擎施工细则 —— 阶段2：离线转化编译器与CLI工具链实现规范
形成日期: 2026-10-15
归档日期: 在途施工中
验收状态: 100%自动化测试验收通过 (PASS)
主题词/关键词: kalar_config_compiler; kalar_mod bake; kalar_workbench; round-trip verification; ZSTD
---

# 施工细则：Phase 125 JSON全域高纯度二进制封装转化系统与GameConfig双轨引擎施工细则 —— 阶段2：离线转化编译器与CLI工具链实现规范

> [!NOTE]
> **【施工目标】**：实现离线构建转化编译器核心（`WebGames/scripts/py/lib/kalar_config_compiler.py`）；提供单表编译、全库单包融合（Monolithic Pack）、MOD 资产自动烘焙；实现双向反编译与 100% 差分等价往返验证（Round-trip Byte Parity）；在统一 CLI `kalar_mod.py` 与 `kalar_workbench.py` 接入 `bake` 子命令。
> 施工开始日期: 2026-10-15
> 📍 **卷内快速直达**：[阶段1](阶段1_高纯度二进制流格式标准与数据契约设计规范.md) ｜ **阶段2 (当前)** ｜ [阶段3](阶段3_引擎端极速解码器与GameConfig双轨接入规范.md) ｜ [阶段4](阶段4_全量回归验收与性能基准测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [`capabilities.json`](../../../../mod_sdk/capabilities.json)：MOD SDK 核心能力真源清单
  * [`kalar_workbench.py`](../../../../mod_sdk/tools/kalar_workbench.py)：MOD 开发者集成工作台核心
  * [`kalar_mod.py`](../../../../mod_sdk/tools/kalar_mod.py)：统一开发者 CLI 控制台
* **核心不变量约束断言**：
  * **Inv-ROUNDTRIP-BYTE-PARITY-1**：任何 JSON 经编译器烘焙为 `.kdat` 后，反编译结果与原 JSON 必须在数值、类型与嵌套结构上 100% 等价；
  * **Inv-DETERMINISTIC-BINARY-2**：相同 JSON 输入与构建参数必须产生位等价（Bit-identical）的 `.kdat` 输出；
  * **Inv-ZERO-DATA-CORRUPTION-3**：编译器处理损坏输入时必须显式返回错误码，严禁静默生成不完整产物。
* **业务实现最高指示**：严格贯彻零瞬态堆分配与确定性二进制布局，防范数据溢出与精度截断。

---

## 一、 编译器核心逻辑与数据打包管线

### 1.1 核心转化流程
1. **输入解析与 Schema 预检**：读取源 JSON 文本，确保符合 JSON 语法且顶层结构为标准对象/数组；
2. **纯净 TLV 序列化**：
   - 采用标准类型标识编码（NIL, BOOL, INT32, INT64, FLOAT32, FLOAT64, STRING, ARRAY, DICT）；
   - 字符串驻留（String Interning）：扫描高频重复键名，建立首部字符串索引表，字段键直接使用 2 字节 ID 引用；
3. **数据压缩封装**：
   - 使用标准压缩算法（DEFLATE/ZSTD）处理数据体，计算未压缩长度与压缩后长度；
   - 计算 32 位 CRC 校验和；
4. **组装 `.kdat` 二进制流**：
   - 写入 32 字节 Header；
   - 写入字符串池；
   - 写入压缩数据载荷；
   - 输出至指定目标路径。

### 1.2 往返差分等价校验（Round-trip Verification）
编译器内置自检与反编译方法 `decompile_kdat_to_data()`：
- 接收 `.kdat` 文件，解析头部、校验 CRC32、解压数据载荷、解码 TLV 数据流；
- 与原始 JSON 对象进行深度值比对（Deep Equality Check），确保零数值截断、零类型失真、零键名遗失。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] **Step 1**: 在 `WebGames/scripts/py/lib/` 编写核心转化编译器 `kalar_config_compiler.py`
- [x] **Step 2**: 实现 `compile_json_to_kdat()` 与 `decompile_kdat_to_data()` 往返校验
- [x] **Step 3**: 在 `WebGames/mod_sdk/tools/kalar_mod.py` 扩充 `bake` 子命令
- [x] **Step 4**: 在 `WebGames/mod_sdk/tools/kalar_workbench.py` 扩充工作台烘焙与自测试

---

## 三、 DoD 完成态验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-KDAT-S2-01` | 编译器往返差分等价 | `python WebGames/scripts/py/lib/kalar_config_compiler.py --test` | 往返校验 100% PASS，0 差分漂移 |
| `TC-KDAT-S2-02` | CLI bake 命令可用性 | `python WebGames/mod_sdk/tools/kalar_mod.py bake --help` | 输出参数说明且返回码为 0 |
| `TC-KDAT-S2-03` | 工作台集成自测 | `python WebGames/mod_sdk/tools/kalar_workbench.py --self-test` | 打包、校验与烘焙测试全部 PASS |
