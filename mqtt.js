// ============================================================
// RCI3D — mqtt.js
// MQTT over WebSocket via Eclipse Paho JS client
// Broker : Mosquitto sur Raspberry Pi (port 9001 WS)
// Topics : octoPrint/# (plugin OctoPrint-MQTT)
// ============================================================

// ── Constantes des topics MQTT ────────────────────────────
const MQTT_TOPICS = {
    // Températures (publiées toutes les ~1s par le plugin)
    HOTEND_ACTUAL : 'octoPrint/temperature/tool0/actual',
    HOTEND_TARGET : 'octoPrint/temperature/tool0/target',
    BED_ACTUAL    : 'octoPrint/temperature/bed/actual',
    BED_TARGET    : 'octoPrint/temperature/bed/target',

    // Progression de l'impression
    PROGRESS      : 'octoPrint/progress/printing',   // 0-100
    TIME_LEFT     : 'octoPrint/progress/left',        // secondes restantes
    TIME_SPENT    : 'octoPrint/progress/spent',       // secondes écoulées

    // Événements (payload = JSON)
    EVENT_PRINT_STARTED  : 'octoPrint/event/PrintStarted',
    EVENT_PRINT_DONE     : 'octoPrint/event/PrintDone',
    EVENT_PRINT_FAILED   : 'octoPrint/event/PrintFailed',
    EVENT_PRINT_CANCELLED: 'octoPrint/event/PrintCancelled',
    EVENT_PRINT_PAUSED   : 'octoPrint/event/PrintPaused',
    EVENT_PRINT_RESUMED  : 'octoPrint/event/PrintResumed',

    // Statut général
    CONNECTED     : 'octoPrint/event/Connected',
    DISCONNECTED  : 'octoPrint/event/Disconnected',
};

// ── État global MQTT ──────────────────────────────────────
let mqttClient       = null;   // Instance Paho.MQTT.Client
let mqttConnected    = false;  // État de la connexion
let mqttPrinterData  = {};     // Dernières données reçues par printerId
let mqttReconnectTimer = null; // Timer de reconnexion automatique
let mqttCurrentPrinterId = null; // Imprimante active surveillée

// Historique températures pour le graphique (max 60 points)
const TEMP_HISTORY_MAX = 60;
const tempHistory = {
    labels    : [],   // timestamps formatés
    hotend    : [],   // températures buse
    bed       : [],   // températures plateau
};

// ── Initialisation ────────────────────────────────────────
/**
 * Initialise et connecte le client MQTT
 * @param {string} brokerHost  - IP ou hostname du Raspberry Pi (ex: "192.168.1.100")
 * @param {number} brokerPort  - Port WebSocket Mosquitto (défaut: 9001)
 * @param {string} printerId   - ID Firebase de l'imprimante active
 * @param {string} mqttTopic   - Préfixe topic configuré dans OctoPrint-MQTT (ex: "octoPrint")
 */
function initMQTT(brokerHost, brokerPort, printerId, mqttTopic) {
    // Déconnecter proprement si déjà connecté
    if (mqttClient && mqttConnected) {
        mqttClient.disconnect();
    }
    clearTimeout(mqttReconnectTimer);

    mqttCurrentPrinterId = printerId;

    // Recalculer les topics avec le préfixe personnalisé
    const prefix = mqttTopic || 'octoPrint';
    const topics = buildTopics(prefix);

    // Identifiant unique client (évite les conflits si plusieurs onglets)
    const clientId = 'rci3d_' + Math.random().toString(16).substr(2, 8);

    // Créer le client Paho MQTT over WebSocket
    mqttClient = new Paho.MQTT.Client(brokerHost, Number(brokerPort), clientId);

    // ── Callbacks ────────────────────────────────────────
    mqttClient.onConnectionLost = function(responseObject) {
        mqttConnected = false;
        updateMQTTStatus('disconnected');
        console.warn('[MQTT] Connection lost:', responseObject.errorMessage);

        // Reconnexion automatique après 5 secondes
        mqttReconnectTimer = setTimeout(() => {
            console.log('[MQTT] Attempting reconnect...');
            connectMQTT(topics);
        }, 5000);
    };

    mqttClient.onMessageArrived = function(message) {
        handleMQTTMessage(message.destinationName, message.payloadString);
    };

    connectMQTT(topics);
}

/**
 * Construit les topics avec le préfixe personnalisé
 */
function buildTopics(prefix) {
    return {
        HOTEND_ACTUAL : `${prefix}/temperature/tool0/actual`,
        HOTEND_TARGET : `${prefix}/temperature/tool0/target`,
        BED_ACTUAL    : `${prefix}/temperature/bed/actual`,
        BED_TARGET    : `${prefix}/temperature/bed/target`,
        PROGRESS      : `${prefix}/progress/printing`,
        TIME_LEFT     : `${prefix}/progress/left`,
        TIME_SPENT    : `${prefix}/progress/spent`,
        EVENTS        : `${prefix}/event/+`,       // wildcard tous les events
        ALL           : `${prefix}/#`,             // wildcard tout (pour debug)
    };
}

/**
 * Lance la connexion MQTT
 */
