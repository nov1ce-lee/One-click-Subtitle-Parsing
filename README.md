# 本地字幕生成器

基于 Electron + faster-whisper 的本地视频/音频字幕生成工具。

## 目录结构
- electron: 前端与桌面壳
- asr-backend: 转写引擎与模型管理
- asr-backend/models: 本地模型下载目录
- asr-backend/bin: FFmpeg 可执行文件目录

## 快速开始（Windows）

### 1. 准备环境
- Python 3.11+
- Node.js（建议 LTS）
- NVIDIA 显卡驱动（仅 GPU 加速需要）
- CUDA 12.x 与 cuDNN（仅 GPU 加速需要）

### 2. 安装 Python 依赖

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r asr-backend\requirements.txt
```

### 3. 安装 FFmpeg

如果系统已配置 ffmpeg 到 PATH，可跳过此步。

```bash
python download_ffmpeg.py
```

### 4. CUDA/GPU 加速（可选）

使用 GPU 时执行以下步骤：

1. 安装 CUDA 12.x 与 cuDNN（需与显卡驱动匹配）
2. 安装 Python 依赖时确保包含 nvidia-cublas-cu12 与 nvidia-cudnn-cu12
3. 复制 DLL 到 asr-backend 目录（仓库不提交这些 DLL）

```bash
python setup_libs.py
```

### 5. 安装与启动前端

```bash
cd electron
npm install
npm start
```

## 模型说明
- 模型会自动下载到 asr-backend/models
- 旧机器上已有模型可直接复制到该目录

## 常见问题

### 下载模型速度慢
程序默认使用 hf-mirror 镜像，如果需要更换，可设置环境变量 HF_ENDPOINT。

### MP4 无法识别音轨
确保视频包含音频流，或尝试先导出音频后再转写。

## 打包与部署
打包与迁移说明请参考 deployment_guide.md。
