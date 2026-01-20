import os
import shutil
import glob
import sys

# 目标目录：asr-backend
DEST_DIR = os.path.join(os.getcwd(), 'asr-backend')
if not os.path.exists(DEST_DIR):
    os.makedirs(DEST_DIR)

print(f"Copying NVIDIA DLLs to {DEST_DIR}...")

try:
    import nvidia.cublas.lib
    import nvidia.cudnn.lib
    
    cublas_dir = os.path.dirname(nvidia.cublas.lib.__file__)
    cudnn_dir = os.path.dirname(nvidia.cudnn.lib.__file__)
    
    # 需要复制的 DLL 模式
    patterns = [
        os.path.join(cublas_dir, "*.dll"),
        os.path.join(cudnn_dir, "*.dll")
    ]
    
    count = 0
    for pattern in patterns:
        for dll_path in glob.glob(pattern):
            shutil.copy(dll_path, DEST_DIR)
            print(f"Copied {os.path.basename(dll_path)}")
            count += 1
            
    print(f"Successfully copied {count} DLLs.")
    
except ImportError:
    print("Error: nvidia-cublas-cu12 or nvidia-cudnn-cu12 not installed.")
except Exception as e:
    print(f"Error copying files: {e}")