function connectMQTT(topics) {
    updateMQTTStatus('connecting');

    mqttClient.connect({
        timeout      : 10,
        keepAliveInterval: 30,
        cleanSession : true,
        useSSL       : false,   // true si broker avec certificat SSL
        onSuccess    : function() {
            mqttConnected = true;
            updateMQTTStatus('connected');
            console.log('[MQTT] Connected to broker');
            window.showNotification('MQTT connected — Live data active', 'success');

            // S'abonner aux topics
            Object.values(topics).forEach(topic => {
                mqttClient.subscribe(topic, { qos: 0 });
                console.log('[MQTT] Subscribed to:', topic);
            });
        },
        onFailure    : function(err) {
            mqttConnected = false;
            updateMQTTStatus('disconnected');
            console.error('[MQTT] Connection failed:', err.errorMessage);
            window.showNotification('MQTT connection failed — check broker IP/port', 'error');

            // Retry après 10s
            mqttReconnectTimer = setTimeout(() => connectMQTT(topics), 10000);
        }
    });
}

// ── Traitement des messages reçus ─────────────────────────
/**
 * Dispatch chaque message MQTT vers la bonne fonction de mise à jour UI
 */
function handleMQTTMessage(topic, payload) {
    const val = parseFloat(payload);

    // Températures
    if (topic.includes('/temperature/tool0/actual')) {
        updateHotendActual(val);
        addTempHistoryPoint('hotend', val);
        return;
    }
    if (topic.includes('/temperature/tool0/target')) {
        updateHotendTarget(val);
        return;
    }
    if (topic.includes('/temperature/bed/actual')) {
        updateBedActual(val);
        addTempHistoryPoint('bed', val);
        return;
    }
    if (topic.includes('/temperature/bed/target')) {
        updateBedTarget(val);
        return;
    }

    // Progression
    if (topic.includes('/progress/printing')) {
        updateProgress(val);
        return;
    }
    if (topic.includes('/progress/left')) {
        updateTimeLeft(val);
        return;
    }
    if (topic.includes('/progress/spent')) {
        updateTimeSpent(val);
        return;
    }

    // Événements
    if (topic.includes('/event/')) {
        handlePrintEvent(topic, payload);
        return;
    }
}

// ── Mises à jour de l'interface (Dashboard) ───────────────
function updateHotendActual(temp) {
    const el = document.getElementById('hotendTemp');
    if (el) {
        el.dataset.raw  = temp; // store raw °C for unit switching
        el.textContent  = window.formatTemp ? window.formatTemp(temp) : `${temp.toFixed(1)}°C`;
        el.style.color  = temp > 180 ? '#e74c3c' : temp > 50 ? '#f39c12' : '#2ecc71';
    }
}

function updateHotendTarget(temp) {
    const el   = document.getElementById('hotendTarget');
    const disp = window.formatTemp ? window.formatTemp(temp) : `${temp.toFixed(0)}°C`;
    if (el) el.textContent = `Target: ${disp}`;
}

function updateBedActual(temp) {
    const el = document.getElementById('bedTemp');
    if (el) {
        el.dataset.raw  = temp;
        el.textContent  = window.formatTemp ? window.formatTemp(temp) : `${temp.toFixed(1)}°C`;
        el.style.color  = temp > 50 ? '#e74c3c' : temp > 30 ? '#f39c12' : '#2ecc71';
    }
}

function updateBedTarget(temp) {
    const el   = document.getElementById('bedTarget');
    const disp = window.formatTemp ? window.formatTemp(temp) : `${temp.toFixed(0)}°C`;
    if (el) el.textContent = `Target: ${disp}`;
}

function updateProgress(pct) {
    // Carte stat
    const elCard = document.getElementById('printProgress');
    if (elCard) elCard.textContent = `${pct.toFixed(1)}%`;
    // Barre de progression + pourcentage
    const elPct  = document.getElementById('printProgressPct');
    if (elPct)  elPct.textContent = `${pct.toFixed(1)}%`;
    const bar    = document.getElementById('progressBarFill');
    if (bar) {
        bar.style.width = `${pct}%`;
        bar.style.background = pct === 100
            ? 'linear-gradient(90deg, #2ecc71, #27ae60)'
            : 'linear-gradient(90deg, #667eea, #764ba2)';
    }
}

function updateTimeLeft(seconds) {
    const formatted = (() => {
        if (!seconds || seconds <= 0) return '--:--';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0
            ? `${h}h ${String(m).padStart(2,'0')}m`
            : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    })();
    const el1 = document.getElementById('timeLeft');
    const el2 = document.getElementById('timeLeftCard');
    if (el1) el1.textContent = formatted;
    if (el2) el2.textContent = formatted;
}

function updateTimeSpent(seconds) {
    const el = document.getElementById('printTime');
    if (!el) return;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    el.textContent = `${h}h ${String(m).padStart(2,'0')}m`;
}

