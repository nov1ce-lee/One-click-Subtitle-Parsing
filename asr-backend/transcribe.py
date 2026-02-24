import sys
import os
import argparse
import json
import traceback
import time
import shutil
import warnings
import ffmpeg
from faster_whisper import WhisperModel
import models_manager
import opencc

# Suppress HuggingFace Hub warnings about symlinks
warnings.filterwarnings("ignore", message="The `local_dir_use_symlinks` argument is deprecated")

# Configure stdout to use utf-8 explicitly to avoid encoding errors on Windows
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# --- Logging Helper ---
def log_info(message):
    """Print log messages to stderr to keep stdout clean for JSON IPC"""
    sys.stderr.write(f"INFO: {message}\n")
    sys.stderr.flush()

def log_error(message):
    """Print error messages to stderr"""
    sys.stderr.write(f"ERROR: {message}\n")
    sys.stderr.flush()

def ipc_send(data_type, payload):
    """Send structured data to stdout as JSON"""
    message = {
        "type": data_type,
        "payload": payload
    }
    print(json.dumps(message, ensure_ascii=False), flush=True)

# Add local bin to PATH (for ffmpeg if downloaded locally)
current_dir = os.path.dirname(os.path.abspath(__file__))
bin_dir = os.path.join(current_dir, 'bin')
if os.path.exists(bin_dir):
    os.environ["PATH"] = bin_dir + os.pathsep + os.environ["PATH"]

# 强制设置 HF 镜像
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

# --- CRITICAL: Force load NVIDIA DLLs ---
# CTranslate2 often fails to find DLLs on Windows even if they are in PATH.
# We manually load them using ctypes to ensure they are in the process memory.
import ctypes
try:
    # Load cublas
    ctypes.CDLL(os.path.join(current_dir, "cublas64_12.dll"))
    ctypes.CDLL(os.path.join(current_dir, "cublasLt64_12.dll"))
    
    # Load cudnn (order matters sometimes)
    ctypes.CDLL(os.path.join(current_dir, "cudnn64_9.dll"))
    ctypes.CDLL(os.path.join(current_dir, "cudnn_ops64_9.dll"))
    ctypes.CDLL(os.path.join(current_dir, "cudnn_cnn64_9.dll"))
    ctypes.CDLL(os.path.join(current_dir, "cudnn_adv64_9.dll"))
    
    log_info("Successfully pre-loaded NVIDIA DLLs")
except Exception as e:
    # It's okay if this fails, maybe they are already loaded or not found
    # We just print a warning but don't stop
    log_info(f"Warning: Could not pre-load NVIDIA DLLs: {e}")

# Try to add NVIDIA libs to PATH if they exist in site-packages
# This is a hack because CTranslate2 expects DLLs in PATH
def add_nvidia_libs_to_path():
    # Add current dir to PATH as well, since we copied DLLs there
    os.environ["PATH"] = current_dir + os.pathsep + os.environ["PATH"]
    
    try:
        import nvidia.cublas.lib
        import nvidia.cudnn.lib
        
        cublas_dir = os.path.dirname(nvidia.cublas.lib.__file__)
        cudnn_dir = os.path.dirname(nvidia.cudnn.lib.__file__)
        
        os.environ["PATH"] = cublas_dir + os.pathsep + os.environ["PATH"]
        os.environ["PATH"] = cudnn_dir + os.pathsep + os.environ["PATH"]
    except ImportError:
        pass

add_nvidia_libs_to_path()

# Debug: Print arguments and CWD to stderr to avoid polluting stdout (which breaks JSON parsing)
log_info(f"argv={sys.argv}")
log_info(f"cwd={os.getcwd()}")

def get_media_duration(file_path):
    try:
        probe = ffmpeg.probe(file_path)
        format_info = probe.get('format', {})
        duration = float(format_info.get('duration', 0))
        return duration
    except Exception as e:
        # 如果获取失败，就不显示进度百分比了
        return None

