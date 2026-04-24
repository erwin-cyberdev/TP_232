/* ──────────────────────────────────────────────────
   Ranking — Operator leaderboard
   ────────────────────────────────────────────────── */

const MEDAL_ICONS = ['🥇', '🥈', '🥉'];
const OPERATOR_COLORS = {
    'MTN':     { bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.4)', bar: '#fbbf24' },
    'Orange':  { bg: 'rgba(249, 115, 22, 0.15)', border: 'rgba(249, 115, 22, 0.4)', bar: '#f97316' },
    'Camtel':  { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.4)', bar: '#3b82f6' },
    'Nexttel': { bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.4)', bar: '#a855f7' },
    'Yoomee':  { bg: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.4)', bar: '#ec4899' },
    'Autre':   { bg: 'rgba(107, 114, 128, 0.15)', border: 'rgba(107, 114, 128, 0.4)', bar: '#6b7280' }
};

const DEFAULT_COLOR = { bg: 'rgba(99, 102, 241, 0.15)', border: 'rgba(99, 102, 241, 0.4)', bar: '#6366f1' };

let currentSort = 'quality';

function getQualityLabel(score) {
    if (score >= 2.5) return { text: 'Excellent', class: 'badge-green', icon: '🚀' };
    if (score >= 1.8) return { text: 'Moyen', class: 'badge-yellow', icon: '🚶' };
    return { text: 'Faible', class: 'badge-red', icon: '🐢' };
}

async function loadRanking(sortBy = 'quality') {
    try {
        currentSort = sortBy;
        const res = await fetch(`/api/ranking?sort_by=${sortBy}`);
        const ranking = await res.json();

        const container = document.getElementById('ranking-container');
        const empty = document.getElementById('ranking-empty');

        if (ranking.length === 0) {
            container.style.display = 'none';
            empty.style.display = 'block';
            return;
        }

        container.style.display = '';
        empty.style.display = 'none';

        const maxScore = 3;
        const maxSubmissions = Math.max(...ranking.map(r => r.total_submissions));

        container.innerHTML = ranking.map((entry, i) => {
            const color = OPERATOR_COLORS[entry.operator] || DEFAULT_COLOR;
            const medal = i < 3 ? MEDAL_ICONS[i] : `#${entry.rank}`;
            const qualLabel = getQualityLabel(entry.quality_score);
            const scorePercent = (entry.quality_score / maxScore * 100).toFixed(0);
            const subsPercent = (entry.total_submissions / maxSubmissions * 100).toFixed(0);

            const totalQual = entry.quality_counts.lent + entry.quality_counts.moyen + entry.quality_counts.rapide;
            const pctLent = totalQual ? (entry.quality_counts.lent / totalQual * 100).toFixed(0) : 0;
            const pctMoyen = totalQual ? (entry.quality_counts.moyen / totalQual * 100).toFixed(0) : 0;
            const pctRapide = totalQual ? (entry.quality_counts.rapide / totalQual * 100).toFixed(0) : 0;

            return `
                <div class="card ranking-card" style="border-color: ${color.border}; --card-accent: ${color.bar}; animation-delay: ${i * 0.1}s;">
                    <div class="rank-header">
                        <span class="rank-medal ${i < 3 ? 'rank-top3' : ''}">${medal}</span>
                        <div class="rank-operator">
                            <h3>${entry.operator}</h3>
                            <span class="badge ${qualLabel.class}">${qualLabel.icon} ${qualLabel.text}</span>
                        </div>
                        <div class="rank-score">
                            <div class="rank-score-value">${entry.quality_score}</div>
                            <div class="rank-score-label">/ 3.0</div>
                        </div>
                    </div>

                    <div class="rank-stats">
                        <div class="rank-stat">
                            <div class="rank-stat-header">
                                <span class="rank-stat-label">Score qualité</span>
                                <span class="rank-stat-value">${scorePercent}%</span>
                            </div>
                            <div class="rank-bar">
                                <div class="rank-bar-fill" style="width: ${scorePercent}%; background: ${color.bar};"></div>
                            </div>
                        </div>
                        <div class="rank-stat">
                            <div class="rank-stat-header">
                                <span class="rank-stat-label">Soumissions</span>
                                <span class="rank-stat-value">${entry.total_submissions}</span>
                            </div>
                            <div class="rank-bar">
                                <div class="rank-bar-fill" style="width: ${subsPercent}%; background: ${color.bar}; opacity: 0.7;"></div>
                            </div>
                        </div>
                        <div class="rank-stat">
                            <div class="rank-stat-header">
                                <span class="rank-stat-label">Metrics moyennes</span>
                            </div>
                            <div class="rank-metrics-grid">
                                <div class="rank-metric-item">
                                    <span class="rank-metric-val">${entry.avg_download}</span>
                                    <span class="rank-metric-unit">Dl (Mbps)</span>
                                </div>
                                <div class="rank-metric-item">
                                    <span class="rank-metric-val">${entry.avg_upload}</span>
                                    <span class="rank-metric-unit">Ul (Mbps)</span>
                                </div>
                                <div class="rank-metric-item">
                                    <span class="rank-metric-val">${entry.avg_ping}</span>
                                    <span class="rank-metric-unit">Ping (ms)</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="rank-distribution">
                        <div class="rank-dist-bar">
                            <div class="rank-dist-segment rank-dist-rapid" style="width: ${pctRapide}%;" title="Rapide: ${pctRapide}%"></div>
                            <div class="rank-dist-segment rank-dist-moyen" style="width: ${pctMoyen}%;" title="Moyen: ${pctMoyen}%"></div>
                            <div class="rank-dist-segment rank-dist-lent" style="width: ${pctLent}%;" title="Lent: ${pctLent}%"></div>
                        </div>
                        <div class="rank-dist-legend">
                            <span>🚀 ${pctRapide}%</span>
                            <span>🚶 ${pctMoyen}%</span>
                            <span>🐢 ${pctLent}%</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('Failed to load ranking:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadRanking();

    // Sort control events
    const sortButtons = document.querySelectorAll('#ranking-sort-controls .btn');
    sortButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            sortButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadRanking(btn.dataset.sort);
        });
    });
});