// ── Gestion des événements d'impression ───────────────────
function handlePrintEvent(topic, payload) {
    let data = {};
    try { data = JSON.parse(payload); } catch(e) {}

    if (topic.includes('PrintStarted')) {
        updatePrintStatus('Printing', '#2ecc71');
        window.showNotification(`Print started: ${data.name || ''}`, 'success');
    }
    else if (topic.includes('PrintDone')) {
        updatePrintStatus('Complete', '#667eea');
        updateProgress(100);
        window.showNotification(`Print complete! ${data.name || ''}`, 'success');
        // Sauvegarder dans Firebase history
        savePrintHistoryToFirebase(data, 'success');
    }
    else if (topic.includes('PrintFailed')) {
        updatePrintStatus('Failed', '#e74c3c');
        window.showNotification(`Print failed: ${data.name || ''}`, 'error');
        savePrintHistoryToFirebase(data, 'failed');
    }
    else if (topic.includes('PrintCancelled')) {
        updatePrintStatus('Cancelled', '#e67e22');
        window.showNotification('Print cancelled', 'warning');
        savePrintHistoryToFirebase(data, 'cancelled');
    }
    else if (topic.includes('PrintPaused')) {
        updatePrintStatus('Paused', '#f39c12');
        window.showNotification('Print paused', 'info');
    }
    else if (topic.includes('PrintResumed')) {
        updatePrintStatus('Printing', '#2ecc71');
        window.showNotification('Print resumed', 'success');
    }
    else if (topic.includes('Connected')) {
        updateMQTTStatus('connected');
    }
    else if (topic.includes('Disconnected')) {
        updateMQTTStatus('disconnected');
    }
}

function updatePrintStatus(text, color) {
    const el = document.getElementById('printStatus');
    if (el) { el.textContent = text; el.style.color = color; }
    // Mettre à jour le badge dans la barre de progression
    const badge = document.getElementById('printStatusBadge');
    if (badge) { badge.textContent = text; badge.style.background = color + '22'; badge.style.color = color; }
}

