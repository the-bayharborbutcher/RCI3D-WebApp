// ============================================
// RCI3D - MAIN APP SCRIPT (Fixed & Complete)
// ============================================

// Global state
let currentPrinter = null;

// Keep window.currentPrinter in sync so mqtt.js can always read it
Object.defineProperty(window, 'currentPrinter', {
    get: () => currentPrinter,
    set: (v) => { currentPrinter = v; },
    configurable: true
});
let printers = {};
let tempChart = null;
let currentPath = '/';
let realTimeInterval = null;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('RCI3D script.js initializing...');
    setupNavigation();

    // Show dashboard by default (it's already in HTML)
    const dashboard = document.getElementById('dashboard-section');
    if (dashboard) {
        dashboard.style.display = 'block';
        dashboard.classList.add('active-page');
    }

    updateConnectionStatus(false); // Offline by default
});

// ============================================
// REAL-TIME UPDATES (called after login)
// ============================================

function startRealTimeUpdates() {
    console.log('Starting real-time updates...');
    clearInterval(realTimeInterval);
    // Si une imprimante est déjà sélectionnée, connecter MQTT immédiatement
    if (currentPrinter) {
        connectMQTTForPrinter(currentPrinter);
    }
}

/**
 * Charge les infos d'une imprimante depuis Firebase
 * puis initialise la connexion MQTT vers son broker
 */
function connectMQTTForPrinter(printerId) {
    const uid = window.currentUser && window.currentUser.uid;
    if (!uid || typeof database === 'undefined') return;

    database.ref(`users/${uid}/printers/${printerId}`).once('value')
        .then(snap => {
            const printer = snap.val();
            if (!printer || !printer.url) return;

            // Utiliser mqttHost stocké dans Firebase, ou extraire depuis l'URL
            let brokerHost = printer.mqttHost || '10.29.43.197';
            // Fallback: extraire le hostname de l'URL OctoPrint
            if (!brokerHost) {
                try { brokerHost = new URL(printer.url).hostname; }
                catch(e) { brokerHost = '10.29.43.197'; }
            }
            const brokerPort = printer.mqttPort || 9001;

            console.log(`[MQTT] Connecting to ws://${brokerHost}:${brokerPort}`);
            if (typeof window.initMQTT === 'function') {
                window.initMQTT(brokerHost, brokerPort, printerId, printer.mqttTopic || 'octoPrint');
            } else {
                console.error('[MQTT] initMQTT not ready — mqtt.js chargé ?');
            }
        })
        .catch(err => console.error('[MQTT] Failed to load printer data:', err));
}

// ============================================
// NAVIGATION — THE CORE FIX
// ============================================

function setupNavigation() {
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();

            // Update active nav item
            document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
            this.closest('li').classList.add('active');

            // Navigate
            const section = this.getAttribute('href').replace('#', '');
            navigateTo(section);
        });
    });
}

function navigateTo(section) {
    console.log('Navigating to:', section);
    const t = (typeof I18N !== 'undefined' && I18N[window.currentLang || 'fr']) || {};

    const titles = {
        dashboard: [t.dashboard || 'Dashboard',          t.dashboard_desc || 'Monitor your 3D printers'],
        printers:  [t.printers  || 'Printers',           t.printers_desc  || 'Manage your printers'],
        files:     [t.files     || 'Files',              t.files_desc     || 'Manage your G-code files'],
        history:   [t.history   || 'History',            t.history_desc   || 'View print history'],
        settings:  [t.settings  || 'Settings',           t.settings_desc  || 'Configure preferences'],
    };

    const [title, desc] = titles[section] || ['Dashboard', ''];
    document.getElementById('pageTitle').textContent       = title;
    document.getElementById('pageDescription').textContent = desc;

    hideAllSections();

    switch(section) {
        case 'dashboard': showDashboard(); break;
        case 'printers':  showPrinters();  break;
        case 'files':     showFiles();     break;
        case 'history':   showHistory();   break;
        case 'settings':  showSettings();  break;
        default:          showDashboard();
    }
}

function hideAllSections() {
    document.querySelectorAll('.page-content').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('active-page');
    });
}

function showSection(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = 'block';
        el.classList.add('active-page');
    }
}

// ============================================
// BUILD SECTION HELPER
// ============================================

function buildSection(id, html) {
    let section = document.getElementById(id);
    if (!section) {
        section = document.createElement('div');
        section.id = id;
        section.className = 'page-content';
        section.innerHTML = html;
        document.getElementById('pageContentContainer').appendChild(section);
    }
    return section;
}

// ============================================
// DASHBOARD
// ============================================

function showDashboard() {
    showSection('dashboard-section');
    // Initialiser le graphique Chart.js et Smart Preheat au premier affichage
    setTimeout(() => {
        initTempChart();
        // Injecter le Smart Preheat Panel
        if (window.injectPreheatPanel) {
            window.injectPreheatPanel();
            console.log('✅ Smart Preheat Panel injected');
        } else {
            console.warn('⚠️ injectPreheatPanel not available yet');
        }
    }, 150);
    updateDashboardData();
}

function updateDashboardData() {
    if (!currentPrinter) return;
    // Les mises à jour temps réel sont gérées par MQTT (mqtt.js)
    // Cette fonction reste pour des rafraîchissements manuels
    if (!window.mqttConnected || !window.mqttConnected()) {
        connectMQTTForPrinter(currentPrinter);
    }
}

/**
 * Initialise le graphique Chart.js des températures
 */
function initTempChart() {
    const canvas = document.getElementById('tempChart');
    if (!canvas || !window.Chart) return;
    if (window.tempChartInstance) {
        window.tempChartInstance.destroy();
    }
    window.tempChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels  : [],
            datasets: [
                {
                    label          : 'Hotend (°C)',
                    data           : [],
                    borderColor    : '#e74c3c',
                    backgroundColor: 'rgba(231,76,60,0.08)',
                    tension        : 0.4,
                    pointRadius    : 0,
                    borderWidth    : 2,
                    fill           : true,
                },
                {
                    label          : 'Bed (°C)',
                    data           : [],
                    borderColor    : '#3498db',
                    backgroundColor: 'rgba(52,152,219,0.08)',
                    tension        : 0.4,
                    pointRadius    : 0,
                    borderWidth    : 2,
                    fill           : true,
                }
            ]
        },
        options: {
            responsive         : true,
            maintainAspectRatio: false,
            animation          : { duration: 0 },
            plugins: {
                legend: { position: 'top', labels: { font: { size: 12 } } },
                title : {
                    display: true,
                    text   : 'Temperature History (live)',
                    font   : { size: 14 }
                }
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 8, font: { size: 10 } },
                    grid : { color: 'rgba(0,0,0,0.05)' }
                },
                y: {
                    min  : 0,
                    max  : 280,
                    ticks: { font: { size: 11 } },
                    title: { display: true, text: '°C' }
                }
            }
        }
    });

    // Enregistrer la fonction de mise à jour pour mqtt.js
    window.updateTempChart = function(history) {
        if (!window.tempChartInstance) return;
        window.tempChartInstance.data.labels              = [...history.labels];
        window.tempChartInstance.data.datasets[0].data    = [...history.hotend];
        window.tempChartInstance.data.datasets[1].data    = [...history.bed];
        window.tempChartInstance.update('none'); // 'none' = pas d'animation pour perf
    };
}

// ============================================
// PRINTERS PAGE
// ============================================

function showPrinters() {
    showSection('printers-section');
    const section = document.getElementById('printers-section');
    if (section && !section.querySelector('.page-header')) {
        section.innerHTML = getPrintersHTML();
    }
    loadPrintersList();
    loadPrinterStats();
}

