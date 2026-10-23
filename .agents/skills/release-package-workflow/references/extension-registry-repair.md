# 扩展注册表冲突自愈原理与面向用户变更日志编写指南

本指南涵盖 `-HotSync` 本地扩展注册表（`extensions.json`）幽灵条目自愈机制，以及终端产品 `CHANGELOG.md` 的用户价值转化方法。

---

## 一、 宿主扩展注册表幽灵条目自愈 (`Repair-ExtensionRegistry`)

1. **故障成因**：本地多次打包、版本号升级或手动删除旧版扩展目录后，VS Code / Cursor 的 `~/.vscode/extensions/extensions.json` 仍保留指向已删除目录的 `relativeLocation` 指针，导致新版本被遮蔽、命令报错 `command not found` 或状态栏图标消失；
2. **三步自愈流水线**：
   - 解析宿主 `extensions.json` 数组；
   - 对每条记录拼接物理路径并校验目录及 `package.json` 是否真实存在；
   - 过滤失效幽灵条目，按 UTF-8 无 BOM 格式原子写回注册表，随后将最新构建产物同步至目标版本目录。

---

## 二、 面向终端用户的变更日志（Keep-a-Changelog）转化对照

1. **内部工程表述 $\to$ 终端用户收益转化表**：
   - ❌ `重构 TimeAggregator.ts 消除循环内瞬态堆分配，ELOC 降至 450 行`
   - ✅ `显著优化长周期统计数据的加载计算性能，大型工作区秒级渲染`
   - ❌ `修复 L3-HARDCODE 门禁报错，将中文提取至 zh-CN.ts 字典`
   - ✅ `完善状态栏与仪表板界面的多语言本地化翻译，中英文切换更加自然`
2. **六大标准语义分组**：`Added`（新特性）、`Changed`（交互或性能优化）、`Deprecated`（弃用预告）、`Removed`（移除旧特性）、`Fixed`（用户可见缺陷修复）、`Security`（本地落盘防丢与权限加固）。
