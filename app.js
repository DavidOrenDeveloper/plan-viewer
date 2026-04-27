pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let virtualFileSystem = { "root": {} }; 
let currentPath = "root";
let activePaneId = 1;
let splitMode = false;

const panesState = {
    1: { pdfDoc: null, pageNum: 1, scale: 1.0, baseScale: 1.0, currentScale: 1.0, canvas: document.getElementById('pdfCanvas1'), wrapper: document.getElementById('wrapper1'), posX: 0, posY: 0 },
    2: { pdfDoc: null, pageNum: 1, scale: 1.0, baseScale: 1.0, currentScale: 1.0, canvas: document.getElementById('pdfCanvas2'), wrapper: document.getElementById('wrapper2'), posX: 0, posY: 0 }
};

const sidebar = document.getElementById('sidebar');
const fileTree = document.getElementById('fileTree');
const contextMenu = document.getElementById('contextMenu');
const moveModal = document.getElementById('moveModal');

async function initApp() {
    const savedVFS = await localforage.getItem('vfs');
    if (savedVFS) virtualFileSystem = savedVFS;
    renderFileTree();
}

async function saveVFS() { await localforage.setItem('vfs', virtualFileSystem); }

// --- UI / Sidebar Logic ---
document.getElementById('menuToggle').onclick = () => sidebar.classList.add('open');
document.getElementById('closeSidebar').onclick = () => sidebar.classList.remove('open');
document.getElementById('viewerArea').onclick = (e) => {
    if(window.innerWidth < 768 && !e.target.closest('.fab')) sidebar.classList.remove('open');
};

document.getElementById('splitScreenBtn').onclick = () => {
    splitMode = !splitMode;
    document.getElementById('pane2').classList.toggle('hidden');
    document.getElementById('splitScreenBtn').classList.toggle('active');
    setActivePane(splitMode ? 2 : 1);
};

document.getElementById('resetZoomBtn').onclick = () => {
    if(panesState[activePaneId].pdfDoc) {
        panesState[activePaneId].scale = panesState[activePaneId].baseScale;
        panesState[activePaneId].posX = 0;
        panesState[activePaneId].posY = 0;
        renderPage(activePaneId, true);
    }
};

window.setActivePane = function(paneId) {
    activePaneId = paneId;
    document.getElementById('pane1').classList.remove('active-pane');
    document.getElementById('pane2').classList.remove('active-pane');
    document.getElementById(`pane${paneId}`).classList.add('active-pane');
};

// View Toggles
document.getElementById('listViewBtn').onclick = () => { fileTree.className = 'file-tree list-view'; document.getElementById('listViewBtn').classList.add('active'); document.getElementById('gridViewBtn').classList.remove('active'); };
document.getElementById('gridViewBtn').onclick = () => { fileTree.className = 'file-tree grid-view'; document.getElementById('gridViewBtn').classList.add('active'); document.getElementById('listViewBtn').classList.remove('active'); };


// --- Upload Multiple Files ---
document.getElementById('uploadFab').onclick = () => document.getElementById('fileInput').click();

document.getElementById('fileInput').onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    for (let file of files) {
        const fileId = 'file_' + Date.now() + Math.floor(Math.random()*1000);
        const arrayBuffer = await file.arrayBuffer();
        await localforage.setItem(fileId, arrayBuffer);
        
        if(!virtualFileSystem[currentPath]) virtualFileSystem[currentPath] = {};
        virtualFileSystem[currentPath][fileId] = { name: file.name, type: 'pdf' };
    }
    
    await saveVFS();
    renderFileTree();
};

document.getElementById('newFolderBtn').onclick = () => {
    const folderName = prompt("שם התיקייה החדשה:");
    if (folderName && !virtualFileSystem[folderName]) {
        virtualFileSystem[folderName] = {};
        saveVFS();
        renderFileTree();
    }
};