// ── Sauvegarde historique dans Firebase ───────────────────
function savePrintHistoryToFirebase(data, status) {
    const uid       = window.currentUser && window.currentUser.uid;
    const printerId = mqttCurrentPrinterId || window.currentPrinter;
    if (!uid || !window.database || !printerId) return;

    const entry = {
        fileName  : data.name  || 'Unknown',
        printer   : data.origin || 'Printer',
        printerId : mqttCurrentPrinterId,
        date      : firebase.database.ServerValue.TIMESTAMP,
        duration  : data.time
            ? formatDuration(data.time)
            : '--',
        filament  : data.estimatedPrintTime
            ? '--'
            : '--',
        status    : status
    };

    window.database.ref(`users/${uid}/printHistory`).push(entry)
        .then(() => console.log('[MQTT] Print history saved to Firebase'))
        .catch(err => console.error('[MQTT] Firebase save failed:', err));
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${String(m).padStart(2,'0')}m`;
}

// ── Historique températures (graphique) ───────────────────
function addTempHistoryPoint(type, value) {
    const now = new Date();
    const label = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    // Ajouter seulement quand les 2 capteurs ont un point au même moment
    if (type === 'hotend') {
        // Toujours ajouter un label quand hotend arrive
        if (tempHistory.labels.length === 0 ||
            tempHistory.labels[tempHistory.labels.length - 1] !== label) {
            tempHistory.labels.push(label);
            tempHistory.bed.push(tempHistory.bed.length > 0
                ? tempHistory.bed[tempHistory.bed.length - 1]
                : 0);
        }
        tempHistory.hotend.push(value);

        // Maintenir max 60 points
        if (tempHistory.hotend.length > TEMP_HISTORY_MAX) {
            tempHistory.hotend.shift();
            tempHistory.labels.shift();
            tempHistory.bed.shift();
        }
    } else if (type === 'bed') {
        tempHistory.bed.push(value);
        if (tempHistory.bed.length > TEMP_HISTORY_MAX) {
            tempHistory.bed.shift();
        }
    }

    // Mettre à jour le graphique si disponible
    if (window.updateTempChart) {
        window.updateTempChart(tempHistory);
    }
}

// ── Statut de connexion MQTT dans l'UI ────────────────────
function updateMQTTStatus(status) {
    const dot = document.querySelector('.status-dot');

    // Update header dot colour only (no text label)
    if (status === 'connected') {
        updateConnectionStatus(true);
    } else if (status === 'connecting') {
        if (dot) dot.style.background = '#f39c12';
        const el = document.getElementById('connectionStatus');
        if (el) el.title = 'MQTT Connexion en cours...';
    } else {
        updateConnectionStatus(false);
    }

    // Update per-printer tab dot
    const printerId = mqttCurrentPrinterId || window.currentPrinter;
    if (printerId) {
        const tabDot = document.getElementById(`tabDot_${printerId}`);
        if (tabDot) {
            const colors = { connected: '#27ae60', connecting: '#f39c12', disconnected: '#9e9e9e' };
            tabDot.style.background = colors[status] || '#9e9e9e';
        }
    }
}

// ── Commandes via OctoPrint REST API ──────────────────────
// (MQTT est unidirectionnel pour la réception — les commandes passent par REST)

/**
 * Récupère les infos OctoPrint de Firebase puis exécute une commande REST
 */
async function octoPrintCommand(endpoint, method, body) {
    const uid = window.currentUser && window.currentUser.uid;

    // Use mqttCurrentPrinterId if set, otherwise fall back to script.js currentPrinter
    const printerId = mqttCurrentPrinterId || window.currentPrinter;

    if (!uid || !printerId) {
        window.showNotification('No printer selected', 'warning');
        return;
    }

    // If MQTT hasn't set mqttCurrentPrinterId yet, sync it now
    if (!mqttCurrentPrinterId && printerId) {
        mqttCurrentPrinterId = printerId;
    }

    try {
        const snap    = await window.database
            .ref(`users/${uid}/printers/${printerId}`)
            .once('value');
        const printer = snap.val();
        if (!printer) throw new Error('Printer not found in Firebase');
        if (!printer.url) throw new Error('Printer URL not configured');
        if (!printer.apiKey) throw new Error('API Key not configured');

        // CORS fix: mode cors + credentials omit
        // Nginx sur le Pi doit retourner Access-Control-Allow-Origin
        const res = await fetch(`${printer.url}${endpoint}`, {
            method,
            mode       : 'cors',
            credentials: 'omit',
            headers: {
                'X-Api-Key'    : printer.apiKey,
                'Content-Type' : 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined
        });

        if (res.status === 401) throw new Error('Invalid API Key — check printer settings');
        if (res.status === 409) throw new Error('Conflict — printer may be busy');
        if (res.status === 404) throw new Error('Endpoint not found — check OctoPrint version');
        if (!res.ok)            throw new Error(`HTTP ${res.status}`);
        return res;

    } catch (err) {
        console.error('[OctoPrint REST]', endpoint, err.message);
        window.showNotification(`Command failed: ${err.message}`, 'error');
    }
}

/** Commandes impression */
async function cmdStartPrint()  {
    const res = await octoPrintCommand('/api/job', 'POST', { command: 'start' });
    if (res) window.showNotification('🖨️ Impression démarrée !', 'success');
}
async function cmdPausePrint()  {
    const res = await octoPrintCommand('/api/job', 'POST', { command: 'pause', action: 'pause' });
    if (res) window.showNotification('⏸️ Impression en pause', 'info');
}
async function cmdResumePrint() {
    const res = await octoPrintCommand('/api/job', 'POST', { command: 'pause', action: 'resume' });
    if (res) window.showNotification('▶️ Impression reprise', 'success');
}
async function cmdCancelPrint() {
    if (!confirm('Annuler l\'impression en cours ?')) return;
    const res = await octoPrintCommand('/api/job', 'POST', { command: 'cancel' });
    if (res) window.showNotification('⏹️ Impression annulée', 'warning');
}
async function cmdHomePrinter() {
    const res = await octoPrintCommand('/api/printer/printhead', 'POST', { command: 'home', axes: ['x','y','z'] });
    if (res) window.showNotification('🏠 Homing en cours...', 'info');
}

/** Déplacement axes */
async function cmdMove(axis, distance) {
    const jog = { command: 'jog', speed: 3000 };
    jog[axis] = parseFloat(distance);
    await octoPrintCommand('/api/printer/printhead', 'POST', jog);
    window.showNotification(`${axis.toUpperCase()} → ${distance > 0 ? '+' : ''}${distance}mm`, 'info');
}

/** Températures */
async function cmdSetHotend(temp) {
    await octoPrintCommand('/api/printer/tool', 'POST', {
        command: 'target',
        targets: { tool0: parseInt(temp) }
    });
    window.showNotification(`Hotend target: ${temp}°C`, 'info');
}
async function cmdSetBed(temp) {
    await octoPrintCommand('/api/printer/bed', 'POST', {
        command: 'target',
        target : parseInt(temp)
    });
    window.showNotification(`Bed target: ${temp}°C`, 'info');
}

/** Extrusion / Rétraction */
async function cmdExtruder(distance) {
    // distance > 0 : extrude
    // distance < 0 : retract
    const speed = 300; // mm/min
    const extrude = {
        command: 'extrude',
        amount: parseFloat(distance),
        speed: speed
    };
    
    try {
        await octoPrintCommand('/api/printer/tool', 'POST', extrude);
        const action = distance > 0 ? 'Extruded' : 'Retracted';
        window.showNotification(`${action} ${Math.abs(distance)}mm`, 'success');
    } catch(err) {
        console.error('[Extruder] Error:', err);
        window.showNotification('Extruder command failed', 'error');
    }
}

/** Upload G-code vers OctoPrint */
async function cmdUploadFile(file, uploadPath) {
    const uid       = window.currentUser && window.currentUser.uid;
    const printerId = mqttCurrentPrinterId || window.currentPrinter;
    if (!uid || !printerId) { window.showNotification('No printer selected', 'warning'); return; }

    const snap    = await window.database
        .ref(`users/${uid}/printers/${printerId}`)
        .once('value');
    const printer = snap.val();
    if (!printer) { window.showNotification('Imprimante introuvable.', 'error'); return; }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('select', 'false');
    formData.append('print',  'false');
    // If inside a folder, tell OctoPrint where to put the file
    if (uploadPath && uploadPath !== '/' && uploadPath !== '') {
        const cleanFolder = uploadPath.replace(/^\//, '');
        formData.append('path', cleanFolder);
    }

    try {
        window.showNotification(`📤 Upload de ${file.name}...`, 'info');
        const res = await fetch(`${printer.url}/api/files/local`, {
            method : 'POST',
            headers: { 'X-Api-Key': printer.apiKey },
            body   : formData
        });
        if (res.ok) {
            window.showNotification(`✅ ${file.name} uploadé !`, 'success');
            // Refresh file list after upload
            if (typeof window.fetchOctoPrintFiles === 'function') {
                setTimeout(() => window.fetchOctoPrintFiles(uploadPath), 800);
            }
        } else {
            const txt = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}${txt ? ': ' + txt.slice(0,60) : ''}`);
        }
    } catch(err) {
        window.showNotification(`Upload échoué: ${err.message}`, 'error');
    }
}

