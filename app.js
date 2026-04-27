pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// --- NEW VFS STRUCTURE ---
let vfs = {
    "root": { id: "root", type: "folder", name: "ראשי", parentId: null }
};

let activePaneId = 1;
let splitMode = false;
let allExpanded = false;
let expandedFolders = new Set(["root"]);

// FIX: המשתנה הזה עבר ללמעלה כדי שלא יקריס את העלאת הקבצים ויצירת התיקיות
let selectedItemId = null; 

const panesState = {
    1: { pdfDoc: null, pageNum: 1, scale: 1.0, currentScale: 1.0, canvas: document.getElementById('pdfCanvas1'), wrapper: document.getElementById('wrapper1'), posX: 0, posY: 0 },
    2: { pdfDoc: null, pageNum: 1, scale: 1.0, currentScale: 1.0, canvas: document.getElementById('pdfCanvas2'), wrapper: document.getElementById('wrapper2'), posX: 0, posY: 0 }
};

const sidebar = document.getElementById('sidebar');
const fileTree = document.getElementById('fileTree');
const contextMenu = document.getElementById('contextMenu');
const moveModal = document.getElementById('moveModal');

async function initApp() {
    const savedVFS = await localforage.getItem('vfsDB');
    if (savedVFS && savedVFS["root"]) {
        vfs = savedVFS;
    }
    renderFileTree();
}

async function saveVFS() { await localforage.setItem('vfsDB', vfs); }

// --- UI Logic ---
document.getElementById('menuToggle').onclick = () => sidebar.classList.add('open');
document.getElementById('closeSidebar').onclick = () => sidebar.classList.remove('open');

document.getElementById('splitScreenBtn').onclick = () => {
    splitMode = !splitMode;
    document.getElementById('pane2').classList.toggle('hidden');
    document.getElementById('splitScreenBtn').classList.toggle('active');
    setActivePane(splitMode ? 2 : 1);
};

document.getElementById('fullScreenBtn').onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(err => console.log(err));
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

document.getElementById('resetZoomBtn').onclick = () => { if(panesState[activePaneId].pdfDoc) fitToScreen(activePaneId); };

window.setActivePane = function(paneId) {
    activePaneId = paneId;
    document.getElementById('pane1').classList.remove('active-pane');
    document.getElementById('pane2').classList.remove('active-pane');
    document.getElementById(`pane${paneId}`).classList.add('active-pane');
};

document.getElementById('listViewBtn').onclick = () => { fileTree.className = 'file-tree list-view'; document.getElementById('listViewBtn').classList.add('active'); document.getElementById('gridViewBtn').classList.remove('active'); };
document.getElementById('gridViewBtn').onclick = () => { fileTree.className = 'file-tree grid-view'; document.getElementById('gridViewBtn').classList.add('active'); document.getElementById('listViewBtn').classList.remove('active'); };

document.getElementById('expandCollapseBtn').onclick = () => {
    allExpanded = !allExpanded;
    if(allExpanded) {
        Object.keys(vfs).forEach(id => { if(vfs[id].type === 'folder') expandedFolders.add(id); });
        document.getElementById('expandCollapseBtn').innerHTML = '<span class="material-icons">unfold_less</span>';
    } else {
        expandedFolders.clear();
        expandedFolders.add("root");
        document.getElementById('expandCollapseBtn').innerHTML = '<span class="material-icons">unfold_more</span>';
    }
    renderFileTree();
};

// --- PDF Thumbnail Generator ---
async function generateThumbnail(arrayBuffer) {
    try {
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const canvas = document.createElement('canvas');
        const viewport = page.getViewport({ scale: 0.3 });
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        return canvas.toDataURL('image/jpeg', 0.6);
    } catch(e) { return null; }
}

// --- Upload Logic ---
document.getElementById('uploadFab').onclick = () => document.getElementById('fileInput').click();

