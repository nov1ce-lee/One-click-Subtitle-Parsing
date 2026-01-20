// DOM Elements
const manageModelsBtn = document.getElementById('manage-models-btn');
const dropZone = document.getElementById('drop-zone');
const selectFileBtn = document.getElementById('select-file-btn');
const fileInfo = document.getElementById('file-info');
const modelSelect = document.getElementById('model-select');
const languageSelect = document.getElementById('language-select');
const useGpuCheckbox = document.getElementById('use-gpu');
const startBtn = document.getElementById('start-btn');
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
let currentFilePath = null;
let models = [];
let isTranscribing = false;
let transcriptionStartTime = 0;
let currentSegments = [];
let originalSegments = [];
let downloadButtons = new Map();

// --- Initialization ---
async function init() {
    await loadModels();
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

function handleFileSelect(path) {
    if (!path) return;
    currentFilePath = path;
    const filename = path.split(/[/\\]/).pop();
    fileInfo.innerText = filename;
    startBtn.disabled = false;
    dropZone.style.borderColor = 'var(--success-color)';
    dropZone.style.background = '#f0fdf4';
}

selectFileBtn.addEventListener('click', async () => {
    const path = await window.electronAPI.selectFile();
    handleFileSelect(path);
});

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
        const path = e.dataTransfer.files[0].path;
        handleFileSelect(path);
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

startBtn.addEventListener('click', () => {
    if (!currentFilePath || isTranscribing) return;
    
    isTranscribing = true;
    startBtn.disabled = true;
    
    // UI Reset
    statusText.innerText = 'Initializing...';
    speedStats.innerText = '';
    livePreview.innerText = '';
    progressFill.style.width = '0%';
    statusText.style.color = 'var(--text-secondary)';
    openFolderContainer.style.display = 'none';
    livePreview.style.display = 'block';
    editorContainer.style.display = 'none';
    
    transcriptionStartTime = Date.now();
    
    window.electronAPI.startTranscription({
        inputPath: currentFilePath,
        modelId: modelSelect.value,
        language: languageSelect.value,
        useGpu: useGpuCheckbox.checked
    });
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
    isTranscribing = false;
    startBtn.disabled = false;
    
    progressFill.style.width = '100%';
    
    const duration = (Date.now() - transcriptionStartTime) / 1000;
    const speed = result.duration / duration;
    
    statusText.innerText = `Done!`;
    statusText.style.color = 'var(--success-color)';
    speedStats.innerText = `${result.duration.toFixed(1)}s processed in ${duration.toFixed(1)}s (${speed.toFixed(1)}x Speed)`;
    
    openFolderContainer.style.display = 'block';
    
    // Auto save SRT REMOVED - Manual Export Only
    // saveSRT(result);

    // Deep copy for original and current
    originalSegments = JSON.parse(JSON.stringify(result.segments));
    currentSegments = JSON.parse(JSON.stringify(result.segments));
    
    // Render Editor
    renderEditor();
});

function renderEditor() {
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
    // Save original segments (assuming currentSegments was initialized from result)
    // NOTE: If user edits currentSegments in place, we might lose original if we didn't deep copy.
    // However, currentSegments IS the source of truth for "Editor".
    // If we want "Original", we should have stored it separately or just assume "Original" means 
    // "Whatever is in the editor right now but saved with .srt"? 
    // NO, "Original" usually means the raw output.
    // But since I didn't keep a separate copy of `result.segments`, `currentSegments` IS the object.
    // If I edit `seg.text`, it changes.
    // So I should keep a copy?
    // Actually, for now let's just save what we have as .srt if user clicks "Original"? 
    // No, user expects the UNEDITED version.
    // So I need to deep copy `result.segments` when I assign to `currentSegments`?
    // Or store `originalSegments`.
    
    // Let's modify onComplete to store `originalSegments`.
    
    // For now, I will just implement the click handler, and fix the storage logic in next step.
    // Wait, I can't leave it broken.
    
    // Assuming I fix onComplete:
    const result = { segments: originalSegments };
    saveSRT(result, false);
});

window.electronAPI.onError((message) => {
    isTranscribing = false;
    startBtn.disabled = false;
    
    statusText.innerText = `Error: ${message}`;
    statusText.style.color = 'var(--error-color)';
    console.error(message);
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
    const originalName = currentFilePath.split(/[/\\]/).pop();
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
