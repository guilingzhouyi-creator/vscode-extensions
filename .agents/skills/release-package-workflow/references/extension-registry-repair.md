# VS Code 扩展本地注册表自愈与热同步原理解析

本指南阐述了本地开发阶段 VS Code 与 Cursor 扩展注册表的结构特征、幽灵条目（Ghost Entries）成因及 `-HotSync` 内置自愈算法的工作机制。

---

## 一、 为什么需要注册表自愈？

VS Code 与 Cursor 在用户本地目录维护扩展生命周期与状态：
- **扩展物理存储路径**：`$env:USERPROFILE\.vscode\extensions\<publisher>.<extension-name>-<version>/`
- **扩展元数据注册表**：`$env:USERPROFILE\.vscode\extensions\extensions.json`

在频繁的本地编译调试、版本演进或物理删除旧版扩展目录时，宿主编辑器的 `extensions.json` 往往无法即时同步，极易残留指向已失效物理目录的孤儿引用指针（Ghost Entries）。

### 幽灵条目引发的典型故障：
1. **加载静默失败**：宿主编辑器在 UI 上显示扩展已安装，但实际上功能未激活；
2. **命令与视图丢失**：快捷命令（Command Palette）或侧边栏自定义视图无法呈现；
3. **清单解析报错**：编辑器在启动或重新加载窗口时报告扩展清单解析错误（Manifest load error）。

---

## 二、 自愈算法工作机制 (`Repair-ExtensionRegistry`)

在 `package.ps1` 与 `package.sh` 的 `-HotSync` 执行链路中，注册表自愈算法在产物覆盖前自动运行：

### 1. 扫描与探测
算法遍历开发机上的宿主扩展根目录：
- VS Code：`$env:USERPROFILE\.vscode\extensions`
- Cursor：`$env:USERPROFILE\.cursor\extensions`

### 2. 流式解析注册表
读取并解析 `extensions.json` 文件（强制采用无 BOM UTF-8 编码，防止编码漂移）。

### 3. 有效性探测与孤儿过滤
对注册表内登记的目标扩展条目，检验其相对物理路径是否依然存在：
```powershell
$valid = @($entries | Where-Object {
  if ($_.identifier.id -eq $FullExtId) {
    $targetDir = Join-Path $ideDir $_.relativeLocation
    return (Test-Path $targetDir)
  }
  return $true
})
```

### 4. 紧凑原子写回
若检测到失效的幽灵条目，将其从数组中剥离，并将清洗后的干净数据以紧凑格式原子写回 `extensions.json` 文件。

### 5. 覆盖式热同步装载
清洗完成后，脚本将本次编译生成的最新构建产物与清单直接复制至宿主扩展目录，使 VS Code 与 Cursor 重载窗口后能够立即无缝识别并激活最新扩展。