function getPrintersHTML() {
    const t = (typeof I18N !== 'undefined' && I18N[window.currentLang || 'fr']) || {};
    return `
        <div class="page-header">
            <h2>${t.printers || 'Imprimantes'}</h2>
            <p>${t.printers_desc || 'Configurer et surveiller vos imprimantes'}</p>
            <button class="btn-primary" onclick="showAddPrinterModal()">
                <i class="fas fa-plus"></i> ${t.add_printer || 'Ajouter'}
            </button>
        </div>

        <div class="printers-grid" id="printersGrid">
            <div class="empty-state">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Loading printers...</p>
            </div>
        </div>

        <div class="printer-history-section">
            <h3><i class="fas fa-chart-bar" style="color:#667eea;margin-right:8px;"></i> Overall Statistics</h3>
            <div class="history-stats-grid" id="printerStats">
                <div class="stat-card"><div class="stat-info"><h3>Total Print Time</h3><p id="totalPrintTime">--</p></div></div>
                <div class="stat-card"><div class="stat-info"><h3>Total Prints</h3><p id="totalPrintsCount">--</p></div></div>
                <div class="stat-card"><div class="stat-info"><h3>Filament Used</h3><p id="totalFilamentUsed">--</p></div></div>
                <div class="stat-card"><div class="stat-info"><h3>Success Rate</h3><p id="successRate">--</p></div></div>
            </div>
        </div>
    `;
}

function loadPrintersList() {
    const grid = document.getElementById('printersGrid');
    if (!grid) return;

    // Load from Firebase if user is logged in
    const uid = window.currentUser && window.currentUser.uid;
    if (uid && typeof database !== 'undefined' && database) {
        database.ref(`users/${uid}/printers`).once('value').then(snapshot => {
            const data = snapshot.val();
            if (data && Object.keys(data).length > 0) {
                renderPrinterCards(Object.entries(data).map(([id, p]) => ({ id, ...p })));
            } else {
                grid.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-print"></i>
                        <p>No printers added yet.<br>Click "Add New Printer" to get started.</p>
                    </div>
                `;
            }
        }).catch(() => renderMockPrinters(grid));
    } else {
        renderMockPrinters(grid);
    }
}

function renderMockPrinters(grid) {
    grid.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-print"></i>
            <p>No printers added yet.<br>Click "Add New Printer" to get started.</p>
        </div>
    `;
}

function renderPrinterCards(printerList) {
    const grid = document.getElementById('printersGrid');
    if (!grid) return;

    if (!printerList.length) {
        grid.innerHTML = `<div class="empty-state"><i class="fas fa-print"></i><p>No printers found.</p></div>`;
        return;
    }

    // Render cards immediately with "checking..." state, then ping each
    grid.innerHTML = printerList.map(p => `
        <div class="printer-card checking" id="pcard-${p.id}">
            <div class="printer-header">
                <i class="fas fa-print"></i>
                <h3>${p.name}</h3>
                <span class="status-badge checking" id="sbadge-${p.id}">
                    <i class="fas fa-spinner fa-spin" style="font-size:10px;"></i> checking...
                </span>
            </div>
            <div class="printer-details">
                <p><i class="fas fa-link"></i> ${p.url || 'Not configured'}</p>
                <p><i class="fas fa-microchip"></i> <span id="sver-${p.id}">—</span></p>
            </div>
            <div class="printer-stats">
                <div class="stat"><span>Total Prints</span><strong>${p.totalPrints || 0}</strong></div>
                <div class="stat"><span>Filament</span><strong>${p.filamentUsed || 0}g</strong></div>
                <div class="stat"><span>Success</span><strong>${p.successfulPrints || 0}</strong></div>
                <div class="stat"><span>Rate</span><strong>${p.totalPrints ? Math.round((p.successfulPrints/p.totalPrints)*100) : 0}%</strong></div>
            </div>
            <div class="printer-actions">
                <button class="btn-select" onclick="selectPrinter('${p.id}', '${p.name}')">
                    <i class="fas fa-check-circle"></i> Select
                </button>
                <button class="btn-delete-printer" onclick="deletePrinter('${p.id}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');

    // Ping each printer in parallel
    printerList.forEach(p => pingPrinter(p));
}

/**
 * Pings OctoPrint /api/version to determine real online/offline status.
 * Updates the card and badge in place — no full re-render.
 */
async function pingPrinter(p) {
    const card  = document.getElementById(`pcard-${p.id}`);
    const badge = document.getElementById(`sbadge-${p.id}`);
    const verEl = document.getElementById(`sver-${p.id}`);

    if (!p.url || !p.apiKey) {
        setStatus(card, badge, 'offline');
        return;
    }

    try {
        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const res = await fetch(`${p.url}/api/version`, {
            headers: { 'X-Api-Key': p.apiKey },
            signal:  controller.signal
        });
        clearTimeout(timeout);

        if (res.ok) {
            const data = await res.json();
            setStatus(card, badge, 'online');
            if (verEl) verEl.textContent = `OctoPrint v${data.server || '?'}`;
        } else {
            setStatus(card, badge, 'error', `HTTP ${res.status}`);
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            setStatus(card, badge, 'offline', 'Timeout');
        } else {
            setStatus(card, badge, 'offline', 'Unreachable');
        }
    }
}

function setStatus(card, badge, status, detail) {
    if (!card || !badge) return;

    // Update card class
    card.classList.remove('online', 'offline', 'error', 'checking');
    card.classList.add(status);

    // Update badge
    badge.className = `status-badge ${status}`;
    const icons = { online: '🟢', offline: '🔴', error: '🟡' };
    badge.innerHTML = `${icons[status] || ''} ${status}${detail ? ` <small style="opacity:0.7">(${detail})</small>` : ''}`;
}

function loadPrinterStats() {
    // Aggregate stats from all printers
    const uid = window.currentUser && window.currentUser.uid;
    if (uid && typeof database !== 'undefined' && database) {
        database.ref(`users/${uid}/printers`).once('value').then(snapshot => {
            const data = snapshot.val() || {};
            const printerList = Object.values(data);
            const totalPrints    = printerList.reduce((s,p) => s + (p.totalPrints||0), 0);
            const totalFilament  = printerList.reduce((s,p) => s + (p.filamentUsed||0), 0);
            const totalSuccess   = printerList.reduce((s,p) => s + (p.successfulPrints||0), 0);
            const totalTime      = printerList.reduce((s,p) => s + (p.totalPrintTime||0), 0);

            const el = id => document.getElementById(id);
            if (el('totalPrintsCount'))  el('totalPrintsCount').textContent  = totalPrints;
            if (el('totalFilamentUsed')) el('totalFilamentUsed').textContent = totalFilament + 'g';
            if (el('successRate'))       el('successRate').textContent       = totalPrints ? Math.round((totalSuccess/totalPrints)*100)+'%' : '0%';
            if (el('totalPrintTime'))    el('totalPrintTime').textContent    = Math.round(totalTime/3600) + 'h';
        });
    } else {
        const el = id => document.getElementById(id);
        if (el('totalPrintsCount'))  el('totalPrintsCount').textContent  = '0';
        if (el('totalFilamentUsed')) el('totalFilamentUsed').textContent = '0g';
        if (el('successRate'))       el('successRate').textContent       = '--%';
        if (el('totalPrintTime'))    el('totalPrintTime').textContent    = '0h';
    }
}

// ============================================
// FILES PAGE
// ============================================

function showFiles() {
    showSection('files-section');
    const section = document.getElementById('files-section');
    if (section && !section.querySelector('.page-header')) {
        section.innerHTML = getFilesHTML();
    }
    loadFileBrowser();
}

function getFilesHTML() {
    const t = (typeof I18N !== 'undefined' && I18N[window.currentLang || 'fr']) || {};
    return `
        <div class="page-header">
            <h2>${t.files || 'Fichiers'}</h2>
            <p>${t.files_desc || 'Gérer vos fichiers G-code'}</p>
        </div>

        <div class="file-toolbar">
            <button class="btn-primary" onclick="uploadFile()">
                <i class="fas fa-upload"></i> ${t.upload || 'Envoyer G-code'}
            </button>
            <button class="btn-secondary" onclick="createFolder()">
                <i class="fas fa-folder-plus"></i> ${t.new_folder || 'Nouveau dossier'}
            </button>
            <button class="btn-secondary" onclick="fetchOctoPrintFiles(currentPath)" title="Actualiser" style="min-width:42px;padding:11px 14px;">
                <i class="fas fa-sync-alt"></i>
            </button>
            <div class="file-search">
                <i class="fas fa-search"></i>
                <input type="text" placeholder="${t.search || 'Chercher...'}" oninput="searchFiles(this.value)">
            </div>
        </div>

        <div class="file-browser">
            <div class="breadcrumb" id="fileBreadcrumb">
                <i class="fas fa-home"></i> Root
            </div>
            <div class="file-list-header">
                <span>Name</span>
                <span>Size</span>
                <span>Modified</span>
                <span>Actions</span>
            </div>
            <div class="file-grid" id="fileGrid">
                <div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading files...</p></div>
            </div>
        </div>

    `;
}

function loadFileBrowser() {
    const grid = document.getElementById('fileGrid');
    if (!grid) return;

    // Load real files from OctoPrint if a printer is selected
    if (currentPrinter) {
        fetchOctoPrintFiles();
    } else {
        grid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-print"></i>
                <p>Select a printer first to browse its files.</p>
            </div>
        `;
    }
}

function fetchOctoPrintFiles(folderPath) {
    const grid = document.getElementById('fileGrid');
    if (!grid) return;

    grid.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Chargement des fichiers...</p></div>`;

    const uid = window.currentUser && window.currentUser.uid;
    if (!uid || typeof database === 'undefined') { showEmptyFiles(grid); return; }

    database.ref(`users/${uid}/printers/${currentPrinter}`).once('value').then(snapshot => {
        const printer = snapshot.val();
        if (!printer || !printer.url || !printer.apiKey) { showEmptyFiles(grid); return; }

        // Build correct API URL
        // For root: /api/files/local?recursive=false
        // For folder: /api/files/local/FolderName
        let apiUrl;
        if (folderPath && folderPath !== '/') {
            const clean = folderPath.replace(/^\//, '').replace(/^local\//, '');
            apiUrl = `${printer.url}/api/files/local/${encodeURIComponent(clean)}`;
        } else {
            apiUrl = `${printer.url}/api/files/local`;
        }

        fetch(apiUrl, { headers: { 'X-Api-Key': printer.apiKey } })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(data => {
            // OctoPrint returns { files: [...] } at root, or { children: [...] } for folders
            const files = data.files || data.children || [];
            if (!files.length) { showEmptyFiles(grid); return; }
            renderRealFiles(files, grid);
        })
        .catch(err => {
            console.error('[Files]', err);
            grid.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#e74c3c;"></i><p>Erreur: ${err.message}<br><small>Vérifiez que l'imprimante est connectée à OctoPrint.</small></p></div>`;
        });
    }).catch(() => showEmptyFiles(grid));
}

