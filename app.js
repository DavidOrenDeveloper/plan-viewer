pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let virtualFileSystem = { "root": {} }; 
let currentPath = "root";
let activePaneId = 1;
let splitMode = false;

const panesState = {
    1: { pdfDoc: null, pageNum: 1, scale: 1.0, currentScale: 1.0, canvas: document.getElementById('pdfCanvas1'), wrapper: document.getElementById('wrapper1'), posX: 0, posY: 0 },
    2: { pdfDoc: null, pageNum: 1, scale: 1.0, currentScale: 1.0, canvas: document.getElementById('pdfCanvas2'), wrapper: document.getElementById('wrapper2'), posX: 0, posY: 0 }
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

// --- UI Logic & Fullscreen ---
document.getElementById('menuToggle').onclick = () => sidebar.classList.add('open');
document.getElementById('closeSidebar').onclick = () => sidebar.classList.remove('open');

document.getElementById('splitScreenBtn').onclick = () => {
    splitMode = !splitMode;
    document.getElementById('pane2').classList.toggle('hidden');
    document.getElementById('splitScreenBtn').classList.toggle('active');
    setActivePane(splitMode ? 2 : 1);
};

// Fullscreen Logic
document.getElementById('fullScreenBtn').onclick = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => console.log(err));
    }
};

document.getElementById('exitFullScreenBtn').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
};

document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        document.body.classList.add('fullscreen-active');
        document.getElementById('exitFullScreenBtn').classList.remove('hidden');
    } else {
        document.body.classList.remove('fullscreen-active');
        document.getElementById('exitFullScreenBtn').classList.add('hidden');
    }
});

document.getElementById('resetZoomBtn').onclick = () => {
    if(panesState[activePaneId].pdfDoc) {
        fitToScreen(activePaneId);
    }
};

window.setActivePane = function(paneId) {
    activePaneId = paneId;
    document.getElementById('pane1').classList.remove('active-pane');
    document.getElementById('pane2').classList.remove('active-pane');
    document.getElementById(`pane${paneId}`).classList.add('active-pane');
};

document.getElementById('listViewBtn').onclick = () => { fileTree.className = 'file-tree list-view'; document.getElementById('listViewBtn').classList.add('active'); document.getElementById('gridViewBtn').classList.remove('active'); };
document.getElementById('gridViewBtn').onclick = () => { fileTree.className = 'file-tree grid-view'; document.getElementById('gridViewBtn').classList.add('active'); document.getElementById('listViewBtn').classList.remove('active'); };

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

// --- File Tree Rendering (Fixed Click Areas) ---
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
            // Click anywhere on the row except the 3 dots
            div.onclick = (e) => { if(!e.target.closest('.item-actions')) openFolder(key); };
            
            div.innerHTML = `
                <div class="item-info"><span class="material-icons">folder</span> <span class="name">${key}</span></div>
                <div class="item-actions"><span class="material-icons more-btn" onclick="showContextMenu(event, '${key}', '${key}', 'folder')">more_vert</span></div>
            `;
            fileTree.appendChild(div);
        });
    }

    Object.entries(currentItems).forEach(([id, meta]) => {
        const div = document.createElement('div');
        div.className = 'item file';
        // Click anywhere on the row except the 3 dots
        div.onclick = (e) => { if(!e.target.closest('.item-actions')) openFile(id); };

        div.innerHTML = `
            <div class="item-info"><span class="material-icons">picture_as_pdf</span> <span class="name">${meta.name}</span></div>
            <div class="item-actions"><span class="material-icons more-btn" onclick="showContextMenu(event, '${id}', '${meta.name}', 'file')">more_vert</span></div>
        `;
        fileTree.appendChild(div);
    });
}

window.openFolder = function(folderName) { currentPath = folderName; renderFileTree(); };
window.openFile = function(fileId) { loadPdfToActivePane(fileId); if(window.innerWidth < 768) sidebar.classList.remove('open'); };

// --- Context Menu & Move Logic ---
let selectedItemId = null, selectedItemType = null, selectedItemName = null;

window.showContextMenu = function(e, id, name, type) {
    e.stopPropagation();
    selectedItemId = id; selectedItemType = type; selectedItemName = name;
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.classList.remove('hidden');
};

document.addEventListener('click', () => contextMenu.classList.add('hidden'));

