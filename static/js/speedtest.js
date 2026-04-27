/* ══════════════════════════════════════════════════════════════
   SPEEDTEST ENGINE — Client-side (navigateur → serveur Flask)
   
   Architecture :
   - Ping : 10 requêtes HTTP vers /st/ping, calcul RTT + jitter
   - Download : 6 connexions parallèles vers /st/download (stream)
   - Upload : 4 connexions parallèles POST vers /st/upload
   - Warmup de 2s ignoré pour stabiliser la mesure
   ══════════════════════════════════════════════════════════════ */

const GAUGE_ARC_LENGTH = 251;
let testResults = { download: 0, upload: 0, ping: 0, jitter: 0 };
let isRunning = false;

// ── Configuration ──
const CONFIG = {
    PING_COUNT: 10,              // Nombre de pings
    PING_DISCARD: 2,             // Ignorer les N premiers (cold start TCP)
    DL_DURATION_MS: 12000,       // Durée test download (12s)
    DL_WARMUP_MS: 2000,          // Warmup download (2s)
    DL_CONNECTIONS: 6,           // Connexions parallèles download
    DL_SIZE_MB: 100,             // Taille download par connexion
    UL_DURATION_MS: 10000,       // Durée test upload (10s)
    UL_WARMUP_MS: 2000,          // Warmup upload (2s)
    UL_CONNECTIONS: 4,           // Connexions parallèles upload
    UL_CHUNK_SIZE: 65536,         // Taille chunk upload (64 KB - limite crypto.getRandomValues)
    UPDATE_INTERVAL_MS: 300,     // Fréquence mise à jour UI
};


// ═══════════════════════ UI HELPERS ═══════════════════════

function setGauge(id, value, max, format = true) {
    const fill = document.getElementById(`gauge-${id}-fill`);
    const display = document.getElementById(`gauge-${id}-value`);
    if (!fill || !display) return;
    
    const ratio = Math.min(value / max, 1);
    const offset = GAUGE_ARC_LENGTH * (1 - ratio);

    fill.style.strokeDashoffset = offset;
    display.textContent = value > 0 ? (format ? value.toFixed(1) : value) : '—';
}

function resetGauges() {
    ['download', 'upload', 'ping'].forEach(id => {
        const fill = document.getElementById(`gauge-${id}-fill`);
        const display = document.getElementById(`gauge-${id}-value`);
        if (fill) {
            fill.style.transition = 'stroke-dashoffset 0.6s ease-out';
            fill.style.strokeDashoffset = GAUGE_ARC_LENGTH;
        }
        if (display) display.textContent = '—';
    });
}

function setStatus(text) {
    const el = document.getElementById('speedtest-status');
    if (el) el.textContent = text;
}

function setProgress(percent, label) {
    const fill = document.getElementById('progress-fill');
    const lbl = document.getElementById('progress-label');
    if (fill) fill.style.width = percent + '%';
    if (lbl) lbl.textContent = label;
}


// ═══════════════════════ PING TEST ═══════════════════════

async function measurePing() {
    setStatus('📡 Mesure du ping...');
    setProgress(5, 'Ping...');
    
    const rtts = [];
    
    for (let i = 0; i < CONFIG.PING_COUNT; i++) {
        try {
            const t0 = performance.now();
            await fetch('/st/ping?t=' + Date.now(), { cache: 'no-store' });
            const t1 = performance.now();
            rtts.push(t1 - t0);
        } catch (e) {
            // Ignorer les échecs réseau
        }
        setProgress(5 + (i / CONFIG.PING_COUNT) * 10, `Ping ${i + 1}/${CONFIG.PING_COUNT}`);
    }
    
    if (rtts.length < 3) {
        throw new Error('Impossible de mesurer le ping (réseau instable)');
    }
    
    // Ignorer les N premiers (TCP cold start)
    const stable = rtts.slice(CONFIG.PING_DISCARD);
    
    // Moyenne
    const avg = stable.reduce((a, b) => a + b, 0) / stable.length;
    
    // Jitter = écart-type des RTTs
    const variance = stable.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / stable.length;
    const jitter = Math.sqrt(variance);
    
    return { avg: Math.round(avg * 10) / 10, jitter: Math.round(jitter * 10) / 10 };
}