// --- Render File Tree with Drag & Drop ---
function renderFileTree() {
    fileTree.innerHTML = '';
    const goBackBtn = document.getElementById('goBackBtn');
    
    if (currentPath !== "root") {
        goBackBtn.style.display = 'block';
        goBackBtn.onclick = () => { currentPath = "root"; renderFileTree(); };
    } else {
        goBackBtn.style.display = 'none';
    }

    const currentItems = virtualFileSystem[currentPath] || {};

    if (currentPath === "root") {
        Object.keys(virtualFileSystem).forEach(key => {
            if (key === "root") return;
            const div = document.createElement('div');
            div.className = 'item folder';
            // Drop zone logic
            div.ondragover = (e) => e.preventDefault();
            div.ondrop = (e) => handleDrop(e, key);
            
            div.innerHTML = `
                <div class="item-info" onclick="openFolder('${key}')"><span class="material-icons">folder</span> <span class="name">${key}</span></div>
                <div class="item-actions"><span class="material-icons more-btn" onclick="showContextMenu(event, '${key}', '${key}', 'folder')">more_vert</span></div>
            `;
            fileTree.appendChild(div);
        });
    }

    Object.entries(currentItems).forEach(([id, meta]) => {
        const div = document.createElement('div');
        div.className = 'item file';
        // Drag logic
        div.draggable = true;
        div.ondragstart = (e) => e.dataTransfer.setData('text/plain', id);

        div.innerHTML = `
            <div class="item-info" onclick="openFile('${id}')"><span class="material-icons">picture_as_pdf</span> <span class="name">${meta.name}</span></div>
            <div class="item-actions"><span class="material-icons more-btn" onclick="showContextMenu(event, '${id}', '${meta.name}', 'file')">more_vert</span></div>
        `;
        fileTree.appendChild(div);
    });
}

window.openFolder = function(folderName) {
    currentPath = folderName;
    renderFileTree();
};

window.openFile = function(fileId) {
    loadPdfToActivePane(fileId);
    if(window.innerWidth < 768) sidebar.classList.remove('open');
};

function handleDrop(e, targetFolder) {
    e.preventDefault();
    const fileId = e.dataTransfer.getData('text/plain');
    if(fileId && virtualFileSystem["root"][fileId]) {
        virtualFileSystem[targetFolder][fileId] = virtualFileSystem["root"][fileId];
        delete virtualFileSystem["root"][fileId];
        saveVFS();
        renderFileTree();
    }
}

// --- Context Menu Logic (Files & Folders) ---
let selectedItemId = null;
let selectedItemType = null;
let selectedItemName = null;

window.showContextMenu = function(e, id, name, type) {
    e.stopPropagation();
    selectedItemId = id;
    selectedItemType = type;
    selectedItemName = name;
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.classList.remove('hidden');
};

document.addEventListener('click', () => contextMenu.classList.add('hidden'));

document.getElementById('menuDelete').onclick = async () => {
    if(confirm('האם אתה בטוח שברצונך למחוק?')) {
        if(selectedItemType === 'file') {
            delete virtualFileSystem[currentPath][selectedItemId];
            await localforage.removeItem(selectedItemId);
        } else {
            // Delete folder and its contents
            for(let fId in virtualFileSystem[selectedItemId]) {
                await localforage.removeItem(fId);
            }
            delete virtualFileSystem[selectedItemId];
        }
        await saveVFS();
        renderFileTree();
    }
};

document.getElementById('menuRename').onclick = async () => {
    const newName = prompt('הכנס שם חדש:', selectedItemName);
    if(newName) {
        if(selectedItemType === 'file') {
            virtualFileSystem[currentPath][selectedItemId].name = newName;
        } else {
            virtualFileSystem[newName] = virtualFileSystem[selectedItemId];
            delete virtualFileSystem[selectedItemId];
        }
        await saveVFS();
        renderFileTree();
    }
};

// Move Logic
document.getElementById('menuMove').onclick = () => {
    if(selectedItemType === 'folder') return alert('לא ניתן להזיז תיקיות כרגע.');
    const select = document.getElementById('folderSelect');
    select.innerHTML = '<option value="root">ראשי</option>';
    Object.keys(virtualFileSystem).forEach(folder => {
        if(folder !== 'root') select.innerHTML += `<option value="${folder}">${folder}</option>`;
    });
    moveModal.classList.remove('hidden');
};

document.getElementById('cancelMoveBtn').onclick = () => moveModal.classList.add('hidden');
document.getElementById('confirmMoveBtn').onclick = async () => {
    const targetFolder = document.getElementById('folderSelect').value;
    if(targetFolder !== currentPath) {
        virtualFileSystem[targetFolder][selectedItemId] = virtualFileSystem[currentPath][selectedItemId];
        delete virtualFileSystem[currentPath][selectedItemId];
        await saveVFS();
        renderFileTree();
    }
    moveModal.classList.add('hidden');
};

