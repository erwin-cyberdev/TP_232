/* ──────────────────────────────────────────────────
   Speed Test — Professional implementation
   ────────────────────────────────────────────────── */

const GAUGE_ARC_LENGTH = 251; 
let testResults = { download: 0, upload: 0, ping: 0 };
let isRunning = false;

// Speed Test Constants
const TEST_DURATION_MS = 12000;
const WARMUP_DURATION_MS = 2000;
const PARALLEL_CONNECTIONS = 6;

// ── UI Updates ──
function setGauge(id, value, max, format = true) {
    const fill = document.getElementById(`gauge-${id}-fill`);
    const display = document.getElementById(`gauge-${id}-value`);
    const ratio = Math.min(value / max, 1);
    const offset = GAUGE_ARC_LENGTH * (1 - ratio);

    fill.style.strokeDashoffset = offset;
    display.textContent = value > 0 ? (format ? value.toFixed(1) : value) : '—';
}

function resetGauges() {
    ['download', 'upload', 'ping'].forEach(id => {
        const fill = document.getElementById(`gauge-${id}-fill`);
        const display = document.getElementById(`gauge-${id}-value`);
        fill.style.transition = 'stroke-dashoffset 0.6s ease-out';
        fill.style.strokeDashoffset = GAUGE_ARC_LENGTH;
        display.textContent = '—';
    });
}

function setStatus(text) {
    document.getElementById('speedtest-status').textContent = text;
}

// ── Speed Test Sub-Tasks ──

async function runPingTest() {
    setStatus('📡 Mesure du ping (Latence)...');
    const times = [];
    const iterations = 8;
    
    document.getElementById(`gauge-ping-fill`).style.transition = 'stroke-dashoffset 0.3s ease-out';

    // Sequential for precise single connection latency
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        try {
            await fetch(`/api/speedtest/ping?_=${Date.now()}`, { cache: 'no-store' });
            times.push(performance.now() - start);
            setGauge('ping', times[times.length - 1], 200, false);
        } catch(e) {}
    }
    
    // Smooth out outliers
    times.sort((a, b) => a - b);
    if (times.length > 0) times.pop();
    if (times.length > 2) times.shift();
    
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return Math.round(avg) || 0;
}

async function runDownloadTest() {
    setStatus('⬇️ Mesure de la bande passante descendante (Multi-connexions)...');
    document.getElementById(`gauge-download-fill`).style.transition = 'stroke-dashoffset 0.2s linear';
    
    return new Promise((resolve) => {
        let totalBytes = 0;
        let isTesting = true;
        let isWarmup = true;
        
        let previousBytes = 0;
        let previousTime = 0;

        // Start multiple async workers
        Array.from({ length: PARALLEL_CONNECTIONS }).forEach(async () => {
            while (isTesting) {
                try {
                    const response = await fetch('/api/speedtest/download?_=' + Date.now(), { cache: 'no-store' });
                    const reader = response.body.getReader();
                    
                    while (isTesting) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (!isWarmup) {
                            totalBytes += value.length;
                        }
                    }
                    if (!isTesting) reader.cancel();
                } catch (e) {
                    // Ignore aborts
                }
            }
        });

        // End Warmup phase
        setTimeout(() => {
            isWarmup = false;
            previousTime = performance.now();
            previousBytes = 0;
            totalBytes = 0;
        }, WARMUP_DURATION_MS);

        // UI Refresh Loop
        const interval = setInterval(() => {
            if (isWarmup) return;
            const now = performance.now();
            const elapsedSinceLast = (now - previousTime) / 1000;
            const bytesSinceLast = totalBytes - previousBytes;
            
            if (elapsedSinceLast > 0.1 && bytesSinceLast > 0) {
                const currentMbps = (bytesSinceLast * 8) / (elapsedSinceLast * 1000000);
                setGauge('download', currentMbps, 100);
                previousTime = now;
                previousBytes = totalBytes;
            }
        }, 250);

        // Test over
        setTimeout(() => {
            isTesting = false;
            clearInterval(interval);
            const finalMbps = (totalBytes * 8) / ((TEST_DURATION_MS) / 1000 * 1000000);
            resolve(Math.round(finalMbps * 100) / 100);
        }, TEST_DURATION_MS + WARMUP_DURATION_MS);
    });
}

