import os
import time
import socket
import shutil
import sys
# 强制设置 HF 镜像，确保在任何网络环境下都能走国内源
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "0"

# 增加默认超时时间，应对网络波动
socket.setdefaulttimeout(120)

import json
from faster_whisper import download_model

# 定义应用数据目录
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(CURRENT_DIR, 'models')
LEGACY_MODELS_DIR = os.path.join(os.getenv('APPDATA') or '', 'local-subtitle-tool', 'models')

# 确保目录存在
os.makedirs(MODELS_DIR, exist_ok=True)

def migrate_legacy_models():
    if not LEGACY_MODELS_DIR or not os.path.exists(LEGACY_MODELS_DIR):
        return
    try:
        for name in os.listdir(LEGACY_MODELS_DIR):
            src = os.path.join(LEGACY_MODELS_DIR, name)
            dst = os.path.join(MODELS_DIR, name)
            if os.path.exists(dst):
                continue
            shutil.move(src, dst)
        if os.path.isdir(LEGACY_MODELS_DIR) and not os.listdir(LEGACY_MODELS_DIR):
            os.rmdir(LEGACY_MODELS_DIR)
    except Exception:
        pass

migrate_legacy_models()

# 定义可用模型列表
# 注意：size_mb 只是估计值，用于 UI 显示
AVAILABLE_MODELS = [
    {
        "id": "tiny",
        "name": "Tiny (Multilingual)",
        "size_mb": 75,
        "languages": "multilingual"
    },
    {
        "id": "base",
        "name": "Base (Multilingual)",
        "size_mb": 145,
        "languages": "multilingual"
    },
    {
        "id": "small",
        "name": "Small (Multilingual)",
        "size_mb": 484,
        "languages": "multilingual"
    },
    {
        "id": "medium",
        "name": "Medium (Multilingual)",
        "size_mb": 1500,
        "languages": "multilingual"
    },
    {
        "id": "distil-large-v3",
        "name": "Distil Large V3 (Multilingual, zh optimized)",
        "size_mb": 1000,
        "languages": "multilingual"
    },
    {
        "id": "large-v3-turbo",
        "name": "Large V3 Turbo (Multilingual, zh optimized)",
        "size_mb": 1500,
        "languages": "multilingual"
    },
    {
        "id": "large-v3",
        "name": "Large V3 (Multilingual)",
        "size_mb": 3100,
        "languages": "multilingual"
    }
]

def get_model_path(model_id):
    """获取模型的本地路径，如果不存在则返回 None"""
    # faster-whisper 下载的模型通常在 models--systran--faster-whisper-xxx 目录下
    # 简单的检查方式：检查目录下是否有 config.json 和 model.bin
    
    model_dir = os.path.join(MODELS_DIR, model_id)
    if os.path.exists(model_dir):
        # 检查关键文件
        has_config = os.path.exists(os.path.join(model_dir, "config.json"))
        has_model = os.path.exists(os.path.join(model_dir, "model.bin"))
        
        # 只有当关键文件都存在时才认为已安装
        if has_config and has_model:
            return model_dir
            
    return None

def list_models():
    """返回模型列表，包含安装状态"""
    results = []
    for model in AVAILABLE_MODELS:
        m = model.copy()
        model_dir = os.path.join(MODELS_DIR, model['id'])
        path = get_model_path(model['id'])
        m['installed'] = path is not None
        m['path'] = path
        m['local_dir_exists'] = os.path.exists(model_dir)
        results.append(m)
    return results

def download_model_by_id(model_id, progress_callback=None):
    """
    下载指定模型
    progress_callback: function(current, total)
    """
    model_info = next((m for m in AVAILABLE_MODELS if m['id'] == model_id), None)
    if not model_info:
        raise ValueError(f"Model {model_id} not found")

    output_dir = os.path.join(MODELS_DIR, model_id)
    
    print(f"PROGRESS MODEL_DOWNLOAD_START {model_id}", file=sys.stderr, flush=True)
    
    # faster-whisper 的 download_model 没有直接的进度回调暴露给 Python 代码
    # (它底层用 huggingface_hub，会有 stderr 进度条)
    # 我们这里只能做简单的同步调用。
    # 如果需要精确进度，需要 hack huggingface_hub 或者自己实现下载逻辑。
    # 第一版为了简单，我们先直接调用，UI 上可能显示"下载中..."的无限进度条。
    
    # 为了让 UI 知道我们在做事，我们可以先打印一下
    # 注意：download_model 会下载到指定目录
    max_retries = 5
    for attempt in range(max_retries):
        try:
            print(f"PROGRESS INFO Debug: Starting download attempt {attempt + 1}/{max_retries}...", file=sys.stderr, flush=True)
            model_path = download_model(model_id, output_dir=output_dir)
            print(f"PROGRESS MODEL_DOWNLOAD_DONE {model_id}", file=sys.stderr, flush=True)
            return model_path
        except Exception as e:
            print(f"PROGRESS INFO Debug: Download attempt {attempt + 1} failed: {str(e)}", file=sys.stderr, flush=True)
            if attempt < max_retries - 1:
                wait_time = (attempt + 1) * 2
                print(f"PROGRESS INFO Debug: Retrying in {wait_time} seconds...", file=sys.stderr, flush=True)
                time.sleep(wait_time)
            else:
                print(f"PROGRESS MODEL_DOWNLOAD_ERROR {str(e)}", file=sys.stderr, flush=True)
                raise e