// ── Déconnexion propre ────────────────────────────────────
function disconnectMQTT() {
    clearTimeout(mqttReconnectTimer);
    if (mqttClient && mqttConnected) {
        mqttClient.disconnect();
        mqttConnected = false;
        updateMQTTStatus('disconnected');
        console.log('[MQTT] Disconnected');
    }
}

// ── Exposer sur window ────────────────────────────────────
window.initMQTT        = initMQTT;
window.octoPrintCommand = octoPrintCommand;
window.disconnectMQTT  = disconnectMQTT;
window.mqttConnected   = () => mqttConnected;

// Commandes REST exposées (appelées depuis HTML onclick)
window.cmdStartPrint   = cmdStartPrint;
window.cmdPausePrint   = cmdPausePrint;
window.cmdResumePrint  = cmdResumePrint;
window.cmdCancelPrint  = cmdCancelPrint;
window.cmdHomePrinter  = cmdHomePrinter;
window.cmdMove         = cmdMove;
window.cmdSetHotend    = cmdSetHotend;
window.cmdSetBed       = cmdSetBed;
window.cmdExtruder     = cmdExtruder;
window.cmdUploadFile   = cmdUploadFile;
window.tempHistory     = tempHistory;

// ============================================================
// SMART PREHEAT INTEGRATION
// Plugin: kantlivelong/OctoPrint-SmartPreheat
//
// How it works:
//   • The plugin parses the currently selected G-code file
//   • It extracts the first M104/M109/M140/M190 commands
//   • It exposes them as GCode script variables:
//       {preheat_tool0}  → hotend temperature found in file
//       {preheat_bed}    → bed temperature found in file
//   • We call POST /api/printer/command with those variables
//   • We also call GET /api/job to read the file-detected temps
//     before executing so we can show them in the UI
// ============================================================

// ── Presets filament (editables par l'utilisateur) ────────
const PREHEAT_PRESETS = {
    PLA  : { tool0: 200, bed: 60,  label: 'PLA',   color: '#27ae60', icon: 'fa-leaf'       },
    PETG : { tool0: 235, bed: 85,  label: 'PETG',  color: '#2980b9', icon: 'fa-tint'       },
    ABS  : { tool0: 245, bed: 110, label: 'ABS',   color: '#e67e22', icon: 'fa-fire'       },
    TPU  : { tool0: 225, bed: 45,  label: 'TPU',   color: '#8e44ad', icon: 'fa-circle'     },
    COOL : { tool0: 0,   bed: 0,   label: 'Cooldown', color: '#7f8c8d', icon: 'fa-snowflake'},
};

// ── État preheat ──────────────────────────────────────────
let preheatState = {
    isHeating     : false,
    targetTool0   : 0,
    targetBed     : 0,
    source        : null,   // 'smartpreheat' | 'preset' | null
    filamentType  : null,   // nom du preset si applicable
    detectedTool0 : null,   // température lue depuis le G-code
    detectedBed   : null,
};

// ── Lecture des températures depuis le fichier G-code ─────
/**
 * Appelle GET /api/job pour lire les infos du fichier sélectionné.
 * OctoPrint + SmartPreheat expose les temps dans job.file.
 * Ensuite on appelle GET /api/printer/profiles pour confirmer les limites.
 * Retourne { tool0, bed } ou null si aucun fichier sélectionné.
 */
async function smartPreheatReadTemps() {
    const uid = window.currentUser && window.currentUser.uid;
    if (!uid || !mqttCurrentPrinterId) return null;

    try {
        const snap    = await window.database
            .ref(`users/${uid}/printers/${mqttCurrentPrinterId}`)
            .once('value');
        const printer = snap.val();
        if (!printer) return null;

        // Lire le job actif (fichier sélectionné)
        const jobRes  = await fetch(`${printer.url}/api/job`, {
            headers: { 'X-Api-Key': printer.apiKey }
        });
        if (!jobRes.ok) throw new Error(`HTTP ${jobRes.status}`);
        const jobData = await jobRes.json();

        // OctoPrint retourne les températures suggérées via filament
        // si le slicer les a incluses dans le G-code
        const filament = jobData.job && jobData.job.filament;
        let tool0Temp  = null;
        let bedTemp    = null;

        if (filament) {
            // Certains slicers encodent M104/M109 en metadata
            if (filament.tool0 && filament.tool0.length !== undefined) {
                // Format étendu (multi-extrusion)
                tool0Temp = filament.tool0.temp || null;
            } else if (typeof filament.tool0 === 'object') {
                tool0Temp = filament.tool0.temp || null;
            }
        }

        // Fallback: lire les temperatures courantes cibles MQTT
        // (si déjà chauffé ou preset manuel actif)
        if (!tool0Temp && preheatState.detectedTool0) {
            tool0Temp = preheatState.detectedTool0;
        }
        if (!bedTemp && preheatState.detectedBed) {
            bedTemp = preheatState.detectedBed;
        }

        return { tool0: tool0Temp, bed: bedTemp, jobData };

    } catch (err) {
        console.error('[SmartPreheat] Read temps error:', err);
        return null;
    }
}

/**
 * Parse le G-code brut pour extraire les premières températures.
 * SmartPreheat fait ça côté serveur — on le réplique en JS côté client
 * comme affichage préliminaire avant confirmation serveur.
 * Cette fonction est utilisée pour lire le fichier via /api/files.
 */
