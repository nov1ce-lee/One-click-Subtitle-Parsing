// DOM Elements
const manageModelsBtn = document.getElementById('manage-models-btn');
const dropZone = document.getElementById('drop-zone');
const selectFileBtn = document.getElementById('select-file-btn');
const fileListContainer = document.getElementById('file-list');
const clearListBtn = document.getElementById('clear-list-btn');
const modelSelect = document.getElementById('model-select');
const languageSelect = document.getElementById('language-select');
const useGpuCheckbox = document.getElementById('use-gpu');
const startBtn = document.getElementById('start-btn');
const cancelBtn = document.getElementById('cancel-btn');
const openFolderContainer = document.getElementById('open-folder-container');
const openFolderBtn = document.getElementById('open-folder-btn');
const saveOriginalBtn = document.getElementById('save-original-btn');
const saveEditedBtn = document.getElementById('save-edited-btn');
const livePreview = document.getElementById('live-preview');
const editorContainer = document.getElementById('editor-container');
const statusText = document.getElementById('status-text');
const speedStats = document.getElementById('speed-stats');
const progressFill = document.getElementById('progress-fill');
const modelsModal = document.getElementById('models-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const modelsList = document.getElementById('models-list');

// State
let fileQueue = [];
let currentFileIndex = -1;
let models = [];
let isTranscribing = false;
let transcriptionStartTime = 0;
let currentSegments = [];
let originalSegments = [];
let downloadButtons = new Map();

// --- Initialization ---
async function init() {
    await loadModels();
    updateFileUI();
}

async function loadModels() {
    try {
        const result = await window.electronAPI.getModels();
        models = result.models;
        updateModelUI();
    } catch (err) {
        console.error("Failed to load models:", err);
        statusText.innerText = "Error loading models.";
    }
}

function updateModelUI() {
    // 1. Update Dropdown
    const currentSelection = modelSelect.value;
    modelSelect.innerHTML = '';
    
    models.forEach(m => {
        const option = document.createElement('option');
        option.value = m.id;
        const status = m.installed ? '✅' : '☁️';
        option.text = `${status} ${m.name} (${m.size_mb} MB)`;
        modelSelect.appendChild(option);
    });

    // Restore selection if valid, else select first installed or first available
    if (models.some(m => m.id === currentSelection)) {
        modelSelect.value = currentSelection;
    } else {
        const firstInstalled = models.find(m => m.installed);
        if (firstInstalled) modelSelect.value = firstInstalled.id;
    }

    // 2. Update Modal List
    renderModelList();
}

function renderModelList() {
    modelsList.innerHTML = '';
    downloadButtons.clear();
    
    models.forEach(m => {
        const item = document.createElement('div');
        item.className = 'model-list-item';
        
        const info = document.createElement('div');
        info.className = 'model-info';
        
        const badgeClass = m.installed ? 'badge-success' : 'badge-warning';
        const badgeText = m.installed ? 'Downloaded' : (m.local_dir_exists ? 'Incomplete' : 'Not Downloaded');
        
        info.innerHTML = `
            <h4>${m.name}</h4>
            <div class="model-meta">
                <span class="badge ${badgeClass}">${badgeText}</span>
                <span>Size: ~${m.size_mb} MB</span>
            </div>
        `;
        
        const actions = document.createElement('div');
        actions.className = 'model-actions';
        
        const actionBtn = document.createElement('button');
        actionBtn.className = 'btn btn-secondary btn-sm';
        
        if (m.installed) {
            actionBtn.innerText = 'Re-download';
            actionBtn.onclick = () => downloadModel(m.id, actionBtn);
        } else {
            actionBtn.innerText = 'Download';
            actionBtn.className = 'btn btn-primary btn-sm';
            actionBtn.onclick = () => downloadModel(m.id, actionBtn);
        }
        
        downloadButtons.set(m.id, actionBtn);
        actions.appendChild(actionBtn);
        
        if (m.local_dir_exists) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-secondary btn-sm';
            deleteBtn.innerText = 'Delete';
            deleteBtn.onclick = () => deleteModel(m.id, deleteBtn);
            actions.appendChild(deleteBtn);
        }
        
        item.appendChild(info);
        item.appendChild(actions);
        modelsList.appendChild(item);
    });
}

async function downloadModel(modelId, btn) {
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Downloading...';
    
    try {
        await window.electronAPI.downloadModel(modelId);
    } catch (err) {
        alert('Download failed: ' + err.message);
        btn.innerText = originalText;
        btn.disabled = false;
    } finally {
        await loadModels();
    }
}