// ═══════════════════════ DOWNLOAD TEST ═══════════════════════

async function measureDownload() {
    setStatus('⬇️ Test de download en cours...');
    setProgress(20, 'Download 0%');
    
    const startTime = performance.now();
    let totalBytes = 0;
    let warmupBytes = 0;
    let warmupDone = false;
    let warmupEndTime = 0;
    let currentSpeed = 0;
    let aborted = false;
    
    const controller = new AbortController();
    
    // Timer pour arrêter le test après DL_DURATION_MS
    const timeout = setTimeout(() => {
        aborted = true;
        controller.abort();
    }, CONFIG.DL_DURATION_MS);
    
    // UI update interval
    const uiInterval = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / CONFIG.DL_DURATION_MS, 1);
        setProgress(20 + progress * 35, `Download ${Math.round(progress * 100)}%`);
        
        if (warmupDone && totalBytes > warmupBytes) {
            const measureTime = (performance.now() - warmupEndTime) / 1000;
            const measuredBytes = totalBytes - warmupBytes;
            currentSpeed = (measuredBytes * 8) / (measureTime * 1_000_000);
            setGauge('download', currentSpeed, 1000);
            setStatus(`⬇️ Download : ${currentSpeed.toFixed(1)} Mbps`);
            document.getElementById('gauge-download-fill').style.transition = 'stroke-dashoffset 0.3s ease-out';
        }
    }, CONFIG.UPDATE_INTERVAL_MS);
    
    // Lancer N connexions parallèles
    const workers = [];
    for (let i = 0; i < CONFIG.DL_CONNECTIONS; i++) {
        workers.push(
            (async () => {
                try {
                    const resp = await fetch(`/st/download?size=${CONFIG.DL_SIZE_MB}&t=${Date.now()}_${i}`, {
                        signal: controller.signal,
                        cache: 'no-store',
                    });
                    const reader = resp.body.getReader();
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done || aborted) break;
                        totalBytes += value.byteLength;
                        
                        // Vérifier fin du warmup
                        if (!warmupDone && (performance.now() - startTime) >= CONFIG.DL_WARMUP_MS) {
                            warmupDone = true;
                            warmupBytes = totalBytes;
                            warmupEndTime = performance.now();
                        }
                    }
                } catch (e) {
                    if (e.name !== 'AbortError') console.warn('DL worker error:', e);
                }
            })()
        );
    }
    
    await Promise.allSettled(workers);
    clearTimeout(timeout);
    clearInterval(uiInterval);
    
    // Calcul final
    if (warmupDone && totalBytes > warmupBytes) {
        const measureTime = (performance.now() - warmupEndTime) / 1000;
        const measuredBytes = totalBytes - warmupBytes;
        currentSpeed = (measuredBytes * 8) / (measureTime * 1_000_000);
    } else {
        // Pas de warmup possible, utiliser tout
        const elapsed = (performance.now() - startTime) / 1000;
        currentSpeed = (totalBytes * 8) / (elapsed * 1_000_000);
    }
    
    const finalSpeed = Math.round(currentSpeed * 100) / 100;
    setGauge('download', finalSpeed, 1000);
    setProgress(55, `Download: ${finalSpeed} Mbps`);
    setStatus(`⬇️ Download : ${finalSpeed} Mbps`);
    
    return finalSpeed;
}


// ═══════════════════════ UPLOAD TEST ═══════════════════════