function parseGcodeTemps(gcodeText) {
    const lines    = gcodeText.split('\n');
    let tool0Temp  = null;
    let bedTemp    = null;

    for (const line of lines) {
        const clean = line.trim().toUpperCase();
        if (clean.startsWith(';')) continue; // commentaire

        // M104 Sxxx ou M109 Sxxx → hotend
        if ((clean.startsWith('M104') || clean.startsWith('M109')) && tool0Temp === null) {
            const match = clean.match(/S(\d+(\.\d+)?)/);
            if (match && parseFloat(match[1]) > 0) {
                tool0Temp = parseFloat(match[1]);
            }
        }
        // M140 Sxxx ou M190 Sxxx → bed
        if ((clean.startsWith('M140') || clean.startsWith('M190')) && bedTemp === null) {
            const match = clean.match(/S(\d+(\.\d+)?)/);
            if (match && parseFloat(match[1]) > 0) {
                bedTemp = parseFloat(match[1]);
            }
        }
        // Arrêter dès qu'on a les deux
        if (tool0Temp !== null && bedTemp !== null) break;
    }

    return { tool0: tool0Temp, bed: bedTemp };
}

/**
 * Télécharge et parse le fichier G-code sélectionné pour extraire les temps.
 * Affiche le résultat dans le panneau preheat.
 */
async function smartPreheatScanFile() {
    const uid = window.currentUser && window.currentUser.uid;
    if (!uid || !mqttCurrentPrinterId) {
        window.showNotification('No printer selected', 'warning');
        return;
    }

    updatePreheatStatus('scanning', null, null);

    try {
        const snap    = await window.database
            .ref(`users/${uid}/printers/${mqttCurrentPrinterId}`)
            .once('value');
        const printer = snap.val();
        if (!printer) throw new Error('Printer not found in Firebase');

        // 1. Lire le job courant pour obtenir le nom du fichier
        const jobRes  = await fetch(`${printer.url}/api/job`, {
            headers: { 'X-Api-Key': printer.apiKey }
        });
        if (!jobRes.ok) throw new Error(`Job API: HTTP ${jobRes.status}`);
        const jobData = await jobRes.json();

        const filePath = jobData.job && jobData.job.file && jobData.job.file.path;
        const fileName = jobData.job && jobData.job.file && jobData.job.file.name;

        if (!filePath) {
            updatePreheatStatus('no-file', null, null);
            window.showNotification('No G-code file selected in OctoPrint', 'warning');
            return;
        }

        // 2. Télécharger le contenu du fichier G-code
        const fileRes = await fetch(
            `${printer.url}/api/files/local/${encodeURIComponent(filePath)}`,
            { headers: { 'X-Api-Key': printer.apiKey } }
        );
        if (!fileRes.ok) throw new Error(`File API: HTTP ${fileRes.status}`);
        const fileData = await fileRes.json();

        // OctoPrint /api/files/{path} retourne les refs,
        // pas le contenu brut. On utilise le download link.
        let tool0Temp = null;
        let bedTemp   = null;

        // Essayer refs.download pour lire le G-code brut
        if (fileData.refs && fileData.refs.download) {
            const gcodeRes = await fetch(fileData.refs.download, {
                headers: { 'X-Api-Key': printer.apiKey }
            });
            if (gcodeRes.ok) {
                const gcodeText = await gcodeRes.text();
                const temps     = parseGcodeTemps(gcodeText);
                tool0Temp       = temps.tool0;
                bedTemp         = temps.bed;
            }
        }

        // Stocker les résultats
        preheatState.detectedTool0 = tool0Temp;
        preheatState.detectedBed   = bedTemp;
        preheatState.source        = 'smartpreheat';

        updatePreheatStatus('ready', tool0Temp, bedTemp, fileName);

        if (tool0Temp || bedTemp) {
            window.showNotification(
                `Smart Preheat: ${fileName} → Hotend ${tool0Temp || '--'}°C / Bed ${bedTemp || '--'}°C`,
                'success'
            );
        } else {
            window.showNotification(
                `No temperature commands found in ${fileName}`,
                'warning'
            );
        }

    } catch (err) {
        console.error('[SmartPreheat] Scan error:', err);
        updatePreheatStatus('error', null, null);
        window.showNotification(`SmartPreheat scan failed: ${err.message}`, 'error');
    }
}

/**
 * Lance le préchauffage Smart — utilise les températures lues depuis le G-code.
 * Envoie les commandes M104 + M140 via POST /api/printer/command.
 */
async function cmdSmartPreheat() {
    if (!preheatState.detectedTool0 && !preheatState.detectedBed) {
        // Pas encore scanné : scanner d'abord
        await smartPreheatScanFile();
        // Après scan, re-vérifier
        if (!preheatState.detectedTool0 && !preheatState.detectedBed) return;
    }

    const t0  = preheatState.detectedTool0 || 0;
    const bed = preheatState.detectedBed   || 0;

    preheatState.isHeating   = true;
    preheatState.targetTool0 = t0;
    preheatState.targetBed   = bed;

    // Envoyer M104 (hotend) et M140 (bed) en parallèle
    const commands = [];
    if (t0  > 0) commands.push(`M104 S${t0}`);
    if (bed > 0) commands.push(`M140 S${bed}`);

    await sendGcodeCommands(commands);

    updatePreheatStatus('heating', t0, bed);
    window.showNotification(
        `Smart Preheat started → Hotend: ${t0}°C / Bed: ${bed}°C`,
        'success'
    );
}