async function deleteModel(modelId, btn) {
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Deleting...';
    try {
        const result = await window.electronAPI.deleteModel(modelId);
        if (!result.success) {
            alert('Delete failed: ' + (result.message || 'Unknown error'));
        }
        await loadModels();
    } catch (err) {
        alert('Delete failed: ' + err.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// --- File Handling ---

function addFiles(paths) {
    if (!paths) return;
    
    // Support both single path string and array of paths
    const newPaths = Array.isArray(paths) ? paths : [paths];
    
    // Avoid duplicates
    newPaths.forEach(p => {
        if (!fileQueue.includes(p)) {
            fileQueue.push(p);
        }
    });
    
    updateFileUI();
}

function removeFile(index) {
    if (isTranscribing) return;
    fileQueue.splice(index, 1);
    updateFileUI();
}

function clearFiles() {
    if (isTranscribing) return;
    fileQueue = [];
    currentFileIndex = -1;
    updateFileUI();
}

function updateFileUI() {
    fileListContainer.innerHTML = '';
    
    if (fileQueue.length === 0) {
        fileListContainer.innerHTML = '<div style="color: #999; font-size: 0.9em; padding: 10px;">No files selected</div>';
        startBtn.disabled = true;
        clearListBtn.style.display = 'none';
        dropZone.style.borderColor = '#ccc';
        dropZone.style.background = '#f9fafb';
        return;
    }
    
    startBtn.disabled = false;
    clearListBtn.style.display = 'block';
    dropZone.style.borderColor = 'var(--success-color)';
    dropZone.style.background = '#f0fdf4';

    fileQueue.forEach((path, index) => {
        const filename = path.split(/[/\\]/).pop();
        const item = document.createElement('div');
        item.className = 'file-item';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.padding = '5px 10px';
        item.style.background = '#fff';
        item.style.borderBottom = '1px solid #eee';
        
        const nameSpan = document.createElement('span');
        nameSpan.innerText = filename;
        nameSpan.title = path;
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.style.flex = '1';
        
        // Status Indicator
        if (index === currentFileIndex) {
            if (isTranscribing) {
                nameSpan.style.fontWeight = 'bold';
                nameSpan.style.color = 'var(--primary-color)';
                nameSpan.innerText += ' (Processing...)';
            }
        } else if (index < currentFileIndex) {
            nameSpan.style.color = 'var(--success-color)';
            nameSpan.innerText += ' (Done)';
        }
        
        const removeBtn = document.createElement('button');
        removeBtn.innerText = '✕';
        removeBtn.style.border = 'none';
        removeBtn.style.background = 'transparent';
        removeBtn.style.color = '#999';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.marginLeft = '10px';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFile(index);
        };
        
        if (isTranscribing) {
            removeBtn.disabled = true;
            removeBtn.style.cursor = 'not-allowed';
        }

        item.appendChild(nameSpan);
        item.appendChild(removeBtn);
        fileListContainer.appendChild(item);
    });
}

selectFileBtn.addEventListener('click', async () => {
    // We should modify IPC to support multiple selection
    // But current IPC 'select-file' only returns one path string or we need to update main.js
    // Let's verify main.js select-file implementation.
    // main.js: result.filePaths[0] -> returns only first.
    // We need to update main.js to return array.
    const path = await window.electronAPI.selectFile();
    if (path) addFiles(path);
});

clearListBtn.addEventListener('click', clearFiles);

dropZone.addEventListener('click', (e) => {
    if (e.target === dropZone || e.target.tagName === 'P') {
        selectFileBtn.click();
    }
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        // Collect all paths
        const paths = Array.from(e.dataTransfer.files).map(f => f.path);
        addFiles(paths);
    }
});

// --- Modal Handling ---
manageModelsBtn.addEventListener('click', () => {
    modelsModal.style.display = 'flex';
});

closeModalBtn.addEventListener('click', () => {
    modelsModal.style.display = 'none';
});

modelsModal.addEventListener('click', (e) => {
    if (e.target === modelsModal) {
        modelsModal.style.display = 'none';
    }
});

// --- Transcription ---

async function startBatchTranscription() {
    if (fileQueue.length === 0 || isTranscribing) return;
    
    isTranscribing = true;
    startBtn.disabled = true;
    startBtn.style.display = 'none';
    
    cancelBtn.style.display = 'inline-block';
    cancelBtn.disabled = false;
    clearListBtn.style.display = 'none';
    
    // UI Reset
    statusText.style.color = 'var(--text-secondary)';
    openFolderContainer.style.display = 'none';
    livePreview.style.display = 'block';
    editorContainer.style.display = 'none';
    
    // If starting fresh, reset index
    if (currentFileIndex === -1 || currentFileIndex >= fileQueue.length) {
        currentFileIndex = 0;
    }
    
    await processNextFile();
}

async function processNextFile() {
    if (currentFileIndex >= fileQueue.length) {
        // All done
        finishBatch();
        return;
    }
    
    if (!isTranscribing) return; // Cancelled
    
    const filePath = fileQueue[currentFileIndex];
    updateFileUI();
    
    statusText.innerText = `Processing file ${currentFileIndex + 1}/${fileQueue.length}: ${filePath.split(/[/\\]/).pop()}`;
    speedStats.innerText = '';
    livePreview.innerText = '';
    progressFill.style.width = '0%';
    
    transcriptionStartTime = Date.now();
    
    window.electronAPI.startTranscription({
        inputPath: filePath,
        modelId: modelSelect.value,
        language: languageSelect.value,
        useGpu: useGpuCheckbox.checked
    });
}

function finishBatch() {
    isTranscribing = false;
    startBtn.disabled = false;
    startBtn.style.display = 'inline-block';
    cancelBtn.style.display = 'none';
    clearListBtn.style.display = 'block';
    
    statusText.innerText = 'All files processed!';
    statusText.style.color = 'var(--success-color)';
    currentFileIndex = -1; // Reset or keep? Maybe keep to show "Done" status
    // Actually, updateFileUI uses currentFileIndex to show "Done" for previous ones.
    // So we should keep currentFileIndex at length?
    // Let's set it to length so all show as Done.
    currentFileIndex = fileQueue.length;
    updateFileUI();
    
    openFolderContainer.style.display = 'block';
}

startBtn.addEventListener('click', () => {
    // Reset index if we are starting a new batch (all previously done or fresh)
    if (currentFileIndex === -1 || currentFileIndex >= fileQueue.length) {
        currentFileIndex = 0;
    }
    startBatchTranscription();
});

cancelBtn.addEventListener('click', async () => {
    if (!isTranscribing) return;
    
    cancelBtn.disabled = true;
    cancelBtn.innerText = 'Stopping...';
    
    try {
        const result = await window.electronAPI.cancelTranscription();
        if (result.success) {
            statusText.innerText = 'Task cancelled by user.';
            statusText.style.color = 'var(--warning-color)';
        } else {
            statusText.innerText = 'Failed to cancel: ' + result.message;
        }
    } catch (err) {
        console.error('Cancel error:', err);
        statusText.innerText = 'Error cancelling task.';
    } finally {
        isTranscribing = false;
        startBtn.disabled = false;
        startBtn.style.display = 'inline-block';
        
        cancelBtn.style.display = 'none';
        cancelBtn.innerText = 'Stop';
        clearListBtn.style.display = 'block';
        
        progressFill.style.width = '0%';
        updateFileUI();
    }
});

// --- IPC Events ---

window.electronAPI.onProgress((data) => {
    if (data.type === 'TRANSCRIBE') {
        const percent = (parseFloat(data.value) * 100).toFixed(1);
        progressFill.style.width = `${percent}%`;
        statusText.innerText = `Transcribing... ${percent}%`;
    } else if (data.type === 'DETAILS') {
        livePreview.innerText += data.value + '\n';
        livePreview.scrollTop = livePreview.scrollHeight;
    } else if (data.type === 'DOWNLOAD_START') {
        statusText.innerText = 'Downloading Model...';
        if (data.modelId) {
            const btn = downloadButtons.get(data.modelId);
            if (btn) {
                btn.innerText = 'Downloading...';
            }
        }
    } else if (data.type === 'DOWNLOAD_PROGRESS') {
        statusText.innerText = `Downloading Model: ${data.value}%`;
        if (data.modelId) {
            const btn = downloadButtons.get(data.modelId);
            if (btn) {
                btn.innerText = `Downloading ${data.value}%`;
            }
        }
    } else if (data.type === 'DOWNLOAD_DONE') {
        statusText.innerText = 'Download completed';
    } else if (data.type === 'DOWNLOAD_ERROR') {
        statusText.innerText = `Download failed: ${data.value}`;
    } else if (data.type === 'LOAD_MODEL') {
        statusText.innerText = 'Loading Model...';
    } else if (data.type === 'INFO') {
        console.log("Backend Info:", data.value);
    }
});

window.electronAPI.onComplete((result) => {
    // Save SRT automatically for batch processing
    // Deep copy for original and current
    originalSegments = JSON.parse(JSON.stringify(result.segments));
    currentSegments = JSON.parse(JSON.stringify(result.segments));
    
    // Auto save SRT for current file
    const fileResult = { segments: originalSegments };
    // We need a way to save without prompting if possible, or just trigger download.
    // In Electron renderer, triggering download might prompt dialog depending on settings.
    // But since we are in a batch, it's better to auto-save to the same folder as input.
    // However, renderer cannot write files directly without nodeIntegration.
    // We should invoke an IPC to save file.
    // But existing saveSRT uses Blob download which prompts.
    
    // Let's modify saveSRT or add saveSRTToFile IPC.
    // For now, let's just trigger the download and user might have to click save (if not set to auto).
    // Or we can add a "save-file" IPC in main.js
    
    // To keep it simple for now, we will just use the existing saveSRT but maybe we should automate it.
    saveSRT(fileResult, false); 
    
    progressFill.style.width = '100%';
    
    const duration = (Date.now() - transcriptionStartTime) / 1000;
    const speed = result.duration / duration;
    
    // speedStats.innerText = `${result.duration.toFixed(1)}s processed in ${duration.toFixed(1)}s (${speed.toFixed(1)}x Speed)`;
    console.log(`File ${currentFileIndex + 1} done. Speed: ${speed.toFixed(1)}x`);
    
    // Move to next file
    currentFileIndex++;
    processNextFile();
});

function renderEditor() {
    // Only render editor if we are not processing (or maybe just show last one?)
    // In batch mode, editor might be less useful during processing.
    // But we can show the last processed one.
    
    livePreview.style.display = 'none';
    editorContainer.style.display = 'block';
    editorContainer.innerHTML = '';

    currentSegments.forEach((seg) => {
        const item = document.createElement('div');
        item.className = 'editor-item';
        
        const timeTag = document.createElement('div');
        timeTag.className = 'time-tag';
        timeTag.innerText = `[${formatTime(seg.start)} -> ${formatTime(seg.end)}]`;
        
        const textArea = document.createElement('textarea');
        textArea.className = 'text-edit';
        textArea.value = seg.text;
        textArea.rows = 1;
        
        // Auto resize height
        const adjustHeight = () => {
             textArea.style.height = 'auto';
             textArea.style.height = textArea.scrollHeight + 'px';
        };
        
        // Use timeout to ensure DOM is rendered before calculating height
        setTimeout(adjustHeight, 0);
        
        textArea.addEventListener('input', (e) => {
            seg.text = e.target.value;
            adjustHeight();
        });

        item.appendChild(timeTag);
        item.appendChild(textArea);
        editorContainer.appendChild(item);
    });
}

saveEditedBtn.addEventListener('click', () => {
    // Save currentSegments to SRT
    const result = { segments: currentSegments };
    saveSRT(result, true); // true for "isEdited"
});

saveOriginalBtn.addEventListener('click', () => {
    // For batch mode, this button might save the *currently displayed* editor content's original?
    // Or maybe we should disable these buttons during batch?
    // Let's keep them working for the "last processed" file which is in memory.
    if (originalSegments.length > 0) {
         const result = { segments: originalSegments };
         saveSRT(result, false);
    }
});

window.electronAPI.onError((message) => {
    // If one file fails, should we stop or continue?
    // Let's log error and continue to next.
    console.error(`Error processing file ${currentFileIndex}: ${message}`);
    
    // Mark as error in UI (maybe needed?)
    // For now just continue
    currentFileIndex++;
    processNextFile();
});

// Helper: Generate and Save SRT
function saveSRT(result, isEdited = false) {
    const srtContent = result.segments.map((seg, index) => {
        return `${index + 1}\n${formatTime(seg.start)} --> ${formatTime(seg.end)}\n${seg.text}\n`;
    }).join('\n');
    
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Use original filename + .srt
    // We need the filename of the *current* file being processed (or last processed)
    // If we are in the middle of a batch, currentFileIndex might have incremented if called from onComplete.
    // Wait, onComplete calls saveSRT BEFORE incrementing.
    
    let filePath;
    if (currentFileIndex >= 0 && currentFileIndex < fileQueue.length) {
        filePath = fileQueue[currentFileIndex];
    } else if (fileQueue.length > 0) {
        // Fallback to last file if index is out of bounds (finished)
        filePath = fileQueue[fileQueue.length - 1];
    } else {
        return; 
    }

    const originalName = filePath.split(/[/\\]/).pop();
    const suffix = isEdited ? '.edited.srt' : '.srt';
    a.download = originalName + suffix;
    
    a.click();
    URL.revokeObjectURL(url);
}

openFolderBtn.addEventListener('click', () => {
    if (currentFilePath) {
         window.electronAPI.showItemInFolder(currentFilePath);
    }
});

function formatTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const iso = date.toISOString();
    // 1970-01-01T00:00:00.000Z
    // We want 00:00:00,000
    return iso.substr(11, 8) + ',' + iso.substr(20, 3);
}

// Start
init();