async function measureUpload() {
    setStatus('⬆️ Test d\'upload en cours...');
    setProgress(60, 'Upload 0%');
    
    const startTime = performance.now();
    let totalBytesSent = 0;
    let warmupBytes = 0;
    let warmupDone = false;
    let warmupEndTime = 0;
    let currentSpeed = 0;
    let shouldStop = false;
    
    // Pré-générer un buffer de données aléatoires (64 KB max pour getRandomValues)
    const uploadData = new Uint8Array(CONFIG.UL_CHUNK_SIZE);
    for (let offset = 0; offset < uploadData.length; offset += 65536) {
        const size = Math.min(65536, uploadData.length - offset);
        crypto.getRandomValues(uploadData.subarray(offset, offset + size));
    }
    
    // Timer pour arrêter
    const timeout = setTimeout(() => { shouldStop = true; }, CONFIG.UL_DURATION_MS);
    
    // UI update interval
    const uiInterval = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / CONFIG.UL_DURATION_MS, 1);
        setProgress(60 + progress * 35, `Upload ${Math.round(progress * 100)}%`);
        
        if (warmupDone && totalBytesSent > warmupBytes) {
            const measureTime = (performance.now() - warmupEndTime) / 1000;
            const measuredBytes = totalBytesSent - warmupBytes;
            currentSpeed = (measuredBytes * 8) / (measureTime * 1_000_000);
            setGauge('upload', currentSpeed, 1000);
            setStatus(`⬆️ Upload : ${currentSpeed.toFixed(1)} Mbps`);
            document.getElementById('gauge-upload-fill').style.transition = 'stroke-dashoffset 0.3s ease-out';
        }
    }, CONFIG.UPDATE_INTERVAL_MS);
    
    // Worker d'upload : envoie des blobs en boucle
    async function uploadWorker() {
        while (!shouldStop) {
            try {
                // Construire un payload de ~2 MB
                const chunks = [];
                const chunksPerRequest = 16; // 16 × 128KB = 2 MB
                for (let j = 0; j < chunksPerRequest; j++) {
                    chunks.push(uploadData);
                }
                const blob = new Blob(chunks);
                const payloadSize = blob.size;
                
                await fetch('/st/upload', {
                    method: 'POST',
                    body: blob,
                    headers: { 'Content-Type': 'application/octet-stream' },
                });
                
                totalBytesSent += payloadSize;
                
                // Vérifier fin du warmup
                if (!warmupDone && (performance.now() - startTime) >= CONFIG.UL_WARMUP_MS) {
                    warmupDone = true;
                    warmupBytes = totalBytesSent;
                    warmupEndTime = performance.now();
                }
            } catch (e) {
                if (!shouldStop) console.warn('UL worker error:', e);
                break;
            }
        }
    }
    
    // Lancer N workers parallèles
    const workers = [];
    for (let i = 0; i < CONFIG.UL_CONNECTIONS; i++) {
        workers.push(uploadWorker());
    }
    
    await Promise.allSettled(workers);
    clearTimeout(timeout);
    clearInterval(uiInterval);
    
    // Calcul final
    if (warmupDone && totalBytesSent > warmupBytes) {
        const measureTime = (performance.now() - warmupEndTime) / 1000;
        const measuredBytes = totalBytesSent - warmupBytes;
        currentSpeed = (measuredBytes * 8) / (measureTime * 1_000_000);
    } else {
        const elapsed = (performance.now() - startTime) / 1000;
        currentSpeed = (totalBytesSent * 8) / (elapsed * 1_000_000);
    }
    
    const finalSpeed = Math.round(currentSpeed * 100) / 100;
    setGauge('upload', finalSpeed, 1000);
    setProgress(95, `Upload: ${finalSpeed} Mbps`);
    setStatus(`⬆️ Upload : ${finalSpeed} Mbps`);
    
    return finalSpeed;
}


// ═══════════════════════ ORCHESTRATION ═══════════════════════