/**
 * Lance le préchauffage depuis un preset filament (PLA/PETG/ABS...).
 * @param {string} presetKey - clé dans PREHEAT_PRESETS
 */
async function cmdPreheatPreset(presetKey) {
    const preset = PREHEAT_PRESETS[presetKey];
    if (!preset) {
        window.showNotification(`Unknown preset: ${presetKey}`, 'error');
        return;
    }

    // Cooldown : éteindre tout
    if (presetKey === 'COOL') {
        await cmdCooldown();
        return;
    }

    preheatState.isHeating   = true;
    preheatState.targetTool0 = preset.tool0;
    preheatState.targetBed   = preset.bed;
    preheatState.source      = 'preset';
    preheatState.filamentType = presetKey;

    const commands = [];
    if (preset.tool0 > 0) commands.push(`M104 S${preset.tool0}`);
    if (preset.bed   > 0) commands.push(`M140 S${preset.bed}`);

    await sendGcodeCommands(commands);

    updatePreheatStatus('heating', preset.tool0, preset.bed, null, presetKey);
    window.showNotification(
        `${preset.label} preheat → Hotend: ${preset.tool0}°C / Bed: ${preset.bed}°C`,
        'success'
    );
}

/**
 * Refroidissement total — éteint tous les chauffages.
 */
async function cmdCooldown() {
    preheatState.isHeating   = false;
    preheatState.targetTool0 = 0;
    preheatState.targetBed   = 0;

    await sendGcodeCommands(['M104 S0', 'M140 S0']);

    updatePreheatStatus('cooldown', 0, 0);
    window.showNotification('Cooling down — all heaters off', 'info');
}

/**
 * Envoie une liste de commandes GCode à OctoPrint.
 * POST /api/printer/command accepte un tableau de commandes.
 */
async function sendGcodeCommands(commands) {
    if (!commands || commands.length === 0) return;
    await octoPrintCommand('/api/printer/command', 'POST', { commands });
}

// ── Mise à jour du panneau Preheat dans l'UI ─────────────
/**
 * Met à jour l'affichage du panneau Smart Preheat dans le dashboard.
 * @param {string} status      - 'idle'|'scanning'|'ready'|'heating'|'cooldown'|'no-file'|'error'
 * @param {number|null} tool0  - température hotend
 * @param {number|null} bed    - température bed
 * @param {string|null} fileName
 * @param {string|null} preset
 */
function updatePreheatStatus(status, tool0, bed, fileName, preset) {
    const statusEl   = document.getElementById('preheatStatusText');
    const tool0El    = document.getElementById('preheatDetectedTool0');
    const bedEl      = document.getElementById('preheatDetectedBed');
    const fileEl     = document.getElementById('preheatFileName');
    const btnSmart   = document.getElementById('btnSmartPreheat');
    const btnCool    = document.getElementById('btnCooldown');
    const indicator  = document.getElementById('preheatIndicator');

    const msgs = {
        idle      : { text: 'Ready — click Scan to read G-code temps', color: '#95a5a6' },
        scanning  : { text: '🔍 Scanning G-code file...', color: '#f39c12' },
        ready     : { text: '✅ Temperatures detected — ready to preheat', color: '#27ae60' },
        heating   : { text: '🔥 Heating in progress...', color: '#e74c3c' },
        cooldown  : { text: '❄️ Cooling down', color: '#3498db' },
        'no-file' : { text: '⚠️ No file selected in OctoPrint', color: '#e67e22' },
        error     : { text: '❌ Scan failed — check OctoPrint connection', color: '#e74c3c' },
    };

    const msg = msgs[status] || msgs.idle;

    if (statusEl) {
        statusEl.textContent = msg.text;
        statusEl.style.color = msg.color;
    }
    if (tool0El) {
        tool0El.textContent = tool0 != null ? `${tool0}°C` : '--°C';
        tool0El.style.color = tool0 > 0 ? '#e74c3c' : '#95a5a6';
    }
    if (bedEl) {
        bedEl.textContent = bed != null ? `${bed}°C` : '--°C';
        bedEl.style.color = bed > 0 ? '#e67e22' : '#95a5a6';
    }
    if (fileEl && fileName) {
        fileEl.textContent = `📄 ${fileName}`;
    } else if (fileEl && preset) {
        fileEl.textContent = `🧵 Preset: ${PREHEAT_PRESETS[preset]?.label || preset}`;
    }
    if (indicator) {
        indicator.style.background = msg.color;
        indicator.style.boxShadow  = status === 'heating'
            ? `0 0 10px ${msg.color}`
            : 'none';
    }
    // Activer/désactiver les boutons
    if (btnSmart) {
        btnSmart.disabled = (status === 'scanning');
        btnSmart.innerHTML = status === 'scanning'
            ? '<i class="fas fa-spinner fa-spin"></i> Scanning...'
            : '<i class="fas fa-fire-alt"></i> Smart Preheat';
    }
    if (btnCool) {
        btnCool.disabled = (status === 'cooldown');
    }
}

