const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => ipcRenderer.invoke('select-file'),
  getModels: () => ipcRenderer.invoke('get-models'),
  downloadModel: (modelId) => ipcRenderer.invoke('download-model', modelId),
  deleteModel: (modelId) => ipcRenderer.invoke('delete-model', modelId),
  startTranscription: (options) => ipcRenderer.invoke('start-transcription', options),
  cancelTranscription: () => ipcRenderer.invoke('cancel-transcription'),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),
  
  onProgress: (callback) => ipcRenderer.on('transcription-progress', (event, value) => callback(value)),
  onComplete: (callback) => ipcRenderer.on('transcription-complete', (_event, value) => callback(value)),
  onError: (callback) => ipcRenderer.on('transcription-error', (_event, value) => callback(value)),
  
  // 清理监听器
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('transcription-progress');
    ipcRenderer.removeAllListeners('transcription-complete');
    ipcRenderer.removeAllListeners('transcription-error');
  }
});
