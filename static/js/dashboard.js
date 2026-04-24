/* ──────────────────────────────────────────────────
   Dashboard — Chart.js logic & filter handling
   ────────────────────────────────────────────────── */

const COLORS = {
    palette: [
        'rgba(99, 102, 241, 0.85)',   // indigo
        'rgba(168, 85, 247, 0.85)',   // purple
        'rgba(236, 72, 153, 0.85)',   // pink
        'rgba(34, 197, 94, 0.85)',    // green
        'rgba(251, 191, 36, 0.85)',   // amber
        'rgba(59, 130, 246, 0.85)',   // blue
        'rgba(244, 114, 182, 0.85)',  // rose
        'rgba(14, 165, 233, 0.85)',   // sky
    ],
    border: [
        'rgb(99, 102, 241)',
        'rgb(168, 85, 247)',
        'rgb(236, 72, 153)',
        'rgb(34, 197, 94)',
        'rgb(251, 191, 36)',
        'rgb(59, 130, 246)',
        'rgb(244, 114, 182)',
        'rgb(14, 165, 233)',
    ],
    quality: {
        lent:   'rgba(239, 68, 68, 0.8)',
        moyen:  'rgba(251, 191, 36, 0.8)',
        rapide: 'rgba(34, 197, 94, 0.8)'
    }
};

// Chart.js global defaults for dark theme
Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.animation.duration = 800;
Chart.defaults.animation.easing = 'easeInOutQuart';

let charts = {};

// ── Fetch stats and render ──
async function loadDashboard() {
    const operator = document.getElementById('filter-operator').value;
    const city = document.getElementById('filter-city').value;

    const params = new URLSearchParams();
    if (operator) params.set('operator', operator);
    if (city) params.set('city', city);

    try {
        const res = await fetch(`/api/stats?${params}`);
        const data = await res.json();

        const emptyState = document.getElementById('empty-state');
        const kpiGrid = document.querySelector('.kpi-grid');
        const chartsGrid = document.querySelector('.charts-grid');

        if (data.total === 0) {
            emptyState.style.display = 'block';
            kpiGrid.style.display = 'none';
            chartsGrid.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        kpiGrid.style.display = '';
        chartsGrid.style.display = '';

        // Populate filter dropdowns (only on first load)
        populateFilters(data.operators, data.cities);

        // Update KPIs
        document.getElementById('kpi-total').textContent = data.total;
        document.getElementById('kpi-operators').textContent = data.operators.length;
        document.getElementById('kpi-cities').textContent = data.cities.length;

        const speeds = Object.values(data.avg_speed_by_operator);
        if (speeds.length > 0) {
            const avgAll = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1);
            document.getElementById('kpi-avg-speed').textContent = avgAll;
        } else {
            document.getElementById('kpi-avg-speed').textContent = '—';
        }

        // Render charts
        renderQualityChart(data.avg_quality_by_operator);
        renderDistributionChart(data.quality_distribution);
        renderZonesChart(data.submissions_by_zone);
        renderSpeedChart(data.avg_speed_by_operator);

    } catch (err) {
        console.error('Failed to load dashboard:', err);
    }
}

let filtersPopulated = false;

function populateFilters(operators, cities) {
    if (filtersPopulated) return;
    filtersPopulated = true;

    const opSelect = document.getElementById('filter-operator');
    const citySelect = document.getElementById('filter-city');

    operators.forEach(op => {
        const opt = document.createElement('option');
        opt.value = op;
        opt.textContent = op;
        opSelect.appendChild(opt);
    });

    cities.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        citySelect.appendChild(opt);
    });
}

// ── Chart: Quality by Operator (bar) ──
function renderQualityChart(data) {
    const labels = Object.keys(data);
    const values = Object.values(data);

    if (charts.quality) charts.quality.destroy();

    charts.quality = new Chart(document.getElementById('chart-quality'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Score moyen',
                data: values,
                backgroundColor: labels.map((_, i) => COLORS.palette[i % COLORS.palette.length]),
                borderColor: labels.map((_, i) => COLORS.border[i % COLORS.border.length]),
                borderWidth: 2,
                borderRadius: 8,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 3,
                    ticks: {
                        stepSize: 1,
                        callback: v => ['', 'Lent', 'Moyen', 'Rapide'][v] || ''
                    }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// ── Chart: Quality Distribution (doughnut) ──
function renderDistributionChart(data) {
    const orderedKeys = ['lent', 'moyen', 'rapide'];
    const labels = orderedKeys.filter(k => k in data).map(k => k.charAt(0).toUpperCase() + k.slice(1));
    const values = orderedKeys.filter(k => k in data).map(k => data[k]);
    const colors = orderedKeys.filter(k => k in data).map(k => COLORS.quality[k]);

    if (charts.distribution) charts.distribution.destroy();

    charts.distribution = new Chart(document.getElementById('chart-distribution'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderColor: 'rgba(15, 17, 23, 0.9)',
                borderWidth: 3,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '55%',
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.label}: ${ctx.parsed}%`
                    }
                }
            }
        }
    });
}

// ── Chart: Submissions by Zone (bar) ──
function renderZonesChart(data) {
    const labels = Object.keys(data);
    const values = Object.values(data);

    if (charts.zones) charts.zones.destroy();

    charts.zones = new Chart(document.getElementById('chart-zones'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Soumissions',
                data: values,
                backgroundColor: 'rgba(99, 102, 241, 0.6)',
                borderColor: 'rgb(99, 102, 241)',
                borderWidth: 2,
                borderRadius: 8,
                barPercentage: 0.5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: labels.length > 6 ? 'y' : 'x',
            scales: {
                y: { beginAtZero: true },
                x: { beginAtZero: true }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// ── Chart: Speed by Operator (bar) ──
function renderSpeedChart(data) {
    const labels = Object.keys(data);
    const values = Object.values(data);

    if (charts.speed) charts.speed.destroy();

    charts.speed = new Chart(document.getElementById('chart-speed'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Mbps',
                data: values,
                backgroundColor: labels.map((_, i) => COLORS.palette[i % COLORS.palette.length]),
                borderColor: labels.map((_, i) => COLORS.border[i % COLORS.border.length]),
                borderWidth: 2,
                borderRadius: 8,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: { beginAtZero: true }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// ── Event listeners ──
document.getElementById('filter-operator').addEventListener('change', () => {
    loadDashboard();
});

document.getElementById('filter-city').addEventListener('change', () => {
    loadDashboard();
});

document.getElementById('btn-reset-filters').addEventListener('click', () => {
    document.getElementById('filter-operator').value = '';
    document.getElementById('filter-city').value = '';
    filtersPopulated = false;
    // Clear existing options except first
    const opSelect = document.getElementById('filter-operator');
    const citySelect = document.getElementById('filter-city');
    while (opSelect.options.length > 1) opSelect.remove(1);
    while (citySelect.options.length > 1) citySelect.remove(1);
    loadDashboard();
});

// ── Init ──
document.addEventListener('DOMContentLoaded', loadDashboard);