def main():
    parser = argparse.ArgumentParser(description="Local Subtitle ASR Tool CLI")
    
    # 模式选择
    parser.add_argument("--list-models", action="store_true", help="List available models")
    parser.add_argument("--download-model", action="store_true", help="Download a specific model")
    
    # 识别参数
    parser.add_argument("--input", type=str, help="Input video/audio file path")
    parser.add_argument("--model-id", type=str, default="tiny", help="Model ID to use")
    parser.add_argument("--language", type=str, default="auto", help="Language code (e.g. zh, en) or auto")
    parser.add_argument("--device", type=str, default="cpu", choices=["cpu", "cuda", "auto"], help="Device to use (cpu, cuda, auto)")
    parser.add_argument("--output-format", type=str, default="json", choices=["json"], help="Output format")
    
    # 解析参数
    args = parser.parse_args()
    
    # 1. 列出模型
    if args.list_models:
        models = models_manager.list_models()
        print(json.dumps({"models": models, "model_dir": models_manager.MODELS_DIR}, ensure_ascii=False))
        return

    # 2. 下载模型
    if args.download_model:
        if not args.model_id:
            print(json.dumps({"error": "Model ID is required for download"}, ensure_ascii=False))
            sys.exit(1)
        try:
            # Force TQDM to show progress even if not TTY
            os.environ["TQDM_DISABLE"] = "0"
            models_manager.download_model_by_id(args.model_id)
            # Use IPC format for download success
            # But wait, main.js expects specific stdout for download?
            # Actually, main.js for download currently parses stdout line by line looking for PROGRESS
            # We should probably keep it simple for now or standardize.
            # Let's standardize to stderr for logs and stdout for result.
            print(json.dumps({"success": True, "message": f"Model {args.model_id} downloaded"}, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
            sys.exit(1)
        return

    # 3. 执行识别
    if not args.input:
        print(json.dumps({"error": "Input file is required"}, ensure_ascii=False))
        sys.exit(1)

    # 调试打印：确认接收到的路径
    log_info(f"Input path received: {repr(args.input)}")

    if not os.path.exists(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}, ensure_ascii=False))
        sys.exit(1)

    # 检查模型是否就绪
    model_path = models_manager.get_model_path(args.model_id)
    if not model_path:
        # 尝试自动下载
        log_info(f"Model not found locally, downloading {args.model_id}...")
        # Send progress event to UI
        ipc_send("progress", {"stage": "downloading_model", "model": args.model_id})
        try:
            model_path = models_manager.download_model_by_id(args.model_id)
        except Exception as e:
            print(json.dumps({"error": f"Failed to download model: {str(e)}"}, ensure_ascii=False))
            sys.exit(1)

    # 获取时长用于进度计算
    duration = get_media_duration(args.input)
    if duration:
        log_info(f"Media duration: {duration:.2f}s")

    # 加载模型
    log_info("Loading model...")
    ipc_send("progress", {"stage": "loading_model"})
    
    try:
        # DEBUG: Print model loading params
        log_info(f"Loading WhisperModel from {model_path}")
        
        try:
            # 尝试使用用户指定的设备
            requested_device = args.device
            log_info(f"Requested device={requested_device}")

            if requested_device == "cuda":
                # 用户强制请求 CUDA
                try:
                    # 尝试加载，如果失败则捕获详细信息
                    log_info("Attempting to load model on CUDA...")
                    model = WhisperModel(model_path, device="cuda", compute_type="int8")
                except Exception as e:
                    error_str = str(e)
                    log_info(f"CUDA load failed: {error_str}")
                    
                    if "cublas" in error_str.lower() or "cudnn" in error_str.lower():
                         log_info("Missing CUDA/cuDNN libraries. Please install cuDNN 8.x for CUDA 11/12.")
                    
                    log_info("Falling back to CPU...")
                    model = WhisperModel(model_path, device="cpu", compute_type="int8")
            elif requested_device == "auto":
                 # 自动尝试
                 try:
                    model = WhisperModel(model_path, device="auto", compute_type="int8")
                 except Exception as e:
                    log_info(f"Auto device failed ({e}), falling back to CPU")
                    model = WhisperModel(model_path, device="cpu", compute_type="int8")
            else:
                 # 默认 CPU
                 model = WhisperModel(model_path, device="cpu", compute_type="int8")
             
        except Exception as e_cpu:
             log_info(f"'cpu' device failed ({e_cpu}), trying auto")
             model = WhisperModel(model_path, device="auto", compute_type="int8")
             
        log_info("Model loaded successfully")
    except Exception as e:
        print(json.dumps({"error": f"Failed to load model: {str(e)}"}, ensure_ascii=False))
        sys.exit(1)

    log_info("Starting transcription...")
    ipc_send("progress", {"stage": "transcribing"})
    
    # Use initial_prompt to guide the model to output Simplified Chinese
    initial_prompt = None
    if args.language in ["auto", "zh"]:
        initial_prompt = "简体中文"

    # Pre-convert audio to 16kHz mono wav
    import tempfile
    
    temp_wav = None
    transcribe_input = args.input
    
    log_info("Pre-processing audio to 16kHz mono wav...")

    safe_input_path = args.input
    temp_input_copy = None
    last_error = None
    needs_copy = False
    try:
        args.input.encode("ascii")
    except Exception:
        needs_copy = True

    def run_extract(source_path, output_path, map_selector):
        output_kwargs = {"ar": 16000, "ac": 1, "vn": None}
        if map_selector:
            output_kwargs["map"] = map_selector
        (
            ffmpeg
            .input(source_path)
            .output(output_path, **output_kwargs)
            .overwrite_output()
            .run(cmd=ffmpeg_exe, quiet=True, capture_stdout=True, capture_stderr=True)
        )

    ffmpeg_exe = "ffmpeg"
    ffprobe_exe = "ffprobe"
    if os.path.exists(os.path.join(bin_dir, "ffmpeg.exe")):
        ffmpeg_exe = os.path.join(bin_dir, "ffmpeg.exe")
    if os.path.exists(os.path.join(bin_dir, "ffprobe.exe")):
        ffprobe_exe = os.path.join(bin_dir, "ffprobe.exe")

    def get_audio_streams(source_path):
        nonlocal last_error
        try:
            probe_info = ffmpeg.probe(source_path, cmd=ffprobe_exe)
            return [s.get("index") for s in probe_info.get("streams", []) if s.get("codec_type") == "audio"]
        except ffmpeg.Error as e:
            last_error = e.stderr.decode("utf8", errors="ignore") if e.stderr else str(e)
            return []
        except Exception as e:
            last_error = str(e)
            return []

    def try_extract(source_path, map_selector):
        nonlocal last_error
        temp_wav_local = None
        try:
            fd, temp_wav_local = tempfile.mkstemp(suffix=".wav")
            os.close(fd)
            run_extract(source_path, temp_wav_local, map_selector)
            if not os.path.exists(temp_wav_local) or os.path.getsize(temp_wav_local) == 0:
                os.remove(temp_wav_local)
                return None
            return temp_wav_local
        except ffmpeg.Error as e:
            if temp_wav_local and os.path.exists(temp_wav_local):
                try:
                    os.remove(temp_wav_local)
                except Exception:
                    pass
            last_error = e.stderr.decode("utf8", errors="ignore") if e.stderr else str(e)
        except Exception as e:
            if temp_wav_local and os.path.exists(temp_wav_local):
                try:
                    os.remove(temp_wav_local)
                except Exception:
                    pass
            last_error = str(e)
        return None

    def try_all(source_path):
        nonlocal last_error
        temp_wav_local = try_extract(source_path, None)
        if temp_wav_local:
            return temp_wav_local
        temp_wav_local = try_extract(source_path, "0:a?")
        if temp_wav_local:
            return temp_wav_local
        audio_streams = get_audio_streams(source_path)
        if not audio_streams:
            last_error = last_error or "No audio streams detected by ffprobe"
            return None
        for stream_index in audio_streams:
            temp_wav_local = try_extract(source_path, f"0:{stream_index}")
            if temp_wav_local:
                return temp_wav_local
        return None

    if needs_copy:
        try:
            fd_in, temp_input_copy = tempfile.mkstemp(suffix=os.path.splitext(args.input)[1] or ".tmp")
            os.close(fd_in)
            import shutil
            shutil.copy2(args.input, temp_input_copy)
            safe_input_path = temp_input_copy
        except Exception as e:
            last_error = str(e)

    temp_wav = try_all(safe_input_path)
    if not temp_wav:
        if not temp_input_copy:
            try:
                fd_in, temp_input_copy = tempfile.mkstemp(suffix=os.path.splitext(args.input)[1] or ".tmp")
                os.close(fd_in)
                import shutil
                shutil.copy2(args.input, temp_input_copy)
                safe_input_path = temp_input_copy
                temp_wav = try_all(safe_input_path)
            except Exception as e:
                last_error = str(e)

    if not temp_wav:
        log_info(f"Audio extraction failed, fallback to original input. Reason: {last_error or 'Unknown error'}")
        transcribe_input = safe_input_path
    else:
        transcribe_input = temp_wav
        log_info(f"Audio converted to {temp_wav} (Size: {os.path.getsize(temp_wav)} bytes)")


    try:
        segments_generator, info = model.transcribe(
            transcribe_input, 
            language=None if args.language == "auto" else args.language,
            beam_size=5,
            best_of=5,
            vad_filter=False, 
            temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0], 
            condition_on_previous_text=False, 
            initial_prompt=initial_prompt
        )
        
        detected_lang = info.language
        cc = None
        if detected_lang == "zh":
             try:
                 cc = opencc.OpenCC('t2s')
             except Exception as e:
                 log_info(f"OpenCC init failed: {e}")

        # 实时收集结果
        segments_result = []
        
        for segment in segments_generator:
            # 发送进度
            progress = 0.0
            if duration and duration > 0:
                progress = min(segment.end / duration, 1.0)
            
            text = segment.text
            if cc:
                text = cc.convert(text)

            seg_data = {
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": text
            }
            segments_result.append(seg_data)
            
            # Send structured segment update
            ipc_send("segment", {
                "segment": seg_data,
                "progress": progress
            })

        # 最终输出完整结果
        final_output = {
            "segments": segments_result,
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
            "model_id": args.model_id
        }
        
        # Send final result (not wrapped in "payload" to keep backward compat or just use a type?)
        # Let's use the new IPC format for everything.
        ipc_send("complete", final_output)
        
    except Exception as e:
        print(json.dumps({"error": f"Transcription failed: {str(e)}"}, ensure_ascii=False))
        sys.exit(1)
    finally:
        if temp_wav and os.path.exists(temp_wav):
            try:
                os.remove(temp_wav)
            except:
                pass
        if temp_input_copy and os.path.exists(temp_input_copy):
            try:
                os.remove(temp_input_copy)
            except:
                pass

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        # Handle cancellation gracefully
        log_info("Task cancelled by user.")
        sys.exit(0)
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": f"Unhandled exception: {str(e)}"}, ensure_ascii=False))
        sys.exit(1)
