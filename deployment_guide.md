# 软件部署与迁移指南

## 方案一：一键源码迁移 (推荐用于开发或调试)

这是最简单的方式，适合在另一台安装了 Python 和 Node.js 的电脑上快速运行。

### 前置要求
1.  **Python 3.11+**: [下载安装](https://www.python.org/downloads/) (安装时请勾选 "Add Python to PATH")
2.  **Node.js (LTS)**: [下载安装](https://nodejs.org/)
3.  **NVIDIA 显卡驱动**: 如需 GPU 加速，请确保安装最新驱动。

### 操作步骤
1.  **复制项目**: 将整个项目文件夹复制到新电脑。
2.  **双击运行**: 在项目根目录下找到 `setup_and_run.bat`，**双击运行**。

该脚本会自动执行以下操作：
- 创建 Python 虚拟环境 (`.venv`)
- 安装 Python 依赖 (`requirements.txt`)
- 自动复制 CUDA 相关的 DLL 文件 (`setup_libs.py`)
- 安装 Node.js 依赖 (`npm install`)
- 启动软件

如果脚本运行成功，软件界面将会自动打开。

---

## 方案二：打包为独立安装包 (推荐用于分发)

如果你希望生成一个 `.exe` 安装包发给没有安装 Python/Node.js 的用户，请按照以下步骤操作。

### 1. 打包 Python 后端
首先使用 PyInstaller 将 Python 代码打包为独立可执行文件。

```bash
# 1. 激活虚拟环境
.venv\Scripts\activate

# 2. 安装 PyInstaller
pip install pyinstaller

# 3. 进入后端目录
cd asr-backend

# 4. 执行打包 (注意：确保 bin 目录存在且包含 ffmpeg.exe)
pyinstaller --noconfirm --onedir --console --name "engine" --add-data "bin;bin" --add-data "models_manager.py;." transcribe.py
```

打包完成后，会在 `asr-backend/dist/engine` 生成一个包含 `engine.exe` 的文件夹。

### 2. 修改 Electron 配置
我们需要告诉 Electron 在打包后使用这个 `engine.exe`，而不是源代码。

**修改 `electron/main.js`**:
找到定义 `pythonPath` 和 `scriptPath` 的地方，修改为：

```javascript
const isDev = !app.isPackaged;
let pythonPath, scriptPath;

if (isDev) {
  // 开发模式：使用 venv 和源码
  pythonPath = path.join(__dirname, '../.venv/Scripts/python.exe');
  scriptPath = path.join(__dirname, '../asr-backend/transcribe.py');
} else {
  // 打包模式：使用打包后的 engine.exe
  // 注意：在打包模式下，engine.exe 就是 "pythonPath"，参数就是 "scriptPath" (这里 scriptPath 可以为空或作为第一个参数)
  // PyInstaller 打包后的 exe 可以直接运行，不需要再指定 script.py
  // 所以我们需要调整 spawn 的调用逻辑。
  
  // 简化方案：将 engine.exe 视为 python解释器+脚本的合体
  pythonPath = path.join(process.resourcesPath, 'engine/engine.exe');
  scriptPath = null; 
}

// 在 spawn 调用处 (main.js 中有多处 spawn):
// const args = scriptPath ? [scriptPath, ...] : [...];
// spawn(pythonPath, args, ...);
```

### 3. 配置 Electron Builder
在 `electron/package.json` 中添加构建配置：

```json
{
  "scripts": {
    "build": "electron-builder"
  },
  "build": {
    "appId": "com.autosub.app",
    "productName": "AutoSub Tool",
    "directories": {
      "output": "dist"
    },
    "win": {
      "target": "nsis"
    },
    "extraResources": [
      {
        "from": "../asr-backend/dist/engine",
        "to": "engine"
      }
    ]
  }
}
```

### 4. 执行构建
```bash
cd electron
npm run build
```

生成的安装包将位于 `electron/dist` 目录下。用户安装后无需配置 Python 环境即可使用。
