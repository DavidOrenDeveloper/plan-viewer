pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// --- State Management ---
let virtualFileSystem = { "root": {} }; // structure: { folderName: { fileId: metadata } }
let currentPath = "root";
let activePaneId = 1;
let splitMode = false;

const panesState = {
    1: { pdfDoc: null, pageNum: 1, scale: 1.0, currentScale: 1.0, canvas: document.getElementById('pdfCanvas1'), wrapper: document.getElementById('wrapper1'), posX: 0, posY: 0 },
    2: { pdfDoc: null, pageNum: 1, scale: 1.0, currentScale: 1.0, canvas: document.getElementById('pdfCanvas2'), wrapper: document.getElementById('wrapper2'), posX: 0, posY: 0 }
};

// --- UI Elements ---
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');
const closeSidebarBtn = document.getElementById('closeSidebar');
const splitScreenBtn = document.getElementById('splitScreenBtn');
const fullScreenBtn = document.getElementById('fullScreenBtn');
const fileTree = document.getElementById('fileTree');
const uploadFab = document.getElementById('uploadFab');
const fileInput = document.getElementById('fileInput');
const newFolderBtn = document.getElementById('newFolderBtn');
const goBackBtn = document.getElementById('goBackBtn');
const listViewBtn = document.getElementById('listViewBtn');
const gridViewBtn = document.getElementById('gridViewBtn');
const contextMenu = document.getElementById('contextMenu');

// --- Initialization & Storage (IndexedDB via localForage) ---
async function initApp() {
    const savedVFS = await localforage.getItem('vfs');
    if (savedVFS) virtualFileSystem = savedVFS;
    renderFileTree();
}

async function saveVFS() {
    await localforage.setItem('vfs', virtualFileSystem);
}

// --- UI Interactions ---
menuToggle.onclick = () => sidebar.classList.add('open');
closeSidebarBtn.onclick = () => sidebar.classList.remove('open');

splitScreenBtn.onclick = () => {
    splitMode = !splitMode;
    document.getElementById('pane2').classList.toggle('hidden');
    splitScreenBtn.classList.toggle('active');
    setActivePane(splitMode ? 2 : 1);
};

fullScreenBtn.onclick = () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
};

window.setActivePane = function(paneId) {
    activePaneId = paneId;
    document.getElementById('pane1').classList.remove('active-pane');
    document.getElementById('pane2').classList.remove('active-pane');
    document.getElementById(`pane${paneId}`).classList.add('active-pane');
    if(window.innerWidth < 768) sidebar.classList.remove('open'); // Auto close on mobile
};

// View Toggles
listViewBtn.onclick = () => { fileTree.className = 'file-tree list-view'; listViewBtn.classList.add('active'); gridViewBtn.classList.remove('active'); };
gridViewBtn.onclick = () => { fileTree.className = 'file-tree grid-view'; gridViewBtn.classList.add('active'); listViewBtn.classList.remove('active'); };

// --- File System Logic ---
newFolderBtn.onclick = () => {
    const folderName = prompt("שם התיקייה החדשה:");
    if (folderName && !virtualFileSystem[folderName]) {
        virtualFileSystem[folderName] = {};
        saveVFS();
        renderFileTree();
    }
};

uploadFab.onclick = () => fileInput.click();

fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileId = 'file_' + Date.now();
    const arrayBuffer = await file.arrayBuffer(); // Get binary data
    
    // Save binary data to IndexedDB
    await localforage.setItem(fileId, arrayBuffer);
    
    // Update VFS metadata
    if(!virtualFileSystem[currentPath]) virtualFileSystem[currentPath] = {};
    virtualFileSystem[currentPath][fileId] = { name: file.name, type: 'pdf' };
    
    await saveVFS();
    renderFileTree();
};

function renderFileTree() {
    fileTree.innerHTML = '';
    
    if (currentPath !== "root") {
        goBackBtn.style.display = 'block';
        goBackBtn.onclick = () => { currentPath = "root"; renderFileTree(); };
    } else {
        goBackBtn.style.display = 'none';
    }

    const currentItems = virtualFileSystem[currentPath] || {};

    // Render Folders (only in root for this simple VFS)
    if (currentPath === "root") {
        Object.keys(virtualFileSystem).forEach(key => {
            if (key === "root") return;
            const div = document.createElement('div');
            div.className = 'item folder';
            div.innerHTML = `
                <div class="item-info"><span class="material-icons">folder</span> <span class="name">${key}</span></div>
                <div class="item-actions"><span class="material-icons more-btn">more_vert</span></div>
            `;
            div.onclick = (e) => { if(!e.target.closest('.more-btn')){ currentPath = key; renderFileTree(); } };
            // Add Context Menu listener here in full implementation
            fileTree.appendChild(div);
        });
    }

    // Render Files
    Object.entries(currentItems).forEach(([id, meta]) => {
        const div = document.createElement('div');
        div.className = 'item file';
        div.innerHTML = `
            <div class="item-info"><span class="material-icons">picture_as_pdf</span> <span class="name">${meta.name}</span></div>
            <div class="item-actions"><span class="material-icons more-btn" onclick="showContextMenu(event, '${id}', '${meta.name}')">more_vert</span></div>
        `;
        div.onclick = (e) => { if(!e.target.closest('.more-btn')) loadPdfToActivePane(id); };
        fileTree.appendChild(div);
    });
}

