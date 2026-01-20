const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess = null;

// 定义路径
const isDev = !app.isPackaged;
const pythonPath = isDev 
  ? path.join(__dirname, '../.venv/Scripts/python.exe') 
  : path.join(process.resourcesPath, 'python/python.exe'); // 假设打包后的路径

const scriptPath = isDev
  ? path.join(__dirname, '../asr-backend/transcribe.py')
  : path.join(process.resourcesPath, 'asr-backend/transcribe.py');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers ---

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'm4a'] }
    ]
  });
  return result.filePaths[0];
});

ipcMain.handle('show-item-in-folder', async (event, path) => {
  shell.showItemInFolder(path);
});

ipcMain.handle('get-models', async () => {
  return new Promise((resolve, reject) => {
    const process = spawn(pythonPath, [scriptPath, '--list-models']);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python exited with code ${code}: ${stderr}`));
      } else {
        try {
          // 尝试解析 JSON。由于 stdout 可能包含调试日志，我们需要提取最后一行有效的 JSON
          // 或者过滤掉非 JSON 行
          const lines = stdout.trim().split('\n');
          let jsonLine = '';
          // 从后往前找，找到第一个看起来像 JSON 的行
          for (let i = lines.length - 1; i >= 0; i--) {
             const line = lines[i].trim();
             if (line.startsWith('{') && line.endsWith('}')) {
                 jsonLine = line;
                 break;
             }
          }
          
          if (!jsonLine) {
              // 没找到，尝试解析整个 stdout（万一没有换行）
              jsonLine = stdout;
          }

          const result = JSON.parse(jsonLine);
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}\nRaw output: ${stdout}`));
        }
      }
    });
  });
});

ipcMain.handle('download-model', async (event, modelId) => {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, HF_ENDPOINT: 'https://hf-mirror.com', TQDM_DISABLE: '0', HF_HUB_DISABLE_PROGRESS_BARS: '0' };
    const childProcess = spawn(pythonPath, [scriptPath, '--download-model', '--model-id', modelId], { env });
    
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Download stdout:', output);
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('PROGRESS')) {
          const parts = trimmed.split(' ');
          const type = parts[1];
          const value = parts.slice(2).join(' ');
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (type === 'MODEL_DOWNLOAD_START') {
              mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_START', value, modelId });
            } else if (type === 'MODEL_DOWNLOAD_DONE') {
              mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_DONE', value, modelId });
            } else if (type === 'MODEL_DOWNLOAD_ERROR') {
              mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_ERROR', value, modelId });
            }
          }
        }
        const match = line.match(/(\d+)%/);
        if (match && mainWindow && !mainWindow.isDestroyed()) {
          const percent = parseInt(match[1], 10);
          mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_PROGRESS', value: percent, modelId });
        }
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error('Download stderr:', output);
      const lines = output.split('\n');
      for (const line of lines) {
        const match = line.match(/(\d+)%/);
        if (match && mainWindow && !mainWindow.isDestroyed()) {
          const percent = parseInt(match[1], 10);
          mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_PROGRESS', value: percent, modelId });
        }
      }
    });

    childProcess.on('close', (code) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (code === 0) {
          mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_DONE', value: modelId, modelId });
        } else {
          mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_ERROR', value: `code ${code}`, modelId });
        }
      }
      if (code !== 0) {
        reject(new Error(`Download failed with code ${code}`));
      } else {
        resolve({ success: true });
      }
    });
  });
});

