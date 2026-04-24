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


// ── Orchestration ──

function runSpeedTest() {
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
    
    fill.style.transition = 'width 0.3s ease';
    fill.style.width = '5%';
    lbl.textContent = 'Connexion au serveur...';

    const eventSource = new EventSource('/api/ext_speedtest/run');

    eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        
        if (data.step === 'init') {
            setStatus('🌐 ' + data.message);
        } else if (data.step === 'ping') {
            fill.style.width = '20%';
            lbl.textContent = 'Ping...';
            setStatus('📡 Mesure du ping serveur (' + data.server_name + ') : ' + data.value + ' ms');
            setGauge('ping', data.value, 200, false);
            document.getElementById(`gauge-ping-fill`).style.transition = 'stroke-dashoffset 0.6s ease-out';
        } else if (data.step === 'download') {
            const prog = 20 + (data.progress * 40);
            fill.style.width = prog + '%';
            lbl.textContent = 'Download... ' + Math.round(data.progress * 100) + '%';
            setStatus('⬇️ Download... ' + data.value.toFixed(2) + ' Mbps');
            setGauge('download', data.value, 1000);
            document.getElementById(`gauge-download-fill`).style.transition = 'stroke-dashoffset 0.3s ease-out';
        } else if (data.step === 'upload') {
            const prog = 60 + (data.progress * 40);
            fill.style.width = prog + '%';
            lbl.textContent = 'Upload... ' + Math.round(data.progress * 100) + '%';
            setStatus('⬆️ Upload... ' + data.value.toFixed(2) + ' Mbps');
            setGauge('upload', data.value, 1000);
            document.getElementById(`gauge-upload-fill`).style.transition = 'stroke-dashoffset 0.3s ease-out';
        } else if (data.step === 'done') {
            fill.style.width = '100%';
            lbl.textContent = '100%';
            setStatus('✅ Test de vitesse terminé sur le serveur Python avec requêtes simultanées.');
            
            testResults.ping = data.results.ping;
            testResults.download = data.results.download;
            testResults.upload = data.results.upload;
            
            // Show save form
            const resultsDiv = document.getElementById('speedtest-results');
            const summary = document.getElementById('results-summary');
            summary.textContent = `Dl: ${testResults.download} Mbps | Ul: ${testResults.upload} Mbps | Ping: ${testResults.ping} ms`;
            
            // Auto-fill speed field
            const speedInput = document.getElementById('st-speed');
            if (speedInput) speedInput.value = testResults.download;

            const uploadInput = document.getElementById('st-upload');
            if (uploadInput) uploadInput.value = testResults.upload;

            const pingInput = document.getElementById('st-ping');
            if (pingInput) pingInput.value = testResults.ping;

            const stOperator = document.getElementById('st-operator');
            const stOperatorCustom = document.getElementById('st-operator-custom');

            stOperator?.addEventListener('change', () => {
                if (stOperator.value === 'Autre') {
                    stOperatorCustom.style.display = 'block';
                    stOperatorCustom.required = true;
                } else {
                    stOperatorCustom.style.display = 'none';
                    stOperatorCustom.required = false;
                }
            });

            resultsDiv.style.display = 'block';
            resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            eventSource.close();
            
            isRunning = false;
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">▶</span><span>Relancer le Speed Test</span>';
        } else if (data.step === 'error') {
            resetGauges();
            setStatus('❌ Erreur : ' + data.message);
            eventSource.close();
            
            isRunning = false;
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">▶</span><span>Relancer le Speed Test</span>';
            setTimeout(() => { document.getElementById('progress-container').style.display = 'none'; }, 2000);
        }
    };

    eventSource.onerror = (e) => {
        resetGauges();
        setStatus('❌ Erreur de connexion au flux SSE.');
        eventSource.close();
        
        isRunning = false;
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">▶</span><span>Relancer le Speed Test</span>';
        setTimeout(() => { document.getElementById('progress-container').style.display = 'none'; }, 2000);
    };
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
        }
    } catch (err) {
        alert('Erreur lors de la sauvegarde');
    }
}

// ── Events ──
document.getElementById('btn-start-test').addEventListener('click', runSpeedTest);
document.getElementById('btn-save-result').addEventListener('click', saveResult);

// Auto-start on load
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure everything is ready and smooth
    setTimeout(runSpeedTest, 1000);
});