// ── HTML du panneau Preheat (injecté dans le dashboard) ───
/**
 * Retourne le HTML complet du panneau Smart Preheat.
 * À injecter dans le dashboard après le panneau de contrôle.
 */
function getPreheatPanelHTML() {
    const presetsHTML = Object.entries(PREHEAT_PRESETS)
        .filter(([key]) => key !== 'COOL')
        .map(([key, p]) => `
            <button class="preheat-preset-btn" onclick="cmdPreheatPreset('${key}')"
                style="border-color:${p.color};color:${p.color};"
                title="Hotend: ${p.tool0}°C / Bed: ${p.bed}°C">
                <i class="fas ${p.icon}"></i>
                <span>${p.label}</span>
                <small>${p.tool0}° / ${p.bed}°</small>
            </button>
        `).join('');

    return `
    <div class="control-panel preheat-panel" id="preheatPanel">

        <!-- En-tête -->
        <div class="preheat-header">
            <div style="display:flex;align-items:center;gap:10px;">
                <div id="preheatIndicator" class="preheat-indicator"></div>
                <h2 style="margin:0;">
                    <i class="fas fa-temperature-high" style="color:#e74c3c;margin-right:8px;"></i>
                    Smart Preheat
                </h2>
            </div>
            <span class="preheat-badge">SmartPreheat Plugin</span>
        </div>

        <!-- Statut et températures détectées -->
        <div class="preheat-status-row">
            <p id="preheatStatusText" style="color:#95a5a6;font-size:13px;margin:0;">
                Ready — click Scan to read G-code temps
            </p>
            <span id="preheatFileName" style="font-size:12px;color:#aaa;"></span>
        </div>

        <!-- Températures détectées depuis le G-code -->
        <div class="preheat-temps-detected">
            <div class="preheat-temp-card">
                <i class="fas fa-fire" style="color:#e74c3c;"></i>
                <div>
                    <small>Hotend (from G-code)</small>
                    <strong id="preheatDetectedTool0" style="color:#95a5a6;">--°C</strong>
                </div>
            </div>
            <div class="preheat-temp-card">
                <i class="fas fa-bed" style="color:#e67e22;"></i>
                <div>
                    <small>Bed (from G-code)</small>
                    <strong id="preheatDetectedBed" style="color:#95a5a6;">--°C</strong>
                </div>
            </div>
        </div>

        <!-- Boutons Smart Preheat -->
        <div class="preheat-actions">
            <button class="preheat-btn scan-btn" onclick="smartPreheatScanFile()">
                <i class="fas fa-search"></i> Scan G-code
            </button>
            <button class="preheat-btn heat-btn" id="btnSmartPreheat"
                onclick="cmdSmartPreheat()">
                <i class="fas fa-fire-alt"></i> Smart Preheat
            </button>
            <button class="preheat-btn cool-btn" id="btnCooldown"
                onclick="cmdCooldown()">
                <i class="fas fa-snowflake"></i> Cooldown
            </button>
        </div>

        <!-- Séparateur -->
        <div class="preheat-divider">
            <span>— or choose a filament preset —</span>
        </div>

        <!-- Presets filament -->
        <div class="preheat-presets-grid">
            ${presetsHTML}
        </div>

    </div>`;
}

// ── Injecter le panneau dans le dashboard ────────────────
/**
 * Injecte le panneau preheat dans le dashboard s'il n'existe pas encore.
 * Appelée depuis initTempChart() dans script.js après affichage dashboard.
 */
function injectPreheatPanel() {
    if (document.getElementById('preheatPanel')) return; // déjà injecté
    const dashSection = document.getElementById('dashboard-section');
    if (!dashSection) return;
    // Injecter après le control-panel principal (Quick Controls)
    const controlPanel = dashSection.querySelector('.control-panel');
    if (controlPanel) {
        controlPanel.insertAdjacentHTML('afterend', getPreheatPanelHTML());
    } else {
        dashSection.insertAdjacentHTML('beforeend', getPreheatPanelHTML());
    }
}

// ── Exposer sur window ────────────────────────────────────
window.smartPreheatScanFile = smartPreheatScanFile;
window.cmdSmartPreheat      = cmdSmartPreheat;
window.cmdPreheatPreset     = cmdPreheatPreset;
window.cmdCooldown          = cmdCooldown;
window.injectPreheatPanel   = injectPreheatPanel;
window.getPreheatPanelHTML  = getPreheatPanelHTML;
window.PREHEAT_PRESETS      = PREHEAT_PRESETS;
window.cmdHomePrinter       = cmdHomePrinter;
window.cmdStartPrint        = cmdStartPrint;
window.cmdPausePrint        = cmdPausePrint;
window.cmdResumePrint       = cmdResumePrint;
window.cmdCancelPrint       = cmdCancelPrint;
window.cmdMove              = cmdMove;
window.cmdSetHotend         = cmdSetHotend;
window.cmdSetBed            = cmdSetBed;
window.cmdExtruder          = cmdExtruder;
window.cmdUploadFile        = cmdUploadFile;
window.octoPrintCommand     = octoPrintCommand;
window.mqttConnected        = () => mqttConnected;
window.disconnectMQTT       = () => {
    if (mqttClient && mqttConnected) {
        try { mqttClient.disconnect(); } catch(e) {}
    }
    mqttConnected = false;
    clearTimeout(mqttReconnectTimer);
};
window.initMQTT             = initMQTT;