document.getElementById('fileInput').onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // Always upload to the currently focused folder, or root if none
    const targetParent = (selectedItemId && vfs[selectedItemId] && vfs[selectedItemId].type === 'folder') ? selectedItemId : "root";

    for (let file of files) {
        const fileId = 'file_' + Date.now() + Math.floor(Math.random()*1000);
        const arrayBuffer = await file.arrayBuffer();
        await localforage.setItem(fileId, arrayBuffer);
        
        const thumbData = await generateThumbnail(arrayBuffer);

        vfs[fileId] = { id: fileId, type: 'file', name: file.name, parentId: targetParent, thumb: thumbData };
    }
    
    expandedFolders.add(targetParent); 
    await saveVFS();
    renderFileTree();
};

document.getElementById('newFolderBtn').onclick = () => {
    const folderName = prompt("שם התיקייה החדשה:");
    if (folderName) {
        const folderId = 'folder_' + Date.now();
        const targetParent = (selectedItemId && vfs[selectedItemId] && vfs[selectedItemId].type === 'folder') ? selectedItemId : "root";
        vfs[folderId] = { id: folderId, type: 'folder', name: folderName, parentId: targetParent };
        expandedFolders.add(targetParent);
        saveVFS();
        renderFileTree();
    }
};

// --- Tree View Rendering ---
function renderFileTree() {
    fileTree.innerHTML = '';
    renderNode("root", fileTree);
}

function renderNode(nodeId, container) {
    const children = Object.values(vfs).filter(n => n.parentId === nodeId);
    
    children.forEach(child => {
        const div = document.createElement('div');
        div.className = 'tree-node';
        
        if (child.type === 'folder') {
            const isOpen = expandedFolders.has(child.id);
            div.innerHTML = `
                <div class="item folder" onclick="toggleFolder('${child.id}')">
                    <div class="item-info">
                        <span class="material-icons folder-toggle ${isOpen ? 'open' : ''}">chevron_left</span>
                        <span class="material-icons">folder</span> 
                        <span class="name">${child.name}</span>
                    </div>
                    <div class="item-actions"><span class="material-icons more-btn" onclick="showContextMenu(event, '${child.id}')">more_vert</span></div>
                </div>
                <div class="tree-children ${isOpen ? 'open' : ''}" id="children_${child.id}"></div>
            `;
            container.appendChild(div);
            renderNode(child.id, document.getElementById(`children_${child.id}`));
        } else {
            const thumbHtml = child.thumb ? `<img src="${child.thumb}" class="pdf-thumb">` : '';
            div.innerHTML = `
                <div class="item file">
                    ${thumbHtml}
                    <div class="item-info" onclick="openFile('${child.id}')">
                        <span class="material-icons pdf-icon-default">picture_as_pdf</span> 
                        <span class="name">${child.name}</span>
                    </div>
                    <div class="item-actions"><span class="material-icons more-btn" onclick="showContextMenu(event, '${child.id}')">more_vert</span></div>
                </div>
            `;
            container.appendChild(div);
        }
    });
}

window.toggleFolder = function(folderId) {
    if(expandedFolders.has(folderId)) expandedFolders.delete(folderId);
    else expandedFolders.add(folderId);
    selectedItemId = folderId; 
    renderFileTree();
};

window.openFile = function(fileId) {
    loadPdfToActivePane(fileId);
    if(window.innerWidth < 768) sidebar.classList.remove('open');
};

// --- Context Menu & Nested Move Logic ---
window.showContextMenu = function(e, id) {
    e.stopPropagation();
    selectedItemId = id; 
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.classList.remove('hidden');
};

document.addEventListener('click', () => contextMenu.classList.add('hidden'));

document.getElementById('menuDelete').onclick = async () => {
    if(confirm('למחוק?')) {
        await deleteNodeAndChildren(selectedItemId);
        await saveVFS(); renderFileTree();
    }
};

async function deleteNodeAndChildren(nodeId) {
    const children = Object.values(vfs).filter(n => n.parentId === nodeId);
    for(let child of children) await deleteNodeAndChildren(child.id);
    if(vfs[nodeId].type === 'file') await localforage.removeItem(nodeId);
    delete vfs[nodeId];
}

