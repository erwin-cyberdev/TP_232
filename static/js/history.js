/* ──────────────────────────────────────────────────
   History — Paginated data table with filters
   ────────────────────────────────────────────────── */

let currentPage = 1;
const perPage = 15;
let filtersPopulated = false;

async function loadHistory() {
    const operator = document.getElementById('hist-operator').value;
    const city = document.getElementById('hist-city').value;
    const quality = document.getElementById('hist-quality').value;

    const params = new URLSearchParams();
    if (operator) params.set('operator', operator);
    if (city) params.set('city', city);
    if (quality) params.set('quality', quality);
    params.set('page', currentPage);
    params.set('per_page', perPage);

    try {
        const res = await fetch(`/api/submissions?${params}`);
        const json = await res.json();

        const { data, pagination } = json;
        const tbody = document.getElementById('hist-tbody');
        const empty = document.getElementById('hist-empty');
        const table = document.getElementById('hist-table');
        const countEl = document.getElementById('hist-count');
        const pageInfo = document.getElementById('hist-page-info');

        countEl.textContent = `${pagination.total} résultat${pagination.total > 1 ? 's' : ''}`;
        pageInfo.textContent = `Page ${pagination.page} / ${pagination.pages || 1}`;

        if (data.length === 0) {
            table.style.display = 'none';
            empty.style.display = 'flex';
            document.getElementById('hist-pagination').innerHTML = '';
            return;
        }

        table.style.display = '';
        empty.style.display = 'none';

        // Populate filters on first load
        if (!filtersPopulated) {
            await populateFilters();
            filtersPopulated = true;
        }

        // Render rows
        const qualityBadge = {
            lent: '<span class="badge badge-red">🐢 Lent</span>',
            moyen: '<span class="badge badge-yellow">🚶 Moyen</span>',
            rapide: '<span class="badge badge-green">🚀 Rapide</span>'
        };

        tbody.innerHTML = data.map((s, i) => `
            <tr>
                <td class="cell-id">${(pagination.page - 1) * perPage + i + 1}</td>
                <td><span class="operator-tag">${s.operator}</span></td>
                <td>${qualityBadge[s.quality] || s.quality}</td>
                <td>${s.city}</td>
                <td>${s.neighborhood || '—'}</td>
                <td>${s.speed_mbps ? s.speed_mbps + ' Mbps' : '—'}</td>
                <td class="cell-date">${formatDate(s.created_at)}</td>
                <td>
                    <button class="btn-icon-action" onclick="deleteSubmission(${s.id})" title="Supprimer">
                        🗑️
                    </button>
                </td>
            </tr>
        `).join('');

        // Pagination
        renderPagination(pagination);

    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

async function populateFilters() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        const opSelect = document.getElementById('hist-operator');
        const citySelect = document.getElementById('hist-city');

        data.operators.forEach(op => {
            const opt = document.createElement('option');
            opt.value = op;
            opt.textContent = op;
            opSelect.appendChild(opt);
        });

        data.cities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            citySelect.appendChild(opt);
        });
    } catch (err) {}
}

function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function renderPagination(pag) {
    const container = document.getElementById('hist-pagination');
    if (pag.pages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';

    // Prev
    html += `<button class="page-btn" ${pag.page <= 1 ? 'disabled' : ''} onclick="goToPage(${pag.page - 1})">‹</button>`;

    // Page numbers
    const maxVisible = 5;
    let start = Math.max(1, pag.page - Math.floor(maxVisible / 2));
    let end = Math.min(pag.pages, start + maxVisible - 1);
    if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

    if (start > 1) {
        html += `<button class="page-btn" onclick="goToPage(1)">1</button>`;
        if (start > 2) html += `<span class="page-dots">…</span>`;
    }

    for (let i = start; i <= end; i++) {
        html += `<button class="page-btn ${i === pag.page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    if (end < pag.pages) {
        if (end < pag.pages - 1) html += `<span class="page-dots">…</span>`;
        html += `<button class="page-btn" onclick="goToPage(${pag.pages})">${pag.pages}</button>`;
    }

    // Next
    html += `<button class="page-btn" ${pag.page >= pag.pages ? 'disabled' : ''} onclick="goToPage(${pag.page + 1})">›</button>`;

    container.innerHTML = html;
}

function goToPage(page) {
    currentPage = page;
    loadHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteSubmission(id) {
    if (!confirm('Supprimer cette soumission ?')) return;
    try {
        const res = await fetch(`/api/submissions/${id}`, { method: 'DELETE' });
        if (res.ok) loadHistory();
    } catch (err) {
        alert('Erreur lors de la suppression');
    }
}

// ── Events ──
document.getElementById('hist-operator').addEventListener('change', () => { currentPage = 1; loadHistory(); });
document.getElementById('hist-city').addEventListener('change', () => { currentPage = 1; loadHistory(); });
document.getElementById('hist-quality').addEventListener('change', () => { currentPage = 1; loadHistory(); });
document.getElementById('hist-reset').addEventListener('click', () => {
    document.getElementById('hist-operator').value = '';
    document.getElementById('hist-city').value = '';
    document.getElementById('hist-quality').value = '';
    currentPage = 1;
    loadHistory();
});

document.addEventListener('DOMContentLoaded', loadHistory);