async function runUploadTest() {
    setStatus('⬆️ Mesure de la bande passante montante (Multi-connexions)...');
    document.getElementById(`gauge-upload-fill`).style.transition = 'stroke-dashoffset 0.2s linear';
    
    return new Promise((resolve) => {
        let totalBytes = 0;
        let isTesting = true;
        let isWarmup = true;
        
        // Prepare pre-allocated 2MB Blob locally
        const payloadSize = 2 * 1024 * 1024;
        const payload = new Uint8Array(payloadSize);
        // Randomize minimal to trick compression proxies
        for(let i=0; i<payloadSize; i+=4096) payload[i] = Math.random() * 256;

        let previousBytes = 0;
        let previousTime = 0;

        // Workers sending POSTs sequentially within their loop 
        Array.from({ length: PARALLEL_CONNECTIONS }).forEach(async () => {
            while (isTesting) {
                await new Promise((resWorker) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', '/api/speedtest/upload?_=' + Date.now());
                    
                    let lastLoaded = 0;
                    xhr.upload.onprogress = (e) => {
                        if (!isWarmup && isTesting) {
                            const diff = e.loaded - lastLoaded;
                            lastLoaded = e.loaded;
                            totalBytes += diff;
                        }
                    };
                    
                    xhr.onload = () => resWorker();
                    xhr.onerror = () => resWorker();
                    
                    if (!isTesting) { 
                        xhr.abort(); 
                        resWorker(); 
                    } else {
                        xhr.send(payload);
                    }
                });
            }
        });

        // Warmup
        setTimeout(() => {
            isWarmup = false;
            previousTime = performance.now();
            previousBytes = 0;
            totalBytes = 0;
        }, WARMUP_DURATION_MS);

        // UI Refresh Loop
        const interval = setInterval(() => {
            if (isWarmup) return;
            const now = performance.now();
            const elapsedSinceLast = (now - previousTime) / 1000;
            const bytesSinceLast = totalBytes - previousBytes;
            
            if (elapsedSinceLast > 0.1 && bytesSinceLast > 0) {
                const currentMbps = (bytesSinceLast * 8) / (elapsedSinceLast * 1000000);
                setGauge('upload', currentMbps, 50);
                previousTime = now;
                previousBytes = totalBytes;
            }
        }, 250);

        // Test over
        setTimeout(() => {
            isTesting = false;
            clearInterval(interval);
            const finalMbps = (totalBytes * 8) / ((TEST_DURATION_MS) / 1000 * 1000000);
            resolve(Math.round(finalMbps * 100) / 100);
        }, TEST_DURATION_MS + WARMUP_DURATION_MS);
    });
}

// ── Orchestration ──

async function runSpeedTest() {
    if (isRunning) return;
    isRunning = true;

    const btn = document.getElementById('btn-start-test');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon spinner">⏳</span><span>Test en cours...</span>';

    document.getElementById('speedtest-results').style.display = 'none';
    document.getElementById('save-alert').style.display = 'none';
    
    document.getElementById('progress-container').style.display = 'block';
    const fill = document.getElementById('progress-fill');
    const lbl = document.getElementById('progress-label');
    
    resetGauges();

    try {
        fill.style.transition = 'width 1s ease';
        fill.style.width = '10%';
        lbl.textContent = 'Initialisation...';
        
        testResults.ping = await runPingTest();
        setGauge('ping', testResults.ping, 200, false);
        document.getElementById(`gauge-ping-fill`).style.transition = 'stroke-dashoffset 0.6s ease-out';
        
        fill.style.width = '33%';
        lbl.textContent = 'Download...';
        
        testResults.download = await runDownloadTest();
        setGauge('download', testResults.download, 100);
        document.getElementById(`gauge-download-fill`).style.transition = 'stroke-dashoffset 0.6s ease-out';

        fill.style.width = '66%';
        lbl.textContent = 'Upload...';
        
        testResults.upload = await runUploadTest();
        setGauge('upload', testResults.upload, 50);
        document.getElementById(`gauge-upload-fill`).style.transition = 'stroke-dashoffset 0.6s ease-out';

        fill.style.width = '100%';
        lbl.textContent = '100%';
        setStatus('✅ Test de vitesse terminé selon les standards professionnels');

        // Show save form
        const resultsDiv = document.getElementById('speedtest-results');
        const summary = document.getElementById('results-summary');
        summary.textContent = `Périodes: 12s | Dl: ${testResults.download} Mbps | Ul: ${testResults.upload} Mbps | Ping: ${testResults.ping} ms`;
        resultsDiv.style.display = 'block';
        resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });

    } catch (err) {
        resetGauges();
        setStatus('❌ Erreur pendant le test : ' + err.message);
        console.error(err);
    } finally {
        isRunning = false;
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">▶</span><span>Relancer le Speed Test</span>';
        setTimeout(() => { document.getElementById('progress-container').style.display = 'none'; }, 2000);
    }
}

// ── Save result ──
async function saveResult() {
    const operator = document.getElementById('st-operator').value;
    const city = document.getElementById('st-city').value;
    const neighborhood = document.getElementById('st-neighborhood').value;

    if (!operator || !city) {
        alert('Veuillez remplir l\\'opérateur et la ville.');
        return;
    }

    let quality = 'lent';
    if (testResults.download >= 10) quality = 'rapide';
    else if (testResults.download >= 3) quality = 'moyen';

    try {
        const res = await fetch('/api/submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operator,
                quality,
                city,
                neighborhood,
                speed_mbps: testResults.download
            })
        });

        if (res.ok) {
            document.getElementById('save-alert').style.display = 'block';
            document.getElementById('btn-save-result').disabled = true;
        }
    } catch (err) {
        alert('Erreur lors de la sauvegarde');
    }
}

// ── Events ──
document.getElementById('btn-start-test').addEventListener('click', runSpeedTest);
document.getElementById('btn-save-result').addEventListener('click', saveResult);
