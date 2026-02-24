# 项目分析与优化方案

## 1. 项目概述
本项目是一个基于 **Electron** + **Faster-Whisper** 的本地视频/音频字幕生成工具。
- **前端**: Electron (Node.js + HTML/CSS/JS)，负责 UI 交互、文件选择、进度展示和字幕编辑。
- **后端**: Python (faster-whisper + ffmpeg-python)，负责核心的语音转写功能。
- **交互**: 通过 `child_process.spawn` 启动 Python 脚本，使用标准输入输出 (stdio) 进行 IPC 通信。

## 2. 现有代码分析

### 优点
- **本地化**: 完全离线运行，保护隐私。
- **易用性**: 实现了模型自动下载 (使用 hf-mirror 镜像)，降低了用户门槛。
- **兼容性**: 针对 Windows 环境下的 CUDA DLL 缺失问题做了专门的处理 (`setup_libs.py`, `ctypes` 加载)。
- **功能**: 支持实时预览、进度显示、SRT 导出和基础编辑。

### 待优化项 (Issues & Improvements)

#### A. 架构与代码质量
1.  **通信协议脆弱**: 
    - `main.js` 中解析 Python 输出的方式依赖于字符串分割和 JSON 查找 (`lines[i].startsWith('{')`)。如果 Python 的日志 (如 `tqdm` 进度条或警告) 混入 stdout，容易导致 JSON 解析失败。
    - **建议**: Python端应严格分离日志和数据。使用 `stderr` 打印日志/进度，仅使用 `stdout` 打印结构化的 JSON 数据 (IPC)。或者封装一个简单的协议，如 `[TYPE] PAYLOAD`。
2.  **渲染进程逻辑混杂**:
    - `renderer.js` 包含大量 DOM 操作和业务逻辑，难以维护。
    - **建议**: 虽然不需要引入 React/Vue 等重型框架，但可以将 UI 操作和数据逻辑分离。
3.  **Python 脚本单体化**:
    - `transcribe.py` 承载了太多职责 (参数解析、音频预处理、模型加载、转写、输出格式化)。
    - **建议**: 抽取音频处理逻辑到单独模块。

#### B. 功能与体验
1.  **“保存原始内容”逻辑缺陷**:
    - `renderer.js` 中的 `saveOriginalBtn` 事件监听器中注释提到，目前没有正确保存原始转写结果的副本。如果用户修改了编辑器内容，"Save Original" 可能会保存修改后的版本或报错。
    - **修复**: 在 `onComplete` 时对 `result.segments` 进行深拷贝存储。
2.  **缺乏批量处理**:
    - 目前一次只能处理一个文件。
    - **建议**: 支持多文件拖拽，建立任务队列。
3.  **VAD (语音活动检测) 策略**:
    - 目前 `vad_filter=False` 被硬编码以防止漏字，但可能导致静音片段产生幻觉 (Hallucination)。
    - **建议**: 在 UI 暴露 VAD 开关或灵敏度设置，或者优化 Prompt 策略。

#### C. 工程化与部署
1.  **依赖管理**:
    - `requirements.txt` 可能包含冗余依赖。
    - 缺少自动化打包脚本 (虽然有 `deployment_guide.md`)。

## 3. 建议修改计划 (Roadmap)

### 第一阶段：核心稳定性优化 (本次重点)
1.  **重构 IPC 通信**: 
    - Python 端：重定向所有 `print` (非数据) 到 `stderr`，确保 `stdout` 只有干净的 JSON。
    - Electron 端：优化 `stdout` 解析逻辑，不再需要复杂的字符串查找。
2.  **修复 Bug**:
    - 修复 `renderer.js` 中 "Save Original" 的深拷贝问题。
    - 修复 `transcribe.py` 中可能的编码问题 (已存在 `sys.stdout.reconfigure`，但需确保所有第三方库不乱打 log)。
3.  **代码清理**:
    - 移除 `transcribe.py` 中冗余的调试打印，统一使用 logging 模块 (输出到 stderr)。

### 第二阶段：功能增强 (可选)
1.  **UI 优化**: 增加设置面板 (VAD 开关、Prompt 设置、导出格式选择)。
2.  **批量处理**: 允许用户一次性添加多个视频。

---

**请确认是否同意进行"第一阶段"的优化？**
如果同意，我将开始：
1. 修改 `asr-backend/transcribe.py` 的日志输出机制。
2. 修改 `electron/main.js` 的解析逻辑。
3. 修复 `electron/renderer.js` 的数据存储逻辑。