function showEmptyFiles(grid) {
    if (!grid) grid = document.getElementById('fileGrid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-folder-open"></i>
            <p>No files found.<br>Upload a G-code file to get started.</p>
        </div>
    `;
}

function renderRealFiles(files, grid) {
    grid.innerHTML = files.map(f => {
        const isFolder = f.type === 'folder';
        const size = f.size ? (f.size / 1048576).toFixed(2) + ' MB' : '--';
        const date = f.date ? new Date(f.date * 1000).toLocaleDateString('fr-FR') : '--';
        const safeName = f.name.replace(/'/g, "\\'");
        const safePath = (f.path || ('local/' + f.name)).replace(/'/g, "\\'");
        return `
            <div class="file-item ${isFolder ? 'folder' : 'file'}">
                <span class="file-name">
                    <i class="fas fa-${isFolder ? 'folder' : 'file-code'}" style="color:${isFolder ? '#f39c12' : '#667eea'};margin-right:8px;"></i>
                    ${f.name}
                </span>
                <span class="file-size">${size}</span>
                <span class="file-modified">${date}</span>
                <span class="file-actions">
                    ${isFolder
                        ? `<button class="file-btn" onclick="openFolder('${safeName}')" title="Ouvrir"><i class="fas fa-folder-open"></i></button>`
                        : `<button class="file-btn load-btn" onclick="loadFileOnPrinter('${safePath}', '${safeName}')" title="Charger sur l'imprimante">
                                <i class="fas fa-upload"></i> Charger
                           </button>
                           <button class="file-btn print-btn" onclick="loadAndPrintFile('${safePath}', '${safeName}')" title="Imprimer directement">
                                <i class="fas fa-play"></i> Imprimer
                           </button>
                           <button class="file-btn del-btn" onclick="deleteOctoPrintFile('${safePath}', '${safeName}')" title="Supprimer">
                                <i class="fas fa-trash"></i>
                           </button>`
                    }
                </span>
            </div>
        `;
    }).join('');
}

let allFiles = [];

function searchFiles(query) {
    // Filter file items by name
    document.querySelectorAll('.file-item').forEach(item => {
        const name = item.querySelector('.file-name').textContent.toLowerCase();
        item.style.display = name.includes(query.toLowerCase()) ? '' : 'none';
    });
}

// ============================================
// HISTORY PAGE
// ============================================

function showHistory() {
    showSection('history-section');
    const section = document.getElementById('history-section');
    if (section && !section.querySelector('.page-header')) {
        section.innerHTML = getHistoryHTML();
    }
    loadPrintHistory();
}

function getHistoryHTML() {
    const t = (typeof I18N !== 'undefined' && I18N[window.currentLang || 'fr']) || {};
    return `
        <div class="page-header">
            <h2>${t.history || 'Historique'}</h2>
            <p>${t.history_desc || "Voir vos travaux d'impression"}</p>
        </div>

        <div class="history-filters">
            <select id="historyPrinterFilter" onchange="filterHistory()">
                <option value="">${t.all_printers || 'Toutes les imprimantes'}</option>
            </select>
            <select id="historyStatusFilter" onchange="filterHistory()">
                <option value="">${t.all_status || 'Tous les statuts'}</option>
                <option value="success">${t.status_success || 'Succès'}</option>
                <option value="failed">${t.status_failed || 'Échoué'}</option>
                <option value="cancelled">${t.status_cancelled || 'Annulé'}</option>
            </select>
            <input type="date" id="historyDateFilter" onchange="filterHistory()">
        </div>

        <div class="history-stats">
            <div class="stat-card"><div class="stat-info"><h3>Total Prints</h3><p id="historyTotalPrints">0</p></div></div>
            <div class="stat-card"><div class="stat-info"><h3>Success Rate</h3><p id="historySuccessRate">--%</p></div></div>
            <div class="stat-card"><div class="stat-info"><h3>Total Filament</h3><p id="historyTotalFilament">0g</p></div></div>
            <div class="stat-card"><div class="stat-info"><h3>Total Time</h3><p id="historyTotalTime">0h</p></div></div>
        </div>

        <div class="history-list" id="historyList">
            <div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading history...</p></div>
        </div>
    `;
}

function loadPrintHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;

    // Load from Firebase if available
    const uid = window.currentUser && window.currentUser.uid;
    if (uid && typeof database !== 'undefined' && database) {
        database.ref(`users/${uid}/printHistory`).limitToLast(50).once('value').then(snapshot => {
            const data = snapshot.val();
            if (data) {
                const historyItems = Object.values(data).reverse();
                renderHistoryList(historyItems);
            } else {
                renderMockHistory(list);
            }
        }).catch(() => renderMockHistory(list));
    } else {
        renderMockHistory(list);
    }
}

function renderMockHistory(list) {
    list.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-history"></i>
            <p>No print history yet.<br>Your completed prints will appear here.</p>
        </div>
    `;
}

function renderHistoryList(items) {
    const list = document.getElementById('historyList');
    if (!list) return;

    if (!items.length) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-history"></i><p>No print history yet.</p></div>`;
        return;
    }

    list.innerHTML = items.map(item => `
        <div class="history-item ${item.status}" data-status="${item.status}" data-printer="${item.printer}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:5px;">
                <div>
                    <h4><i class="fas fa-file-code" style="color:#667eea;margin-right:7px;"></i>${item.fileName}</h4>
                    <p><i class="fas fa-print" style="margin-right:5px;"></i>${item.printer} &nbsp;·&nbsp; <i class="fas fa-calendar" style="margin-right:4px;"></i>${item.date}</p>
                    <p><i class="fas fa-clock" style="margin-right:5px;"></i>${item.duration} &nbsp;·&nbsp; <i class="fas fa-weight" style="margin-right:4px;"></i>${item.filament}</p>
                </div>
                <span class="history-badge ${item.status}">${item.status}</span>
            </div>
        </div>
    `).join('');
}