// --- Context Menu Logic ---
let selectedItemId = null;
window.showContextMenu = function(e, id, name) {
    e.stopPropagation();
    selectedItemId = id;
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.classList.remove('hidden');
};

document.addEventListener('click', () => contextMenu.classList.add('hidden'));

document.getElementById('menuDelete').onclick = async () => {
    if(confirm('למחוק קובץ זה?')) {
        delete virtualFileSystem[currentPath][selectedItemId];
        await localforage.removeItem(selectedItemId);
        await saveVFS();
        renderFileTree();
    }
};

// --- PDF Rendering & Pinch-to-Zoom Touch Logic ---
async function loadPdfToActivePane(fileId) {
    const state = panesState[activePaneId];
    try {
        // Fetch binary from IndexedDB
        const fileData = await localforage.getItem(fileId);
        if (!fileData) return alert("קובץ לא נמצא");

        const loadingTask = pdfjsLib.getDocument({ data: fileData });
        state.pdfDoc = await loadingTask.promise;
        state.pageNum = 1;
        state.scale = 1.0;
        state.posX = 0; state.posY = 0;
        
        setupTouchGestures(activePaneId);
        renderPage(activePaneId);
    } catch (error) {
        console.error("Error loading PDF:", error);
    }
}

async function renderPage(paneId) {
    const state = panesState[paneId];
    if (!state.pdfDoc) return;

    const page = await state.pdfDoc.getPage(state.pageNum);
    
    // Base resolution calculation based on device pixel ratio
    const outputScale = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: state.scale });

    const canvas = state.canvas;
    const ctx = canvas.getContext('2d');
    
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + "px";
    canvas.style.height = Math.floor(viewport.height) + "px";
    
    // Reset temporary CSS transforms used during pinch
    canvas.style.transform = `translate(${state.posX}px, ${state.posY}px) scale(1)`;

    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    await page.render({ canvasContext: ctx, transform: transform, viewport: viewport }).promise;
}

// --- Multi-touch Gestures (Pan & Pinch) ---
function setupTouchGestures(paneId) {
    const state = panesState[paneId];
    const wrapper = state.wrapper;
    const canvas = state.canvas;
    
    let initialDistance = 0;
    let initialScale = state.scale;
    let isPinching = false;
    
    let startX, startY;
    let initialPosX, initialPosY;

    wrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPinching = true;
            initialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            initialScale = state.scale;
        } else if (e.touches.length === 1) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            initialPosX = state.posX;
            initialPosY = state.posY;
        }
    }, {passive: false});

    wrapper.addEventListener('touchmove', (e) => {
        e.preventDefault(); // Stop native scrolling
        
        if (e.touches.length === 2 && isPinching) {
            // Pinch to Zoom (Visual feedback only via CSS for speed)
            const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            const scaleChange = currentDistance / initialDistance;
            let tempScale = initialScale * scaleChange;
            
            // Apply visual transform instantly without heavy re-rendering
            canvas.style.transform = `translate(${state.posX}px, ${state.posY}px) scale(${scaleChange})`;
            state.currentScale = tempScale; // Save for touchend
            
        } else if (e.touches.length === 1 && !isPinching) {
            // Pan (Move around)
            const deltaX = e.touches[0].clientX - startX;
            const deltaY = e.touches[0].clientY - startY;
            state.posX = initialPosX + deltaX;
            state.posY = initialPosY + deltaY;
            canvas.style.transform = `translate(${state.posX}px, ${state.posY}px) scale(1)`;
        }
    }, {passive: false});

    wrapper.addEventListener('touchend', (e) => {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            // On release, set the new logical scale and trigger a sharp high-res re-render
            state.scale = state.currentScale;
            // Prevent going too small
            if(state.scale < 0.5) state.scale = 0.5;
            if(state.scale > 15) state.scale = 15; 
            
            renderPage(paneId);
        }
    });
}

// Start App
initApp();
