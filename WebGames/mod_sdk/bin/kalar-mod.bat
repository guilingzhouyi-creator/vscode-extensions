@echo off
rem ==============================================================================
rem 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · Launcher)
rem 文件路径: WebGames/mod_sdk/bin/kalar-mod.bat
rem 架构定位: Windows 平台 MOD SDK 统一门面一键调用脚本
rem 依赖与触发: 触发方: CLI / 用户 | 上游: tools/kalar_mod.py | 运行时: Python 3.10+
rem 职责说明: 跨平台一键调用 tools/kalar_mod.py CLI 统一门面
rem 退出语义与设计依据: 透传 Python 执行退出码 | 设计依据: 《卡拉尔数据契约规范 v1.0》
rem ------------------------------------------------------------------------------
rem 用法示例:
rem   bin\kalar-mod.bat --version
rem   bin\kalar-mod.bat check ..\templates\starter_story
rem ==============================================================================
setlocal
set "SCRIPT_DIR=%~dp0"
set "TOOLS_PY=%SCRIPT_DIR%..\tools\kalar_mod.py"

python "%TOOLS_PY%" %*
exit /b %ERRORLEVEL%