document.getElementById('menuRename').onclick = async () => {
    const newName = prompt('הכנס שם חדש:', vfs[selectedItemId].name);
    if(newName) {
        vfs[selectedItemId].name = newName;
        await saveVFS(); renderFileTree();
    }
};

// פונקציה חכמה שמונעת ממך להכניס תיקייה לתוך עצמה או לתוך ילדיה
function isDescendant(potentialChildId, potentialParentId) {
    let current = vfs[potentialChildId];
    while (current && current.parentId) {
        if (current.parentId === potentialParentId) return true;
        current = vfs[current.parentId];
    }
    return false;
}

document.getElementById('menuMove').onclick = () => {
    const select = document.getElementById('folderSelect');
    select.innerHTML = '<option value="root">ראשי</option>';
    
    Object.values(vfs).forEach(node => {
        if(node.type === 'folder' && node.id !== 'root' && node.id !== selectedItemId) {
            // מאפשר הצגת תיקייה רק אם היא לא הילד של התיקייה שאנחנו מעבירים
            if (!isDescendant(node.id, selectedItemId)) {
                select.innerHTML += `<option value="${node.id}">${node.name}</option>`;
            }
        }
    });
    moveModal.classList.remove('hidden');
};

document.getElementById('cancelMoveBtn').onclick = () => moveModal.classList.add('hidden');
document.getElementById('confirmMoveBtn').onclick = async () => {
    const targetFolderId = document.getElementById('folderSelect').value;
    if(targetFolderId !== vfs[selectedItemId].parentId) {
        vfs[selectedItemId].parentId = targetFolderId;
        expandedFolders.add(targetFolderId); 
        await saveVFS();
        renderFileTree();
    }
    moveModal.classList.add('hidden');
};

// --- PERFECTED PINCH TO ZOOM MATH ---
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
    
    const scaleToFit = Math.min(wrapperRect.width / unscaledViewport.width, wrapperRect.height / unscaledViewport.height);
    
    state.scale = scaleToFit;
    state.currentScale = 1.0;
    
    state.posX = (wrapperRect.width - (unscaledViewport.width * scaleToFit)) / 2;
    state.posY = (wrapperRect.height - (unscaledViewport.height * scaleToFit)) / 2;
    
    renderPage(paneId);
}

async function renderPage(paneId) {
    const state = panesState[paneId];
    if (!state.pdfDoc) return;

    const page = await state.pdfDoc.getPage(state.pageNum);
    const renderScale = state.scale * state.currentScale; 
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = state.canvas;
    const ctx = canvas.getContext('2d');
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    
    applyTransform(state, true); 

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
}

function applyTransform(state, rendered = false) {
    const cssScale = rendered ? 1 : state.currentScale;
    state.canvas.style.transform = `translate(${state.posX}px, ${state.posY}px) scale(${cssScale})`;
}

function setupTouchGestures(paneId) {
    const state = panesState[paneId];
    const wrapper = state.wrapper;
    
    let initialDistance = 0;
    let isPinching = false;
    let startX, startY;
    let initialPosX, initialPosY; 
    let pinchCenterX, pinchCenterY;

    wrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            isPinching = true;
            initialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            
            const rect = wrapper.getBoundingClientRect();
            pinchCenterX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
            pinchCenterY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;

            initialPosX = state.posX;
            initialPosY = state.posY;

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
            
            state.posX = pinchCenterX - (pinchCenterX - initialPosX) * scaleChange;
            state.posY = pinchCenterY - (pinchCenterY - initialPosY) * scaleChange;
            state.currentScale = scaleChange;
            
            applyTransform(state, false);
            
        } else if (e.touches.length === 1 && !isPinching) {
            state.posX = initialPosX + (e.touches[0].clientX - startX);
            state.posY = initialPosY + (e.touches[0].clientY - startY);
            applyTransform(state, false);
        }
    }, {passive: false});

    wrapper.addEventListener('touchend', (e) => {
        if (isPinching && e.touches.length < 2) {
            isPinching = false;
            state.scale = state.scale * state.currentScale;
            state.currentScale = 1.0; 
            renderPage(paneId);
        }
    });
}

initApp();
