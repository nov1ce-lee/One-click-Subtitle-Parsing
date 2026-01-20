# 软件部署与打包指南

## 1. 在新电脑上运行 (手动迁移)

如果你只是想把现在的开发环境迁移到另一台电脑，或者直接分发解压包，请遵循以下步骤：

### 前置要求
1. **安装 Python 3.11+**: 目标电脑必须安装 Python (建议 3.11.9)。
2. **NVIDIA 显卡驱动**: 如果使用 GPU 加速，确保安装了最新的 NVIDIA 驱动。
3. **CUDA Toolkit (可选)**: 理论上我们的脚本会自动加载本地 DLL，但如果遇到问题，建议安装 CUDA 12.x。

### 迁移步骤
1. **复制整个项目文件夹**: 将 `pj2` 文件夹复制到新电脑。
2. **初始化 Python 环境**:
   - 在新电脑上打开终端 (PowerShell 或 CMD)。
   - 进入项目目录。
   - 运行 `python -m venv .venv` 创建虚拟环境。
   - 激活环境: `.venv\Scripts\activate`
   - 安装依赖: `pip install -r requirements.txt` (如果没有 `requirements.txt`，请先在旧电脑运行 `pip freeze > requirements.txt` 生成)。
   - **关键依赖**: 确保安装了 `faster-whisper`, `ffmpeg-python`, `opencc`。
3. **安装 FFmpeg**:
   - 确保 `ffmpeg` 命令在系统 PATH 中，或者保留 `asr-backend/bin/ffmpeg.exe`。
4. **运行 DLL 修复脚本**:
   - 运行 `python setup_libs.py`。这一步非常重要，它会将必要的 CUDA 动态库复制到 `asr-backend` 目录，确保在没有安装完整 CUDA Toolkit 的电脑上也能运行。
5. **启动软件**:
   - 安装 Node.js 依赖: `npm install` (如果 `node_modules` 未复制)。
   - 启动: `npm start`。

---

## 2. 打包为独立安装包 (推荐)

为了方便分发给普通用户，可以使用 `electron-builder` 将软件打包成一个 `.exe` 安装包。

### 策略：轻量级打包 + 独立 Python

由于 Python 环境和模型文件很大，建议采用 **"Electron 前端打包 + 独立 Python 后端"** 的方式。

**打包内容**:
- Electron 界面 (UI)
- Python 解释器及依赖 (精简版)
- FFmpeg 可执行文件
- 必要的 DLL 文件

**不打包内容 (让用户联网下载)**:
- Whisper 模型文件 (Large 模型约 3GB，打包进去会导致安装包过大)。
- 我们的软件已经实现了 **"模型自动下载"** 功能，用户第一次使用某个模型时会自动下载。

### 配置步骤 (package.json)

在 `electron/package.json` 中添加 `build` 配置：

```json
{
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "build": {
    "appId": "com.example.autosub",
    "productName": "AI Subtitle Generator",
    "directories": {
      "output": "dist"
    },
    "win": {
      "target": "nsis",
      "icon": "icon.ico" // 如果有图标
    },
    "extraResources": [
      {
        "from": "../asr-backend",
        "to": "asr-backend",
        "filter": ["**/*", "!models/**"] // 排除 models 目录以减小体积
      },
      {
        "from": "../.venv/Scripts/python.exe", 
        "to": "python/python.exe"
      },
      // 注意：直接复制 venv 可能有路径问题，更推荐使用 PyInstaller 打包 Python 后端为单一 exe
    ]
  }
}
```

### 进阶：使用 PyInstaller 打包后端 (最佳实践)

为了避免用户安装 Python，最好将 Python 脚本打包成一个独立的 `.exe`。

1. **安装 PyInstaller**: `pip install pyinstaller`
2. **打包 Python 脚本**:
   ```bash
   cd asr-backend
   pyinstaller --noconfirm --onedir --console --name "engine" --add-data "bin;bin" transcribe.py
   ```
   这会在 `asr-backend/dist/engine` 生成可执行文件。
3. **修改 Electron 调用**:
   在 `main.js` 中，将 `pythonPath` 和 `scriptPath` 指向打包后的 `engine.exe`。
4. **Electron Builder 配置**:
   将 `asr-backend/dist/engine` 文件夹配置到 `extraResources` 中。

这样，用户只需要下载一个约 100-200MB 的安装包，安装后即可使用。模型文件会在需要时自动下载。
