import os
import zipfile
import urllib.request
import shutil

# FFmpeg Windows 64-bit 静态构建版下载地址 (Gyan.dev 是官方推荐源之一)
# 为了速度和稳定性，我们这里使用 github release 或者其他可靠源
# 这里使用 github 上比较稳定的发布版，或者直接用 gyan.dev 的 release essential
FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
DOWNLOAD_PATH = "ffmpeg.zip"
EXTRACT_DIR = "ffmpeg_temp"
TARGET_DIR = os.path.join("asr-backend", "bin")

def download_and_extract():
    print(f"Downloading FFmpeg from {FFMPEG_URL}...")
    # 使用 urllib 下载
    try:
        # 增加 headers 避免被某些防火墙拦截
        req = urllib.request.Request(FFMPEG_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response, open(DOWNLOAD_PATH, 'wb') as out_file:
            shutil.copyfileobj(response, out_file)
        print("Download complete.")
    except Exception as e:
        print(f"Download failed: {e}")
        return

    print("Extracting...")
    with zipfile.ZipFile(DOWNLOAD_PATH, 'r') as zip_ref:
        zip_ref.extractall(EXTRACT_DIR)

    # 寻找 ffmpeg.exe
    ffmpeg_exe = None
    ffprobe_exe = None
    
    for root, dirs, files in os.walk(EXTRACT_DIR):
        if "ffmpeg.exe" in files:
            ffmpeg_exe = os.path.join(root, "ffmpeg.exe")
        if "ffprobe.exe" in files:
            ffprobe_exe = os.path.join(root, "ffprobe.exe")

    if ffmpeg_exe and ffprobe_exe:
        os.makedirs(TARGET_DIR, exist_ok=True)
        shutil.move(ffmpeg_exe, os.path.join(TARGET_DIR, "ffmpeg.exe"))
        shutil.move(ffprobe_exe, os.path.join(TARGET_DIR, "ffprobe.exe"))
        print(f"FFmpeg installed to {TARGET_DIR}")
    else:
        print("Could not find ffmpeg.exe in the downloaded archive.")

    # 清理
    print("Cleaning up...")
    if os.path.exists(DOWNLOAD_PATH):
        os.remove(DOWNLOAD_PATH)
    if os.path.exists(EXTRACT_DIR):
        shutil.rmtree(EXTRACT_DIR)

if __name__ == "__main__":
    download_and_extract()
