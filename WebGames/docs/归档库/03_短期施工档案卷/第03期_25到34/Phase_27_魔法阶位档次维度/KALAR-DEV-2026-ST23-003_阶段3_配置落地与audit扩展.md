---
档号: KALAR-DEV-2026-ST23-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST23 (Phase_27_魔法阶位档次维度)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_27_魔法阶位档次维度 —— 阶段3：配置落地与audit扩展
形成日期: 2026-09-01
归档日期: 2026-09-02（下午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 配置落地; audit扩展; magic_tiers.json
---

# 施工细则：魔法阶位档次维度（低阶/中阶/高阶/超位）—— 阶段3：配置落地与audit扩展

> **施工开始日期**：2026-09-01

> [!NOTE]
> **【施工目标】**：`magic_tiers.json` 新增 `rank_bands` 段（四档**确定性区间**，规范序列化——数组多行展开）；i18n 新增 `magic.rank_band.*` 键；`audit_magic_dimensions.py` **六→八校验扩展**（⑦ 档次互斥全覆盖 ⑧ 禁嵌套），audit_runner 挂载保持。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST23-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST23-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：用户指令 + S1/S2 契约。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST23-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST23-001_阶段1_第三维度数据契约.md) ｜ [阶段2](KALAR-DEV-2026-ST23-002_阶段2_档次维度实现设计.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST23-004_阶段4_全量测试与工程验收矩阵.md)

---

## 一、 配置落地（magic_tiers.json 新增 rank_bands 段）

```json
{
  "rank_bands": {
    "LOW": {
      "band": 1,
      "interval": [
        1,
        3
      ],
      "name_key": "magic.rank_band.low"
    },
    "MID": {
      "band": 2,
      "interval": [
        4,
        6
      ],
      "name_key": "magic.rank_band.mid"
    },
    "HIGH": {
      "band": 3,
      "interval": [
        7,
        9
      ],
      "name_key": "magic.rank_band.high"
    },
    "SUPERTIER": {
      "band": 4,
      "interval": [
        10,
        11
      ],
      "name_key": "magic.rank_band.supertier"
    }
  }
}
```

- **互斥全覆盖**：[1,3]/[4,6]/[7,9]/[10,11] 无重叠、无缝覆盖 1~11（每阶恰属一档）；
- **禁嵌套**：档次名（LOW/MID/HIGH/SUPERTIER）不嵌入阶位键（`rank_1` 纯梯度保持）；
- **规范序列化**：数组元素多行展开（Phase 26 教训——`json.dumps(ensure_ascii=False, indent=2)` 规范比对）。

## 二、 i18n 键（config/i18n/）

| 键 | en_US | zh_CN |
| :--- | :--- | :--- |
| `magic.rank_band.low` | Low-rank Magic | 低阶魔法 |
| `magic.rank_band.mid` | Mid-rank Magic | 中阶魔法 |
| `magic.rank_band.high` | High-rank Magic | 高阶魔法 |
| `magic.rank_band.supertier` | Supertier Magic | 超位魔法 |

- **超位命名区分**：`magic.rank_band.supertier`（10~11 阶统称）≠ `magic.ability_tier.supertier`（主体高级位阶）——键前缀区分，跨域/同域无冲突（magic 域内不同前缀段）。

## 三、 audit_magic_dimensions.py 六→八校验扩展

| 新增校验 | 规则 | 级别 |
| :--- | :--- | :--- |
| ⑦ 档次互斥全覆盖 | `rank_bands` 四档区间两两无重叠、无缝覆盖 1~11（并集 == 1..11 且无交集） | 阻断 |
| ⑧ 禁嵌套 | `rank_bands` 键/条目名不嵌入阶位键（rank_N 纯梯度）；档次名不嵌入能力分级名 | 阻断 |

- 既有六校验保持（阶位递增/无能力前缀/能力分级独立/区间自洽/禁1:1/i18n 键）——新增 ⑦⑧ 追加为校验 7/8；
- i18n 键存在校验扩展：`magic.rank_band.*` 四键在 en_US/zh_CN 登记；
- audit_runner 挂载保持（task_id="magic_dimensions" 不变，脚本内扩展）。

---

## 四、 验证矩阵 (DoD)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-RB-S3-01` | rank_bands 段加载 | magic_tiers.json | 四档配置 GameConfig 加载成功 + 规范序列化比对一致 |
| `TC-RB-S3-02` | 互斥全覆盖 | 区间集合并集/交集 | 并集 == [1..11]、任意两档交集为空 |
| `TC-RB-S3-03` | i18n 键齐全 | en_US/zh_CN 键集 | magic.rank_band.low/mid/high/supertier 双语言登记 |
| `TC-RB-S3-04` | audit 扩展 | audit_magic_dimensions 运行 | 八校验零违规（含 ⑦互斥全覆盖 ⑧禁嵌套） |
| `TC-RB-S3-05` | 超位命名区分 | i18n 键比对 | rank_band.supertier ≠ ability_tier.supertier（值/语义独立） |
| `TC-RB-S3-06` | 既有校验保持 | audit 全量 | 六→八校验无回归（原有校验零违规） |
