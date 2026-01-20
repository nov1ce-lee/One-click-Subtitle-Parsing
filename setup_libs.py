import os
import shutil
import glob
import sys
import subprocess

# 源目录：虚拟环境中的 nvidia 包
VENV_LIB = os.path.join(os.getcwd(), '.venv', 'Lib', 'site-packages')
NVIDIA_DIR = os.path.join(VENV_LIB, 'nvidia')

# 目标目录（本地运行时动态生成，不提交到仓库）
DEST_DIR = os.path.join(os.getcwd(), 'asr-backend')

print(f"Searching for DLLs in {NVIDIA_DIR}...")

# 自动安装 CUDA 依赖（如果缺失）
def ensure_cuda_packages():
    try:
        import nvidia.cublas.lib
        import nvidia.cudnn.lib
        return
    except Exception:
        pass

    print("CUDA packages not found. Installing nvidia-cublas-cu12 and nvidia-cudnn-cu12...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "nvidia-cublas-cu12", "nvidia-cudnn-cu12"])

ensure_cuda_packages()

# 需要查找的子目录
subdirs = ['cublas', 'cudnn']

count = 0
for subdir in subdirs:
    bin_dir = os.path.join(NVIDIA_DIR, subdir, 'bin')
    if not os.path.exists(bin_dir):
        print(f"Warning: {bin_dir} does not exist")
        continue
        
    for dll in glob.glob(os.path.join(bin_dir, "*.dll")):
        shutil.copy(dll, DEST_DIR)
        print(f"Copied {os.path.basename(dll)}")
        count += 1

# 还要复制 zlibwapi.dll (如果存在)，这是 cuDNN 经常缺少的依赖
zlib_path = os.path.join(VENV_LIB, 'nvidia', 'cudnn', 'bin', 'zlibwapi.dll')
if os.path.exists(zlib_path):
    shutil.copy(zlib_path, DEST_DIR)
    print(f"Copied zlibwapi.dll")

print(f"Done. Copied {count} DLLs to {DEST_DIR}")