function filterHistory() {
    const printerFilter = document.getElementById('historyPrinterFilter').value.toLowerCase();
    const statusFilter  = document.getElementById('historyStatusFilter').value.toLowerCase();

    document.querySelectorAll('.history-item').forEach(item => {
        const matchesPrinter = !printerFilter || item.dataset.printer.toLowerCase().includes(printerFilter);
        const matchesStatus  = !statusFilter  || item.dataset.status === statusFilter;
        item.style.display = (matchesPrinter && matchesStatus) ? '' : 'none';
    });
}

// ============================================
// SETTINGS PAGE
// ============================================

function showSettings() {
    showSection('settings-section');
    const section = document.getElementById('settings-section');
    if (section && !section.querySelector('.page-header')) {
        section.innerHTML = getSettingsHTML();
    }
    loadUserSettings();
    loadUserPreferences();
}

function getSettingsHTML() {
    const t  = (typeof I18N !== 'undefined' && I18N[window.currentLang || 'fr']) || {};
    const lang = window.currentLang || 'fr';
    const unit = window.tempUnit    || 'celsius';
    return `
        <div class="page-header">
            <h2>${t.settings || 'Paramètres'}</h2>
            <p>${t.settings_desc || 'Configurer vos préférences'}</p>
        </div>

        <div class="settings-container">

            <!-- Personal Information -->
            <div class="settings-card">
                <h3><i class="fas fa-user"></i> ${t.personal_info || 'Informations personnelles'}</h3>
                <div class="settings-form">
                    <div class="form-group">
                        <label>${t.full_name || 'Nom complet'}</label>
                        <input type="text" id="settingsName" placeholder="${t.your_name || 'Votre nom'}">
                    </div>
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" id="settingsEmail" placeholder="votre@email.com" readonly style="background:#f9f9f9;">
                    </div>
                    <button class="btn-save" onclick="savePersonalInfo()">
                        <i class="fas fa-save"></i> ${t.save_changes || 'Enregistrer'}
                    </button>
                </div>
            </div>

            <!-- Change Password -->
            <div class="settings-card">
                <h3><i class="fas fa-lock"></i> ${t.change_pwd || 'Changer le mot de passe'}</h3>
                <div class="settings-form">
                    <div class="form-group">
                        <label>${t.current_pwd || 'Mot de passe actuel'}</label>
                        <input type="password" id="currentPassword" placeholder="••••••••">
                    </div>
                    <div class="form-group">
                        <label>${t.new_pwd || 'Nouveau mot de passe'}</label>
                        <input type="password" id="newPassword" placeholder="••••••••">
                    </div>
                    <div class="form-group">
                        <label>${t.confirm_pwd || 'Confirmer le mot de passe'}</label>
                        <input type="password" id="confirmPassword" placeholder="••••••••">
                    </div>
                    <button class="btn-save" onclick="changePassword()">
                        <i class="fas fa-key"></i> ${t.update_pwd || 'Mettre à jour'}
                    </button>
                </div>
            </div>

            <!-- Language & Preferences -->
            <div class="settings-card">
                <h3><i class="fas fa-globe"></i> ${t.lang_prefs || 'Langue & Préférences'}</h3>
                <div class="settings-form">
                    <div class="form-group">
                        <label>${t.language || 'Langue'}</label>
                        <select id="settingsLanguage">
                            <option value="en" ${lang==='en'?'selected':''}>🇬🇧 English</option>
                            <option value="fr" ${lang==='fr'?'selected':''}>🇫🇷 Français</option>
                            <option value="es" ${lang==='es'?'selected':''}>🇪🇸 Español</option>
                            <option value="ar" ${lang==='ar'?'selected':''}>🇩🇿 العربية</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>${t.temp_unit || 'Unité de température'}</label>
                        <select id="tempUnit">
                            <option value="celsius"    ${unit==='celsius'?'selected':''}>Celsius (°C)</option>
                            <option value="fahrenheit" ${unit==='fahrenheit'?'selected':''}>Fahrenheit (°F)</option>
                        </select>
                    </div>
                    <button class="btn-save" onclick="saveLanguageSettings()">
                        <i class="fas fa-save"></i> ${t.save_prefs || 'Sauvegarder'}
                    </button>
                </div>
            </div>

            <!-- About -->
            <div class="settings-card">
                <h3><i class="fas fa-info-circle"></i> ${t.about || 'À propos de RCI3D'}</h3>
                <div style="color:#666;font-size:14px;line-height:1.8;">
                    <p><strong>Version:</strong> 2.0.0</p>
                    <p><strong>Studio:</strong> RCI3D Studio</p>
                    <p><strong>Platform:</strong> OctoPrint Integration</p>
                    <p style="margin-top:10px;">Remote control and monitoring for your 3D printers via OctoPrint API.</p>
                </div>
            </div>

        </div>
    `;
}

function loadUserSettings() {
    const user = window.currentUser;
    if (!user) return;

    const nameEl  = document.getElementById('settingsName');
    const emailEl = document.getElementById('settingsEmail');
    if (nameEl)  nameEl.value  = user.displayName || '';
    if (emailEl) emailEl.value = user.email || '';
}

// ============================================
// ADD PRINTER
// ============================================

function showAddPrinterModal() {
    // Check printer count limit
    const uid = window.currentUser && window.currentUser.uid;
    if (uid && typeof database !== 'undefined' && database) {
        database.ref(`users/${uid}/printers`).once('value').then(snap => {
            const count = snap.val() ? Object.keys(snap.val()).length : 0;
            if (count >= 3) {
                showNotification('⚠️ Maximum 3 imprimantes autorisées.', 'warning');
                return;
            }
            _openAddPrinterModal();
        });
    } else {
        _openAddPrinterModal();
    }
}

function _openAddPrinterModal() {
    // Auto-fill MQTT topic based on existing count
    const uid = window.currentUser && window.currentUser.uid;
    if (uid && typeof database !== 'undefined' && database) {
        database.ref(`users/${uid}/printers`).once('value').then(snap => {
            const count = snap.val() ? Object.keys(snap.val()).length : 0;
            const topicEl = document.getElementById('mqttTopic');
            if (topicEl) topicEl.value = count === 0 ? 'octoPrint' : `octoPrint${count + 1}`;
            const urlEl = document.getElementById('printerUrl');
            const portMap = { 0: '5000', 1: '5001', 2: '5002' };
            if (urlEl) urlEl.placeholder = `http://10.29.43.197:${portMap[count] || '5000'}`;
        });
    }
    const modal = document.getElementById('addPrinterModal');
    if (modal) modal.style.display = 'flex';
}

function closeModal() {
    const modal = document.getElementById('addPrinterModal');
    if (modal) modal.style.display = 'none';
}

