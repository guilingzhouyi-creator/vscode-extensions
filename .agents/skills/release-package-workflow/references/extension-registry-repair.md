# VS Code 扩展本地注册表自愈与热同步原理解析

## 一、 为什么需要注册表自愈？

VS Code 与 Cursor 在本地用户目录维护扩展状态：
- 扩展物理存储路径：`~/.vscode/extensions/<publisher>.<extension-name>-<version>/`
- 注册表文件：`~/.vscode/extensions/extensions.json`

在频繁的本地开发与测试过程中，若手动删除或覆盖扩展目录，`extensions.json` 中仍可能保留着指向已删除物理目录的旧指针（Ghost Entries）。这会导致以下典型异常：
1. 宿主编辑器认为扩展已安装但无法加载；
2. 状态栏或快捷命令不显示；
3. VS Code 报扩展清单解析错误（Manifest load error）。

---

## 二、 自愈算法工作机制 (`Repair-ExtensionRegistry`)

在 `package.ps1` 与 `package.sh` 的 `-HotSync` 流程中，内置了自动扫描清洗机制：

1. **扫描目录**：遍历当前用户下的 `.vscode/extensions` 与 `.cursor/extensions`；
2. **加载注册表**：读取并解析 `extensions.json` 文件（使用无 BOM UTF-8 编码）；
3. **有效性判定**：
   ```powershell
   $valid = @($entries | Where-Object {
       if ($_.identifier.id -eq $FullExtId) {
           $targetDir = Join-Path $ideDir $_.relativeLocation
           return (Test-Path $targetDir)
       }
       return $true
   })
   ```
4. **原子写回**：当检测到失效条目时，剔除幽灵条目并将干净的 JSON 紧凑写回文件；
5. **覆盖式装载**：随后将本次编译的最优产物以标准目录结构复制到位，实现无缝热加载。
