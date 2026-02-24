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
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'm4a'] }
    ]
  });
  return result.filePaths;
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
    
    // Stdout should now only contain the final JSON result
    childProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('Download stdout:', output);
      try {
          const result = JSON.parse(output);
          if (result.success) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_DONE', value: modelId, modelId });
              }
          } else if (result.error) {
              if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_ERROR', value: result.error, modelId });
              }
          }
      } catch (e) {
          // Ignore partial JSON
      }
    });

    // Stderr contains progress logs
    childProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error('Download stderr:', output);
      
      // Parse legacy PROGRESS format from models_manager (now on stderr)
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
        
        // Parse TQDM progress
        const match = line.match(/(\d+)%/);
        if (match && mainWindow && !mainWindow.isDestroyed()) {
          const percent = parseInt(match[1], 10);
          mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_PROGRESS', value: percent, modelId });
        }
      }
    });

    childProcess.on('close', (code) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (code !== 0) {
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

  // Buffer to handle split chunks
  let stdoutBuffer = '';

  // 处理 stdout (只包含 JSON)
  pythonProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
    stdoutBuffer += chunk;

    const lines = stdoutBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    stdoutBuffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        
        // Handle Error
        if (message.error) {
            mainWindow.webContents.send('transcription-error', message.error);
            hasCompleted = true; // Stop further processing
            return;
        }

        // Handle New IPC Format
        if (message.type) {
            switch (message.type) {
                case 'progress':
                    // payload: { stage: '...', model: '...' }
                    const stage = message.payload.stage;
                    if (stage === 'downloading_model') {
                         mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_START', value: message.payload.model });
                    } else if (stage === 'loading_model') {
                         mainWindow.webContents.send('transcription-progress', { type: 'LOAD_MODEL' });
                    } else if (stage === 'transcribing') {
                         mainWindow.webContents.send('transcription-progress', { type: 'TRANSCRIBE', value: 0 });
                    }
                    break;
                
                case 'segment':
                    // payload: { segment: {...}, progress: 0.5 }
                    const seg = message.payload.segment;
                    const prog = message.payload.progress;
                    
                    accumulatedSegments.push(seg);
                    
                    // Update progress bar
                    mainWindow.webContents.send('transcription-progress', { type: 'TRANSCRIBE', value: prog });
                    
                    // Update live text (replace newlines for simple display)
                    const safeText = seg.text.replace('\n', ' ');
                    mainWindow.webContents.send('transcription-progress', { type: 'DETAILS', value: safeText });
                    break;

                case 'complete':
                    // payload: { segments: [], ... }
                    const result = message.payload;
                    if (!hasCompleted) {
                        mainWindow.webContents.send('transcription-complete', result);
                        hasCompleted = true;
                    }
                    break;
            }
        } 
        // Backward compatibility / Fallback for direct JSON dumps (like final error or result if not wrapped)
        else if (message.segments) {
             if (!hasCompleted) {
                mainWindow.webContents.send('transcription-complete', message);
                hasCompleted = true;
            }
        }
      } catch (e) {
        console.error('Failed to parse JSON line:', trimmed, e);
      }
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const errorMsg = data.toString();
    console.error('Python stderr:', errorMsg); 
    
    // Send logs to frontend for debugging (optional, using INFO type)
    if (errorMsg.startsWith('INFO:')) {
        mainWindow.webContents.send('transcription-progress', { type: 'INFO', value: errorMsg.replace('INFO:', '').trim() });
    }

    // Still try to parse TQDM progress from stderr if any (e.g. during model download inside transcribe.py)
    const percentMatch = errorMsg.match(/(\d+)%/);
    if (percentMatch) {
      const percent = parseInt(percentMatch[1], 10);
      mainWindow.webContents.send('transcription-progress', { type: 'DOWNLOAD_PROGRESS', value: percent });
    }
  });

  pythonProcess.on('close', (code) => {
    console.log(`Transcription process exited with code ${code}`);
    pythonProcess = null;
    
    // 3221226505 (0xC0000409) is STATUS_STACK_BUFFER_OVERRUN
    const isStackBufferOverrun = (code === 3221226505 || code === -1073740791);
    
    // Check if it was killed manually (we usually set a flag or just check code)
    // On Windows, taskkill might produce code 1 or 0 or 15. 
    // If hasCompleted is true, we don't care.
    
    if (code !== 0 && !hasCompleted) {
       // Only report error if we haven't finished successfully
       
       if (isStackBufferOverrun) {
           console.log(`Ignored exit code ${code} (Status Stack Buffer Overrun).`);
           
           // Crash recovery
           if (accumulatedSegments.length > 0) {
               console.log("Recovering from crash using accumulated segments.");
               const result = {
                   segments: accumulatedSegments,
                   duration: accumulatedSegments[accumulatedSegments.length - 1].end, 
                   language: 'unknown'
               };
               mainWindow.webContents.send('transcription-complete', result);
               return;
           }
           mainWindow.webContents.send('transcription-error', `Process finished with warning (Code ${code}). Please check if output is complete.`);
       } else {
           // If code is null (killed by signal) or non-zero
           // We might want to distinguish "User Cancelled" vs "Crash"
           // But here we don't know if user cancelled easily unless we track it.
           // However, if user cancelled, renderer usually knows it.
           // We can just send an error or generic message.
           mainWindow.webContents.send('transcription-error', `Process exited with code ${code}`);
       }
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