function submitAddPrinter(e) {
    e.preventDefault();

    const name  = document.getElementById('printerName').value.trim();
    const url   = document.getElementById('printerUrl').value.trim();
    const key   = document.getElementById('apiKey').value.trim();
    const topic = document.getElementById('mqttTopic').value.trim() || 'octoPrint';

    const uid = window.currentUser && window.currentUser.uid;
    if (uid && typeof database !== 'undefined' && database) {
        const newPrinterRef = database.ref(`users/${uid}/printers`).push();
        // Récupérer mqttHost/Port depuis le formulaire (ou dériver de l'URL)
        const mqttHostVal = (document.getElementById('mqttHost') || {}).value || '10.29.43.197';
        const mqttPortVal = parseInt((document.getElementById('mqttPort') || {}).value) || 9001;

        newPrinterRef.set({
            name, url, apiKey: key, mqttTopic: topic,
            mqttHost: mqttHostVal,
            mqttPort: mqttPortVal,
            addedAt: Date.now(),
            totalPrints: 0,
            filamentUsed: 0,
            successfulPrints: 0,
        }).then(() => {
            showNotification(`Imprimante "${name}" ajoutée !`, 'success');
            closeModal();
            document.getElementById('addPrinterForm').reset();
            if (document.getElementById('printersGrid')) loadPrintersList();
            // Reload ALL printers to rebuild tabs correctly
            database.ref(`users/${uid}/printers`).once('value').then(snap => {
                const all = snap.val() || {};
                updatePrinterSelector(all);
            });
        }).catch(err => showNotification('Erreur ajout: ' + err.message, 'error'));
    } else {
        showNotification(`Printer "${name}" saved locally.`, 'success');
        closeModal();
        document.getElementById('addPrinterForm').reset();
    }
}

function deletePrinter(id) {
    if (!confirm('Supprimer cette imprimante ?')) return;
    const uid = window.currentUser && window.currentUser.uid;
    if (uid && typeof database !== 'undefined' && database) {
        // If deleting the active printer, disconnect MQTT first
        if (currentPrinter === id) {
            if (window.disconnectMQTT) window.disconnectMQTT();
            currentPrinter = null;
            updateConnectionStatus(false);
        }
        database.ref(`users/${uid}/printers/${id}`).remove()
            .then(() => {
                showNotification('Imprimante supprimée.', 'success');
                loadPrintersList();
                // Reload ALL printers → rebuild dashboard tabs
                database.ref(`users/${uid}/printers`).once('value').then(snap => {
                    const all = snap.val() || {};
                    updatePrinterSelector(all);
                });
            });
    }
}

// ============================================
// PRINTER SELECTOR (Dashboard)
// ============================================

function updatePrinterSelector(printersData) {
    const select = document.getElementById('printerSelect');
    if (!select) return;

    // Keep "Select Printer" option
    select.innerHTML = '<option value="">Select Printer</option>';

    Object.entries(printersData).forEach(([id, printer]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = printer.name;
        select.appendChild(opt);
    });

    // Build visual tabs (max 3)
    buildPrinterTabs(printersData);
}

// Printer tab colors
const PRINTER_COLORS = ['#667eea', '#e74c3c', '#27ae60'];

function buildPrinterTabs(printersData) {
    const tabsEl = document.getElementById('printerTabs');
    if (!tabsEl) return;

    const entries = Object.entries(printersData).slice(0, 3);

    if (!entries.length) {
        tabsEl.innerHTML = `<div class="printer-tab-empty"><i class="fas fa-print"></i> Aucune imprimante — cliquez <b>Ajouter</b></div>`;
        return;
    }

    tabsEl.innerHTML = entries.map(([id, printer], i) => {
        const color  = PRINTER_COLORS[i] || '#667eea';
        const active = currentPrinter === id ? 'active' : '';
        return `
            <button class="printer-tab ${active}" data-id="${id}"
                    onclick="selectPrinterTab('${id}')"
                    style="--tab-color:${color};">
                <span class="tab-dot" id="tabDot_${id}" style="background:#9e9e9e;"></span>
                <span class="tab-name">${escapeHtml(printer.name)}</span>
                <span class="tab-port" style="font-size:10px;opacity:0.6;">${_extractPort(printer.url)}</span>
            </button>
        `;
    }).join('');
}

function _extractPort(url) {
    try { return ':' + new URL(url).port; } catch(e) { return ''; }
}

function selectPrinterTab(id) {
    currentPrinter = id;
    // Sync hidden select
    const sel = document.getElementById('printerSelect');
    if (sel) sel.value = id;
    // Update active state on tabs
    document.querySelectorAll('.printer-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.id === id);
    });
    if (window.disconnectMQTT) window.disconnectMQTT();
    showNotification('Imprimante sélectionnée. Connexion MQTT...', 'info');
    connectMQTTForPrinter(id);
}

function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function changePrinter(id) {
    if (!id) { currentPrinter = null; if (window.disconnectMQTT) window.disconnectMQTT(); updateConnectionStatus(false); return; }
    // Déconnecter le MQTT de l'ancienne imprimante
    if (window.disconnectMQTT) window.disconnectMQTT();
    currentPrinter = id;
    showNotification('Imprimante sélectionnée. Connexion MQTT...', 'info');
    connectMQTTForPrinter(id);
    // NE PAS appeler updateConnectionStatus(false) ici — le statut sera mis à jour par MQTT
}

function selectPrinter(id, name) {
    // Déconnecter MQTT précédent
    if (window.disconnectMQTT) window.disconnectMQTT();
    currentPrinter = id;
    showNotification(`"${name}" selected — connecting MQTT...`, 'success');

    document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
    const dashLink = document.querySelector('.nav-links li[data-section="dashboard"]');
    if (dashLink) dashLink.classList.add('active');

    navigateTo('dashboard');

    const sel = document.getElementById('printerSelect');
    if (sel) sel.value = id;

    // Connexion MQTT vers la nouvelle imprimante
    connectMQTTForPrinter(id);
}

// ============================================
// DASHBOARD COMMANDS
// ============================================

function sendCommand(cmd) {
    if (!currentPrinter) {
        showNotification('Please select a printer first.', 'warning');
        return;
    }
    switch(cmd) {
        case 'start'  : window.cmdStartPrint();  break;
        case 'pause'  : window.cmdPausePrint();  break;
        case 'resume' : window.cmdResumePrint(); break;
        case 'cancel' : window.cmdCancelPrint(); break;
        case 'stop'   : window.cmdCancelPrint(); break;
        case 'home'   : window.cmdHomePrinter(); break;
        default: showNotification(`Unknown command: ${cmd}`, 'error');
    }
}

function move(axis, distance) {
    if (!currentPrinter) { showNotification('Please select a printer first.', 'warning'); return; }
    window.cmdMove(axis, distance);
}

function setTemp(heater, temp) {
    if (!currentPrinter) { showNotification('Please select a printer first.', 'warning'); return; }
    if (!temp || temp < 0) { showNotification('Invalid temperature', 'error'); return; }
    if (heater === 'bed') {
        window.cmdSetBed(temp);
    } else {
        window.cmdSetHotend(temp);
    }
}

// ============================================
// EXTRUDER CONTROL
// ============================================

let extruderStep = 5; // Default 5mm

function setExtruderStep(btn, distance) {
    // Update active button
    document.querySelectorAll('.extruder-step-selector .step-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    extruderStep = distance;
}

function controlExtruder(action) {
    if (!currentPrinter) {
        showNotification('Please select a printer first.', 'warning');
        return;
    }
    
    if (action === 'extrude') {
        showNotification(`Extruding ${extruderStep}mm...`, 'info');
        window.cmdExtruder(extruderStep);
    } else if (action === 'retract') {
        showNotification(`Retracting ${extruderStep}mm...`, 'info');
        window.cmdExtruder(-extruderStep);
    }
}

function refreshData() {
    // Refresh the currently visible section
    const active = document.querySelector('.page-content.active-page');
    if (!active) return;
    const id = active.id || '';
    if (id.includes('dashboard')) updateDashboardData();
    else if (id.includes('printers')) loadPrintersList();
    else if (id.includes('files'))    fetchOctoPrintFiles(currentPath);
    else if (id.includes('history'))  loadPrintHistory();
    showNotification('Actualisation...', 'info');
}

// Export extruder control functions for global access
window.setExtruderStep = setExtruderStep;
window.controlExtruder = controlExtruder;

// ============================================
// FILE ACTIONS
// ============================================

function uploadFile() {
    if (!currentPrinter) { showNotification('Sélectionne une imprimante d\'abord.', 'warning'); return; }
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.gcode,.gco,.g,.nc';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) window.cmdUploadFile(file, currentPath);
    };
    input.click();
}