async function runSpeedTest() {
    if (isRunning) return;
    isRunning = true;

    const btn = document.getElementById('btn-start-test');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon spinner">⏳</span><span>Test en cours...</span>';

    document.getElementById('speedtest-results').style.display = 'none';
    document.getElementById('save-alert').style.display = 'none';
    document.getElementById('progress-container').style.display = 'block';
    
    const progressFill = document.getElementById('progress-fill');
    progressFill.style.transition = 'width 0.3s ease';

    resetGauges();
    
    try {
        // ── 1. PING ──
        const pingResult = await measurePing();
        testResults.ping = pingResult.avg;
        testResults.jitter = pingResult.jitter;
        setGauge('ping', pingResult.avg, 200, false);
        document.getElementById('gauge-ping-fill').style.transition = 'stroke-dashoffset 0.6s ease-out';
        setStatus(`📡 Ping : ${pingResult.avg} ms (jitter: ${pingResult.jitter} ms)`);
        
        await new Promise(r => setTimeout(r, 500));
        
        // ── 2. DOWNLOAD ──
        testResults.download = await measureDownload();
        
        await new Promise(r => setTimeout(r, 500));
        
        // ── 3. UPLOAD ──
        testResults.upload = await measureUpload();
        
        // ── 4. TERMINÉ ──
        setProgress(100, '100%');
        setStatus(`✅ Test terminé — Dl: ${testResults.download} Mbps | Ul: ${testResults.upload} Mbps | Ping: ${testResults.ping} ms`);
        
        // Afficher le formulaire de sauvegarde
        showResultsForm();
        
    } catch (err) {
        console.error('Speedtest error:', err);
        resetGauges();
        setStatus('❌ Erreur : ' + err.message);
        setTimeout(() => {
            document.getElementById('progress-container').style.display = 'none';
        }, 3000);
    }
    
    isRunning = false;
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">▶</span><span>Relancer le Speed Test</span>';
}


function showResultsForm() {
    const resultsDiv = document.getElementById('speedtest-results');
    const summary = document.getElementById('results-summary');
    summary.textContent = `Dl: ${testResults.download} Mbps | Ul: ${testResults.upload} Mbps | Ping: ${testResults.ping} ms`;
    
    // Auto-remplir les champs
    const speedInput = document.getElementById('st-speed');
    if (speedInput) speedInput.value = testResults.download;

    const uploadInput = document.getElementById('st-upload');
    if (uploadInput) uploadInput.value = testResults.upload;

    const pingInput = document.getElementById('st-ping');
    if (pingInput) pingInput.value = testResults.ping;

    // Réactiver le bouton de sauvegarde
    const saveBtn = document.getElementById('btn-save-result');
    if (saveBtn) saveBtn.disabled = false;

    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}


// ── Save result ──
async function saveResult() {
    let operator = document.getElementById('st-operator').value;
    if (operator === 'Autre') {
        operator = document.getElementById('st-operator-custom').value.trim();
    }
    const city = document.getElementById('st-city').value;
    const neighborhood = document.getElementById('st-neighborhood').value;

    if (!operator || !city) {
        alert("Veuillez sélectionner ou saisir votre opérateur et remplir la ville.");
        return;
    }

    let quality = 'lent';
    if (testResults.download >= 10) quality = 'rapide';
    else if (testResults.download >= 2) quality = 'moyen';

    try {
        const res = await fetch('/api/submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operator,
                quality,
                city,
                neighborhood,
                speed_mbps: testResults.download,
                upload_mbps: testResults.upload,
                ping_ms: testResults.ping
            })
        });

        if (res.ok) {
            document.getElementById('save-alert').style.display = 'block';
            document.getElementById('btn-save-result').disabled = true;
        } else {
            const err = await res.json();
            alert('Erreur: ' + (err.error || 'Échec de la sauvegarde'));
        }
    } catch (err) {
        alert('Erreur lors de la sauvegarde');
    }
}


// ═══════════════════════ EVENTS ═══════════════════════

// Opérateur custom
const stOperator = document.getElementById('st-operator');
const stOperatorCustom = document.getElementById('st-operator-custom');
if (stOperator && stOperatorCustom) {
    stOperator.addEventListener('change', () => {
        if (stOperator.value === 'Autre') {
            stOperatorCustom.style.display = 'block';
            stOperatorCustom.required = true;
        } else {
            stOperatorCustom.style.display = 'none';
            stOperatorCustom.required = false;
        }
    });
}

document.getElementById('btn-start-test').addEventListener('click', runSpeedTest);
document.getElementById('btn-save-result').addEventListener('click', saveResult);

// Auto-start
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(runSpeedTest, 800);
});
