/* ═══════════════════════════════════════════════════
   PromoAI Dashboard — Core App Logic
   ═══════════════════════════════════════════════════ */

// ─── Tab switching ───
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
});

// ─── Helpers ───
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
}

function show(el) { el.classList.remove('hidden'); }

function hide(el) { el.classList.add('hidden'); }

function setButtonLoading(btn, loading, text) {
    btn.disabled = loading;
    if (loading) {
        btn.dataset.origText = btn.innerHTML;
        btn.classList.add('running');
        btn.innerHTML = `<span class="spinner"></span> ${text || 'Çalışıyor...'}`;
    } else {
        btn.classList.remove('running');
        btn.innerHTML = btn.dataset.origText || btn.innerHTML;
    }
}

const CATEGORY_ICONS = {
    grocery: '🛒',
    fuel: '⛽',
    electronics: '💻',
    travel: '✈️',
    dining: '🍽️',
    banking: '🏦',
};

const SEGMENT_COLORS = { gold: '#ffd700', silver: '#c0c0c0', bronze: '#cd7f32', standard: '#666' };

function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(str, max = 120) {
    return str && str.length > max ? str.slice(0, max) + '…' : str;
}