async function createFolder() {
    if (!currentPrinter) {
        showNotification('Please select a printer first.', 'warning');
        return;
    }
    const name = prompt('New folder name:');
    if (!name || !name.trim()) return;

    const uid = window.currentUser && window.currentUser.uid;
    if (!uid || typeof database === 'undefined') return;

    try {
        const snap    = await database.ref(`users/${uid}/printers/${currentPrinter}`).once('value');
        const printer = snap.val();
        if (!printer) throw new Error('Printer not found');

        const formData = new FormData();
        formData.append('foldername', name.trim());
        formData.append('path',       currentPath || '/');

        const res = await fetch(`${printer.url}/api/files/local`, {
            method:  'POST',
            headers: { 'X-Api-Key': printer.apiKey },
            body:    formData
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showNotification(`Folder "${name}" created!`, 'success');
        // Reload file list
        fetchOctoPrintFiles();
    } catch (err) {
        showNotification(`Failed to create folder: ${err.message}`, 'error');
    }
}

function navigateToFolder(path) { openFolder(path); }

function openFolder(nameOrPath) {
    if (!currentPrinter) { showNotification('Sélectionne une imprimante.', 'warning'); return; }
    // Update breadcrumb
    currentPath = nameOrPath.startsWith('/') ? nameOrPath : '/' + nameOrPath;
    const bc = document.getElementById('fileBreadcrumb');
    if (bc) bc.innerHTML = `<i class="fas fa-home" onclick="goToRootFolder()" style="cursor:pointer;"></i> / ${nameOrPath}`;
    // Fetch files inside this folder
    fetchOctoPrintFiles(nameOrPath);
}

function goToRootFolder() {
    currentPath = '/';
    const bc = document.getElementById('fileBreadcrumb');
    if (bc) bc.innerHTML = `<i class="fas fa-home"></i> Root`;
    fetchOctoPrintFiles();
}

async function _getPrinterConfig() {
    const uid = window.currentUser && window.currentUser.uid;
    if (!uid || !currentPrinter || typeof database === 'undefined') return null;
    const snap = await database.ref(`users/${uid}/printers/${currentPrinter}`).once('value');
    return snap.val();
}

async function loadFileOnPrinter(filePath, fileName) {
    if (!currentPrinter) { showNotification('Sélectionne une imprimante d\'abord.', 'warning'); return; }
    try {
        const printer = await _getPrinterConfig();
        if (!printer) { showNotification('Imprimante introuvable.', 'error'); return; }
        showNotification(`Chargement de ${fileName}...`, 'info');
        // OctoPrint expects: POST /api/files/local/filename.gcode
        const cleanPath = filePath.startsWith('local/') ? filePath : `local/${filePath.replace(/^\//, '')}`;
        const res = await fetch(`${printer.url}/api/files/${cleanPath}`, {
            method : 'POST',
            headers: { 'X-Api-Key': printer.apiKey, 'Content-Type': 'application/json' },
            body   : JSON.stringify({ command: 'select', print: false })
        });
        if (res.ok) {
            showNotification(`✅ ${fileName} chargé !`, 'success');
        } else {
            const txt = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${txt ? ': ' + txt.slice(0,60) : ''}`);
        }
    } catch (err) {
        showNotification(`Erreur chargement: ${err.message}`, 'error');
    }
}

async function loadAndPrintFile(filePath, fileName) {
    if (!currentPrinter) { showNotification('Sélectionne une imprimante d\'abord.', 'warning'); return; }
    if (!confirm(`Lancer l\'impression de "${fileName}" ?`)) return;
    try {
        const printer = await _getPrinterConfig();
        if (!printer) { showNotification('Imprimante introuvable.', 'error'); return; }
        const cleanPath = filePath.startsWith('local/') ? filePath : `local/${filePath.replace(/^\//, '')}`;
        showNotification(`Démarrage impression de ${fileName}...`, 'info');
        const res = await fetch(`${printer.url}/api/files/${cleanPath}`, {
            method : 'POST',
            headers: { 'X-Api-Key': printer.apiKey, 'Content-Type': 'application/json' },
            body   : JSON.stringify({ command: 'select', print: true })
        });
        if (res.ok) {
            showNotification(`🖨️ Impression démarrée : ${fileName}`, 'success');
        } else {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch (err) {
        showNotification(`Erreur: ${err.message}`, 'error');
    }
}

async function deleteOctoPrintFile(filePath, fileName) {
    if (!currentPrinter) { showNotification('Sélectionne une imprimante d\'abord.', 'warning'); return; }
    if (!confirm(`Supprimer "${fileName}" de l'imprimante ?`)) return;
    try {
        const printer = await _getPrinterConfig();
        if (!printer) { showNotification('Imprimante introuvable.', 'error'); return; }
        const res = await fetch(`${printer.url}/api/files/${filePath}`, {
            method : 'DELETE',
            headers: { 'X-Api-Key': printer.apiKey }
        });
        if (res.ok) {
            showNotification(`🗑️ ${fileName} supprimé.`, 'success');
            fetchOctoPrintFiles();
        } else {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch (err) {
        showNotification(`Erreur suppression: ${err.message}`, 'error');
    }
}

// ============================================
// SETTINGS ACTIONS
// ============================================

function savePersonalInfo() {
    const user = window.currentUser;
    if (!user) return;
    const name = document.getElementById('settingsName').value.trim();
    user.updateProfile({ displayName: name }).then(() => {
        showNotification('Profile updated!', 'success');
        const nameEl = document.getElementById('userName');
        if (nameEl) nameEl.textContent = name;
    }).catch(err => showNotification(err.message, 'error'));
}

function changePassword() {
    const np = document.getElementById('newPassword').value;
    const cp = document.getElementById('confirmPassword').value;
    if (!np) { showNotification('Please enter a new password.', 'error'); return; }
    if (np !== cp) { showNotification('Passwords do not match.', 'error'); return; }
    if (np.length < 6) { showNotification('Password must be at least 6 characters.', 'error'); return; }

    const user = window.currentUser;
    if (!user) return;
    user.updatePassword(np).then(() => {
        showNotification('Password updated successfully!', 'success');
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
    }).catch(err => showNotification(err.message, 'error'));
}

function saveLanguageSettings() {
    const langEl = document.getElementById('settingsLanguage');
    const unitEl = document.getElementById('tempUnit');
    if (!langEl || !unitEl) return;

    const lang = langEl.value;
    const unit = unitEl.value;

    // Save to Firebase so settings persist across devices
    const uid = window.currentUser && window.currentUser.uid;
    if (uid && typeof database !== 'undefined') {
        database.ref(`users/${uid}/preferences`).update({ lang, unit })
            .catch(err => console.error('Prefs save error:', err));
    }

    // Apply immediately to current visible UI
    applyTempUnit(unit);
    applyLanguage(lang);

    // Force all dynamic sections to rebuild on next navigate (clear their content)
    ['printers-section','files-section','history-section','settings-section'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = ''; // will rebuild on next showXxx() call
    });

    const t = (typeof I18N !== 'undefined' && I18N[lang]) || {};
    showNotification(t.prefs_saved || 'Préférences sauvegardées !', 'success');
}

function applyTempUnit(unit) {
    window.tempUnit = unit;
    // Re-render all visible temperature elements that store raw °C in data-raw
    document.querySelectorAll('[data-raw]').forEach(el => {
        const raw = parseFloat(el.dataset.raw);
        if (!isNaN(raw)) {
            el.textContent = formatTemp(raw, unit);
        }
    });
    // Update chart Y-axis label and range
    if (window.tempChartInstance) {
        const maxY = unit === 'fahrenheit' ? 570 : 300;
        window.tempChartInstance.options.scales.y.max = maxY;
        const yTitle = window.tempChartInstance.options.scales.y.title;
        if (yTitle) yTitle.text = unit === 'fahrenheit' ? '°F' : '°C';
        window.tempChartInstance.data.datasets[0].label = `Hotend (°${unit === 'fahrenheit' ? 'F' : 'C'})`;
        window.tempChartInstance.data.datasets[1].label = `Bed (°${unit === 'fahrenheit' ? 'F' : 'C'})`;
        // Convert existing chart data
        if (unit === 'fahrenheit' && window._tempHistoryRaw) {
            window.tempChartInstance.data.datasets[0].data = window._tempHistoryRaw.hotend.map(v => celsiusToFahrenheit(v));
            window.tempChartInstance.data.datasets[1].data = window._tempHistoryRaw.bed.map(v => celsiusToFahrenheit(v));
        }
        window.tempChartInstance.update();
    }
}

// ── UI Translation dictionary ─────────────────────────────
const I18N = {
    en: {
        dashboard: 'Dashboard',       dashboard_desc: 'Monitor and control your 3D printers',
        printers:  'Printers',        printers_desc:  'Configure and monitor all your 3D printers',
        files:     'Files',           files_desc:     'Upload and manage your G-code files',
        history:   'History',         history_desc:   'View all your past prints',
        settings:  'Settings',        settings_desc:  'Configure your preferences',
        nav_dashboard: 'Dashboard',   nav_printers: 'Printers',
        nav_files: 'Files',           nav_history: 'History',  nav_settings: 'Settings',
        add_printer: 'Add',           select_printer: 'Select Printer',
        upload: 'Upload G-code',      new_folder: 'New Folder',
        search: 'Search files...',    hotend: 'Hotend',  bed: 'Bed',
        progress: 'Progress',         print_time: 'Print Time',
        start: 'Start',               pause: 'Pause',    stop: 'Stop',
        home: 'Home',                 resume: 'Resume',
        quick_controls: 'Quick Controls', movement: 'Movement', temperature: 'Temperature',
        extruder: 'Extruder Control',
        logout_confirm: 'Log out?',
        all_printers: 'All Printers',     all_status: 'All Status',
        status_success: 'Success',       status_failed: 'Failed',    status_cancelled: 'Cancelled',
        personal_info:'Personal Information', full_name:'Full Name', your_name:'Your name',
        save_changes:'Save Changes', change_pwd:'Change Password', current_pwd:'Current Password',
        new_pwd:'New Password', confirm_pwd:'Confirm Password', update_pwd:'Update Password',
        lang_prefs:'Language & Preferences', language:'Language', temp_unit:'Temperature Unit',
        save_prefs:'Save Preferences', about:'About RCI3D',
        prefs_saved: 'Preferences saved!',
    },
    fr: {
        dashboard: 'Tableau de bord', dashboard_desc: 'Surveiller et contrôler vos imprimantes 3D',
        printers:  'Imprimantes',     printers_desc:  'Configurer et surveiller vos imprimantes',
        files:     'Fichiers',        files_desc:     'Uploader et gérer vos fichiers G-code',
        history:   'Historique',      history_desc:   'Voir tous vos travaux d\'impression',
        settings:  'Paramètres',      settings_desc:  'Configurer vos préférences',
        nav_dashboard: 'Tableau',     nav_printers: 'Imprimantes',
        nav_files: 'Fichiers',        nav_history: 'Historique', nav_settings: 'Paramètres',
        add_printer: 'Ajouter',       select_printer: 'Choisir imprimante',
        upload: 'Envoyer G-code',     new_folder: 'Nouveau dossier',
        search: 'Chercher...',        hotend: 'Buse',   bed: 'Plateau',
        progress: 'Progression',      print_time: 'Temps d\'impression',
        start: 'Démarrer',            pause: 'Pause',   stop: 'Arrêter',
        home: 'Origine',              resume: 'Reprendre',
        quick_controls: 'Contrôles rapides', movement: 'Mouvement', temperature: 'Température',
        extruder: 'Contrôle extrudeur',
        logout_confirm: 'Se déconnecter ?',
        all_printers: 'Toutes imprimantes', all_status: 'Tous statuts',
        status_success: 'Succès',          status_failed: 'Échoué',   status_cancelled: 'Annulé',
        personal_info:'Informations personnelles', full_name:'Nom complet', your_name:'Votre nom',
        save_changes:'Enregistrer', change_pwd:'Changer le mot de passe', current_pwd:'Mot de passe actuel',
        new_pwd:'Nouveau mot de passe', confirm_pwd:'Confirmer', update_pwd:'Mettre à jour',
        lang_prefs:'Langue & Préférences', language:'Langue', temp_unit:'Unité de température',
        save_prefs:'Sauvegarder', about:'À propos de RCI3D',
        prefs_saved: 'Préférences sauvegardées !',
    },
    es: {
        dashboard: 'Panel',           dashboard_desc: 'Monitorear y controlar sus impresoras',
        printers:  'Impresoras',      printers_desc:  'Configurar y monitorear impresoras',
        files:     'Archivos',        files_desc:     'Subir y gestionar archivos G-code',
        history:   'Historial',       history_desc:   'Ver todos sus trabajos de impresión',
        settings:  'Ajustes',         settings_desc:  'Configurar sus preferencias',
        nav_dashboard: 'Panel',       nav_printers: 'Impresoras',
        nav_files: 'Archivos',        nav_history: 'Historial',  nav_settings: 'Ajustes',
        add_printer: 'Agregar',       select_printer: 'Seleccionar',
        upload: 'Subir G-code',       new_folder: 'Nueva carpeta',
        search: 'Buscar...',          hotend: 'Hotend',  bed: 'Cama',
        progress: 'Progreso',         print_time: 'Tiempo',
        start: 'Iniciar',             pause: 'Pausar',   stop: 'Detener',
        home: 'Inicio',               resume: 'Reanudar',
        quick_controls: 'Controles rápidos', movement: 'Movimiento', temperature: 'Temperatura',
        extruder: 'Control extrusor',
        logout_confirm: '¿Cerrar sesión?',
        all_printers: 'Todas impresoras',   all_status: 'Todos estados',
        status_success: 'Éxito',           status_failed: 'Fallido',  status_cancelled: 'Cancelado',
        personal_info:'Información personal', full_name:'Nombre completo', your_name:'Su nombre',
        save_changes:'Guardar', change_pwd:'Cambiar contraseña', current_pwd:'Contraseña actual',
        new_pwd:'Nueva contraseña', confirm_pwd:'Confirmar', update_pwd:'Actualizar',
        lang_prefs:'Idioma y Preferencias', language:'Idioma', temp_unit:'Unidad de temperatura',
        save_prefs:'Guardar preferencias', about:'Acerca de RCI3D',
        prefs_saved: '¡Preferencias guardadas!',
    },
    ar: {
        dashboard: 'لوحة التحكم',    dashboard_desc: 'مراقبة والتحكم في طابعاتك',
        printers:  'الطابعات',        printers_desc:  'إدارة الطابعات',
        files:     'الملفات',         files_desc:     'إدارة ملفات G-code',
        history:   'السجل',           history_desc:   'عرض سجل الطباعة',
        settings:  'الإعدادات',       settings_desc:  'تكوين التفضيلات',
        nav_dashboard: 'لوحة',        nav_printers: 'طابعات',
        nav_files: 'ملفات',           nav_history: 'سجل',  nav_settings: 'إعدادات',
        add_printer: 'إضافة',         select_printer: 'اختر طابعة',
        upload: 'رفع ملف',            new_folder: 'مجلد جديد',
        search: 'بحث...',             hotend: 'الفوهة',  bed: 'السرير',
        progress: 'التقدم',           print_time: 'وقت الطباعة',
        start: 'بدء',                 pause: 'إيقاف مؤقت', stop: 'إيقاف',
        home: 'الأصل',                resume: 'استئناف',
        quick_controls: 'تحكم سريع', movement: 'حركة', temperature: 'درجة الحرارة',
        extruder: 'تحكم البثق',
        logout_confirm: 'تسجيل الخروج؟',
        all_printers: 'كل الطابعات',         all_status: 'كل الحالات',
        status_success: 'نجاح',            status_failed: 'فشل',      status_cancelled: 'ملغى',
        personal_info:'معلومات شخصية', full_name:'الاسم الكامل', your_name:'اسمك',
        save_changes:'حفظ', change_pwd:'تغيير كلمة المرور', current_pwd:'كلمة المرور الحالية',
        new_pwd:'كلمة مرور جديدة', confirm_pwd:'تأكيد', update_pwd:'تحديث',
        lang_prefs:'اللغة والتفضيلات', language:'اللغة', temp_unit:'وحدة الحرارة',
        save_prefs:'حفظ التفضيلات', about:'حول RCI3D',
        prefs_saved: 'تم حفظ التفضيلات!',
    }
};

window.currentLang = 'fr'; // default

function applyLanguage(lang) {
    window.currentLang = lang || 'fr';
    const t = I18N[lang] || I18N['fr'];
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';

    // Nav links
    const navMap = {
        dashboard: t.nav_dashboard, printers: t.nav_printers,
        files: t.nav_files, history: t.nav_history, settings: t.nav_settings
    };
    document.querySelectorAll('.nav-links li[data-section]').forEach(li => {
        const sec  = li.dataset.section;
        const link = li.querySelector('a');
        if (link && navMap[sec]) {
            const icon = link.querySelector('i');
            link.textContent = ' ' + navMap[sec];
            if (icon) link.prepend(icon);
        }
    });

    // Header title (if on a known page)
    const pageTitle = document.getElementById('pageTitle');
    const pageDesc  = document.getElementById('pageDescription');
    if (pageTitle && t[pageTitle.textContent.toLowerCase()]) {
        // update current page title on the fly
    }

    // Stat card labels
    const statLabels = document.querySelectorAll('.stat-info h3');
    const labelMap = ['hotend','bed','progress','print_time'];
    statLabels.forEach((el, i) => {
        if (t[labelMap[i]]) el.textContent = t[labelMap[i]];
    });

    // Control buttons
    const btnMap = { start: t.start, pause: t.pause, stop: t.stop, home: t.home, resume: t.resume };
    document.querySelectorAll('.control-btn[onclick]').forEach(btn => {
        const match = (btn.getAttribute('onclick') || '').match(/sendCommand\('(\w+)'\)/);
        if (match && btnMap[match[1]]) {
            const icon = btn.querySelector('i');
            btn.textContent = ' ' + btnMap[match[1]];
            if (icon) btn.prepend(icon);
        }
    });

    // Section headers in control panel
    document.querySelectorAll('.control-panel h2').forEach(el => { el.textContent = t.quick_controls || el.textContent; });
    document.querySelectorAll('.control-panel h3').forEach((el, i) => {
        const keys = ['movement', 'temperature', 'extruder'];
        if (t[keys[i]]) el.textContent = t[keys[i]];
    });

    // Add printer button
    const addBtn = document.querySelector('.btn-add-printer');
    if (addBtn && t.add_printer) {
        addBtn.innerHTML = `<i class="fas fa-plus"></i> ${t.add_printer}`;
    }

    // Upload button
    const uploadBtn = document.querySelector('.btn-primary[onclick="uploadFile()"]');
    if (uploadBtn && t.upload) uploadBtn.innerHTML = `<i class="fas fa-upload"></i> ${t.upload}`;

    // Search placeholder
    const searchInp = document.querySelector('.file-search input');
    if (searchInp && t.search) searchInp.placeholder = t.search;

    // Page header titles (section pages rebuild on navigate, so store lang pref globally)
    // They read window.currentLang when building HTML
}

/** Convert Celsius to Fahrenheit */
function celsiusToFahrenheit(c) {
    return (c * 9 / 5) + 32;
}

/** Format temp according to current unit preference */
function formatTemp(celsius, unit) {
    unit = unit || window.tempUnit || 'celsius';
    if (unit === 'fahrenheit') {
        return `${celsiusToFahrenheit(celsius).toFixed(1)}°F`;
    }
    return `${celsius.toFixed(1)}°C`;
}
window.formatTemp = formatTemp;

/** Load user preferences from Firebase and apply */
function loadUserPreferences() {
    const uid = window.currentUser && window.currentUser.uid;
    if (!uid || typeof database === 'undefined') return;
    database.ref(`users/${uid}/preferences`).once('value').then(snap => {
        const prefs = snap.val();
        if (!prefs) return;
        if (prefs.unit) {
            window.tempUnit = prefs.unit;
            const unitEl = document.getElementById('tempUnit');
            if (unitEl) unitEl.value = prefs.unit;
            applyTempUnit(prefs.unit);
        }
        if (prefs.lang) {
            const langEl = document.getElementById('settingsLanguage');
            if (langEl) langEl.value = prefs.lang;
            applyLanguage(prefs.lang);
        }
    }).catch(() => {});
}
window.loadUserPreferences = loadUserPreferences;

// ============================================
// CONNECTION STATUS
// ============================================

function updateConnectionStatus(connected) {
    const el  = document.getElementById('connectionStatus');
    const dot = el && el.querySelector('.status-dot');
    if (dot) dot.style.background = connected ? '#4caf50' : '#9e9e9e';
    if (el)  el.title = connected ? 'MQTT Connecté' : 'MQTT Déconnecté';
}

// Close modal when clicking outside
window.addEventListener('click', function(e) {
    const modal = document.getElementById('addPrinterModal');
    if (modal && e.target === modal) closeModal();
});

// ============================================
// GLOBAL EXPORTS
// ============================================

window.navigateTo          = navigateTo;
window.refreshData         = refreshData;
window.changePrinter       = changePrinter;
window.selectPrinter       = selectPrinter;
window.showAddPrinterModal = showAddPrinterModal;
window.closeModal          = closeModal;
window.submitAddPrinter    = submitAddPrinter;
window.deletePrinter       = deletePrinter;
window.sendCommand         = sendCommand;
window.move                = move;
window.setTemp             = setTemp;
window.uploadFile          = uploadFile;
window.createFolder        = createFolder;
window.navigateToFolder    = navigateToFolder;
window.openFolder          = openFolder;
window.goToRootFolder      = goToRootFolder;
window.navigateToFolder    = navigateToFolder;
window.fetchOctoPrintFiles = fetchOctoPrintFiles;
window.printFile           = loadAndPrintFile; // alias
window.searchFiles         = searchFiles;
window.filterHistory       = filterHistory;
window.savePersonalInfo    = savePersonalInfo;
window.changePassword      = changePassword;
window.saveLanguageSettings= saveLanguageSettings;
window.connectMQTTForPrinter = connectMQTTForPrinter;
window.initTempChart         = initTempChart;
window.saveLanguageSettings  = saveLanguageSettings;
window.updatePrinterSelector = updatePrinterSelector;
window.startRealTimeUpdates  = startRealTimeUpdates;
window.selectPrinterTab      = selectPrinterTab;
window.buildPrinterTabs      = buildPrinterTabs;
window.loadFileOnPrinter     = loadFileOnPrinter;
window.loadAndPrintFile      = loadAndPrintFile;
window.deleteOctoPrintFile   = deleteOctoPrintFile;

console.log('✅ script.js loaded successfully');