ipcMain.handle('delete-model', async (event, modelId) => {
    // 只有在没有任务运行时才允许删除
    if (pythonProcess) {
        return { success: false, message: 'Cannot delete model while a task is running' };
    }

    const modelsRoot = path.join(path.dirname(scriptPath), 'models');
    const modelsDir = path.join(modelsRoot, modelId);

    try {
        if (fs.existsSync(modelsDir)) {
            fs.rmSync(modelsDir, { recursive: true, force: true });
            return { success: true };
        } else {
            return { success: false, message: 'Model directory not found' };
        }
    } catch (error) {
        console.error('Failed to delete model:', error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('start-transcription', (event, { inputPath, modelId, language, useGpu }) => {
  if (pythonProcess) {
    return { error: 'A task is already running' };
  }

  const args = [scriptPath, '--input', inputPath, '--model-id', modelId];
  if (language) {
    args.push('--language', language);
  }
  
  if (useGpu) {
    args.push('--device', 'cuda');
  } else {
    args.push('--device', 'cpu');
  }

  console.log('Spawning:', pythonPath, args.join(' '));
  
  const env = { ...process.env, HF_ENDPOINT: 'https://hf-mirror.com' };
  pythonProcess = spawn(pythonPath, args, { env });

  // State to track if we already received a successful result
  let hasCompleted = false;
  let accumulatedSegments = [];

  // 处理 stdout (包含进度和最终结果)
  pythonProcess.stdout.on('data', (data) => {
    const strData = data.toString();
    console.log('Python stdout:', strData); // Debug logging

    const lines = strData.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 修复：处理粘包问题（如果多个 PROGRESS 在一行，或者 PROGRESS 和 JSON 在一行）
      
      if (trimmed.startsWith('PROGRESS')) {
        // 解析进度: PROGRESS TRANSCRIBE 0.1234
        // 或者 PROGRESS INFO ...
        // 注意：value 可能包含空格
        const firstSpace = trimmed.indexOf(' ');
        if (firstSpace === -1) continue;
        
        const rest = trimmed.slice(firstSpace + 1);
        const secondSpace = rest.indexOf(' ');
        
        let type, value;
        if (secondSpace === -1) {
             type = rest;
             value = '';
        } else {
             type = rest.slice(0, secondSpace);
             value = rest.slice(secondSpace + 1);
        }
        
        mainWindow.webContents.send('transcription-progress', { type, value });
      } else if (trimmed.startsWith('SEGMENT ')) {
        // 实时收集 segment，用于崩溃恢复
        try {
           const jsonStr = trimmed.slice(8);
           const seg = JSON.parse(jsonStr);
           accumulatedSegments.push(seg);
        } catch (e) {
           console.error('Failed to parse segment:', e);
        }
      } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        // 可能是最终结果 JSON
        try {
          const result = JSON.parse(trimmed);
          // 只有当包含 segments 时才认为是最终结果，避免误判错误 JSON
          if (result.segments || result.error) {
              if (result.error) {
                  mainWindow.webContents.send('transcription-error', result.error);
                  // Mark as completed even if error, to prevent double reporting
                  hasCompleted = true; 
              } else {
                  mainWindow.webContents.send('transcription-complete', result);
                  hasCompleted = true;
              }
          }
        } catch (e) {
          console.error('Failed to parse result line:', trimmed);
        }
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    // 转换 buffer 为字符串，并解决可能的中文乱码（虽然 Buffer.toString 默认 utf8，但在 Windows console 有时是 gbk）
    // 这里简单处理，直接 toString
    const errorMsg = data.toString();
    console.error('Python stderr:', errorMsg); // Debug logging

    // 尝试解析 tqdm 下载进度
    // 格式示例: 10%|#         | 100M/1.0G [00:10<01:30, 10.0MB/s]
    // 宽容匹配: 只要有数字后跟 % 且在 stderr 中，我们就认为是进度（通常是 tqdm）
    // 或者匹配 "Downloading ... 12%" 这种
    const percentMatch = errorMsg.match(/(\d+)%/);
    if (percentMatch) {
      const percent = parseInt(percentMatch[1], 10);
      mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_PROGRESS', value: percent });
    } else {
        // 有些时候 tqdm 输出的是 "\r 10% ..." 这种，match 也能匹配到
        // 尝试匹配 "100/1000" 这种步数？不，太宽泛了。
        // 看看有没有 "Downloading" 关键字
        if (errorMsg.includes('Downloading') && errorMsg.includes('%')) {
            // fallback logic
        }
    }
  });

  pythonProcess.on('close', (code) => {
    console.log(`Transcription process exited with code ${code}`);
    pythonProcess = null;
    
    // Ignore exit code 3221226505 if we already have a result
    // 3221226505 (0xC0000409) is STATUS_STACK_BUFFER_OVERRUN, common in CTranslate2 on Windows
    // In signed 32-bit integer, it is -1073740791
    const isStackBufferOverrun = (code === 3221226505 || code === -1073740791);
    
    if (code !== 0 && !hasCompleted) {
       // Only report error if we haven't finished successfully
       
       if (isStackBufferOverrun) {
           console.log(`Ignored exit code ${code} (Status Stack Buffer Overrun).`);
           
           // 尝试恢复：如果我们收集到了 segments，就视为成功
           if (accumulatedSegments.length > 0) {
               console.log("Recovering from crash using accumulated segments.");
               const result = {
                   segments: accumulatedSegments,
                   duration: accumulatedSegments[accumulatedSegments.length - 1].end, // 近似时长
                   language: 'unknown'
               };
               mainWindow.webContents.send('transcription-complete', result);
               return;
           }

           // If we haven't completed, this is still bad, but maybe we can just warn?
           // But if we haven't completed, we don't have the SRT data. 
           // So we must report error OR try to recover if we have partial data?
           // For now, let's report a friendlier error message.
           mainWindow.webContents.send('transcription-error', `Process finished with warning (Code ${code}). Please check if output is complete.`);
       } else {
           mainWindow.webContents.send('transcription-error', `Process exited with code ${code}`);
       }
    } else if (hasCompleted && isStackBufferOverrun) {
        console.log(`Ignored benign exit code ${code} after success.`);
    }
  });

  return { success: true };
});

ipcMain.handle('cancel-transcription', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
    return { success: true };
  }
  return { success: false, message: 'No running process' };
});