document.getElementById('menuDelete').onclick = async () => {
    if(confirm('למחוק?')) {
        if(selectedItemType === 'file') {
            delete virtualFileSystem[currentPath][selectedItemId];
            await localforage.removeItem(selectedItemId);
        } else {
            for(let fId in virtualFileSystem[selectedItemId]) await localforage.removeItem(fId);
            delete virtualFileSystem[selectedItemId];
        }
        await saveVFS(); renderFileTree();
    }
};

document.getElementById('menuRename').onclick = async () => {
    const newName = prompt('הכנס שם חדש:', selectedItemName);
    if(newName) {
        if(selectedItemType === 'file') virtualFileSystem[currentPath][selectedItemId].name = newName;
        else { virtualFileSystem[newName] = virtualFileSystem[selectedItemId]; delete virtualFileSystem[selectedItemId]; }
        await saveVFS(); renderFileTree();
    }
};

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
        currentPath = targetFolder; // Jump to target folder
        await saveVFS();
        renderFileTree();
    }
    moveModal.classList.add('hidden');
};

// --- Rock Solid PDF Engine & Pinch-to-Zoom Math ---
async function loadPdfToActivePane(fileId) {
    const state = panesState[activePaneId];
    try {
        const fileData = await localforage.getItem(fileId);
        if (!fileData) return;
        const loadingTask = pdfjsLib.getDocument({ data: fileData });
        state.pdfDoc = await loadingTask.promise;
        state.pageNum = 1;
        fitToScreen(activePaneId);
        setupTouchGestures(activePaneId);
    } catch (error) { console.error("PDF Error:", error); }
}

async function fitToScreen(paneId) {
    const state = panesState[paneId];
    const page = await state.pdfDoc.getPage(1);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const wrapperRect = state.wrapper.getBoundingClientRect();
    
    // Fit to width or height perfectly
    const scaleToFit = Math.min(wrapperRect.width / unscaledViewport.width, wrapperRect.height / unscaledViewport.height);
    
    state.scale = scaleToFit;
    state.currentScale = 1.0;
    
    // Center it
    state.posX = (wrapperRect.width - (unscaledViewport.width * scaleToFit)) / 2;
    state.posY = (wrapperRect.height - (unscaledViewport.height * scaleToFit)) / 2;
    
    renderPage(paneId);
}

async function renderPage(paneId) {
    const state = panesState[paneId];
    if (!state.pdfDoc) return;

    const page = await state.pdfDoc.getPage(state.pageNum);
    
    // We render at the exact scale we need for crystal clear quality
    const renderScale = state.scale * state.currentScale; 
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = state.canvas;
    const ctx = canvas.getContext('2d');
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Reset CSS sizing to match physical rendering
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    
    applyTransform(state, true); // True means reset CSS scale to 1 because it's baked into the render

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
}

function applyTransform(state, rendered = false) {
    // If rendered = true, the scale is baked into the canvas.width, so CSS scale is 1.
    // Otherwise, we are mid-pinch, so we apply CSS scale on top of the old image.
    const cssScale = rendered ? 1 : state.currentScale;
    state.canvas.style.transform = `translate(${state.posX}px, ${state.posY}px) scale(${cssScale})`;
}

// Flawless Pinch Math
function setupTouchGestures(paneId) {
    const state = panesState[paneId];
    const wrapper = state.wrapper;
    
    let initialDistance = 0;
    let isPinching = false;
    let startX, startY, initialPosX, initialPosY;
    let pinchCenterX, pinchCenterY;

    wrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPinching = true;
            initialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            
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
            
            // Magic formula to zoom exactly towards the pinch center without jumping
            const newPosX = pinchCenterX - (pinchCenterX - state.posX) * scaleChange;
            const newPosY = pinchCenterY - (pinchCenterY - state.posY) * scaleChange;
            
            state.posX = newPosX;
            state.posY = newPosY;
            state.currentScale = scaleChange;
            
            applyTransform(state, false);
            
            // Update initial values for the NEXT frame of movement
            initialDistance = currentDistance;
            
        } else if (e.touches.length === 1 && !isPinching) {
            state.posX = initialPosX + (e.touches[0].clientX - startX);
            state.posY = initialPosY + (e.touches[0].clientY - startY);
            applyTransform(state, false);
        }
    }, {passive: false});

    wrapper.addEventListener('touchend', (e) => {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            // Bake the temporary CSS zoom into the absolute scale and re-render sharp
            state.scale = state.scale * state.currentScale;
            state.currentScale = 1.0; 
            renderPage(paneId);
        }
    });
}

initApp();