// --- PDF Engine & Advanced Pinch-to-Zoom ---
async function loadPdfToActivePane(fileId) {
    const state = panesState[activePaneId];
    try {
        const fileData = await localforage.getItem(fileId);
        if (!fileData) return;

        const loadingTask = pdfjsLib.getDocument({ data: fileData });
        state.pdfDoc = await loadingTask.promise;
        state.pageNum = 1;
        
        // Calculate fit-to-screen scale
        const page = await state.pdfDoc.getPage(1);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const wrapperRect = state.wrapper.getBoundingClientRect();
        
        // Ensure it fits exactly 100% of the visible area
        const scaleToFit = Math.min(wrapperRect.width / unscaledViewport.width, wrapperRect.height / unscaledViewport.height);
        
        state.baseScale = scaleToFit;
        state.scale = scaleToFit;
        state.posX = 0; 
        state.posY = 0;
        
        setupTouchGestures(activePaneId);
        renderPage(activePaneId, true);
    } catch (error) { console.error("PDF Error:", error); }
}

async function renderPage(paneId, forceHighRes = false) {
    const state = panesState[paneId];
    if (!state.pdfDoc) return;

    const page = await state.pdfDoc.getPage(state.pageNum);
    // Render at a higher resolution (x2) to keep text sharp even while zooming in CSS
    const renderScale = forceHighRes ? state.scale * 2 : state.scale; 
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = state.canvas;
    const ctx = canvas.getContext('2d');
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // The CSS width defines the actual display size, while canvas.width is the high-res buffer
    const displayWidth = viewport.width / (forceHighRes ? 2 : 1);
    const displayHeight = viewport.height / (forceHighRes ? 2 : 1);
    canvas.style.width = displayWidth + "px";
    canvas.style.height = displayHeight + "px";
    
    // Apply transforms
    applyTransform(state);

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
}

function applyTransform(state) {
    // Keep image within wrapper bounds to prevent black screen / disappearing
    const wrapperRect = state.wrapper.getBoundingClientRect();
    const canvasWidth = parseFloat(state.canvas.style.width) * state.currentScale;
    const canvasHeight = parseFloat(state.canvas.style.height) * state.currentScale;

    // Boundaries clamping (prevents throwing the image off screen)
    const margin = 50; // Allow 50px of drag past the edge
    const minX = Math.min(0, wrapperRect.width - canvasWidth) - margin;
    const maxX = margin;
    const minY = Math.min(0, wrapperRect.height - canvasHeight) - margin;
    const maxY = margin;

    state.posX = Math.max(minX, Math.min(maxX, state.posX));
    state.posY = Math.max(minY, Math.min(maxY, state.posY));

    state.canvas.style.transform = `translate(${state.posX}px, ${state.posY}px) scale(${state.currentScale})`;
}

// Fixed Pinch-to-Zoom Math (Focus on finger center)
function setupTouchGestures(paneId) {
    const state = panesState[paneId];
    const wrapper = state.wrapper;
    const canvas = state.canvas;
    
    let initialDistance = 0, initialScale = 1;
    let isPinching = false;
    let startX, startY, initialPosX, initialPosY;
    let pinchCenterX, pinchCenterY;

    wrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPinching = true;
            initialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            initialScale = state.currentScale;
            
            // Calculate center point between two fingers relative to the wrapper
            const rect = wrapper.getBoundingClientRect();
            pinchCenterX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
            pinchCenterY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;

        } else if (e.touches.length === 1) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            initialPosX = state.posX;
            initialPosY = state.posY;
        }
    }, {passive: false});

    wrapper.addEventListener('touchmove', (e) => {
        e.preventDefault(); 
        
        if (e.touches.length === 2 && isPinching) {
            const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const scaleChange = currentDistance / initialDistance;
            let tempScale = initialScale * scaleChange;
            
            if (tempScale < 0.5) tempScale = 0.5;
            if (tempScale > 20) tempScale = 20;

            // Math to keep the zoom focused on the pinch center
            const ratio = tempScale / state.currentScale;
            state.posX = pinchCenterX - ratio * (pinchCenterX - state.posX);
            state.posY = pinchCenterY - ratio * (pinchCenterY - state.posY);
            state.currentScale = tempScale;

            applyTransform(state);
            
        } else if (e.touches.length === 1 && !isPinching) {
            state.posX = initialPosX + (e.touches[0].clientX - startX);
            state.posY = initialPosY + (e.touches[0].clientY - startY);
            applyTransform(state);
        }
    }, {passive: false});

    wrapper.addEventListener('touchend', (e) => {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            // Re-render in high quality once user stops pinching
            state.scale = state.currentScale * state.baseScale;
            state.currentScale = 1.0; 
            renderPage(paneId, true);
        }
    });
}

initApp();
