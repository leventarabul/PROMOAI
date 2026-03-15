/* ═══════════════════════════════════════════════════
   Tab 4: Assignment Results — Rich Data Display
   ═══════════════════════════════════════════════════ */

document.getElementById('btnLoadResults').addEventListener('click', loadResults);

async function loadResults() {
    const btn = document.getElementById('btnLoadResults');
    const container = document.getElementById('resultsContainer');
    const count = document.getElementById('resultCount');
    setButtonLoading(btn, true, 'Sonuçlar Yükleniyor...');
    container.innerHTML = '';
    count.textContent = '';

    try {
        const rows = await api('/api/assignments/results');

        if (!rows || rows.length === 0) {
            container.innerHTML = '<div class="empty-state">Henüz atama sonucu bulunamadı.<br>Önce <strong>Kampanya Atama</strong> tabından atama yapın.</div>';
            count.textContent = '0 atama';
            return;
        }

        const groups = {};
        for (const row of rows) {
            const uid = row.user_id;
            if (!groups[uid]) {
                groups[uid] = {
                    customer: {
                        id: uid,
                        segment: row.segment || 'standard',
                        location: row.location || '-',
                        age_range: row.age_range || '-',
                        preferences: row.preferences,
                    },
                    assignments: [],
                };
            }
            groups[uid].assignments.push(row);
        }

        count.textContent = `${rows.length} atama · ${Object.keys(groups).length} müşteri`;

        let delay = 0;
        for (const [uid, group] of Object.entries(groups)) {
            const segment = (group.customer.segment || 'silver').toLowerCase();
            const segmentColor = SEGMENT_COLORS[segment] || SEGMENT_COLORS.standard;
            var _gprefs = group.customer.preferences || {};
            const interests = (_gprefs.interests && _gprefs.interests.join(', ')) || (_gprefs.favorite_categories && _gprefs.favorite_categories.join(', ')) || '-';

            const groupEl = document.createElement('div');
            groupEl.className = 'result-group';
            groupEl.style.animationDelay = `${delay}ms`;

            groupEl.innerHTML = `
                <div class="result-group-header">
                    <div class="rg-avatar" style="background:${segmentColor}">${uid.replace('u_', '')}</div>
                    <div class="rg-info">
                        <div class="rg-name">${uid} <span class="segment-badge ${segment}">${segment.toUpperCase()}</span></div>
                        <div class="rg-detail">${group.customer.age_range} · ${group.customer.location} · ${interests}</div>
                    </div>
                    <div class="rg-count">${group.assignments.length} kampanya</div>
                </div>
                <div class="assignment-list">${group.assignments.map(assignment => renderAssignment(assignment)).join('')}</div>`;

            container.appendChild(groupEl);
            delay += 120;
        }

        await sleep(50);
        container.querySelectorAll('.result-group').forEach(el => el.classList.add('visible'));
    } catch (err) {
        container.innerHTML = `<div class="empty-state error">❌ Hata: ${err.message}</div>`;
    } finally {
        setButtonLoading(btn, false);
    }
}

function renderAssignment(assignment) {
    const category = (assignment.category || 'other').toLowerCase();
    const icon = CATEGORY_ICONS[category] || '🎁';
    const categoryClass = category.replace(/[^a-z]/g, '');
    const reward = assignment.reward_type === 'cashback' ?
        `💰 %${assignment.reward_value} Cashback` :
        assignment.reward_type === 'points' ?
        `⭐ ${assignment.reward_value}x Puan` :
        `🎁 ${assignment.reward_value}`;

    const reason = assignment.reason || assignment.assignment_reason || 'Sebep belirtilmemiş';
    const date = assignment.created_at ? new Date(assignment.created_at).toLocaleString('tr-TR') : '';

    return `
        <div class="assignment-row">
            <div class="campaign-icon ${categoryClass}">${icon}</div>
            <div class="ar-body">
                <div class="ar-header">
                    <span class="ar-name">${assignment.campaign_name || assignment.campaign_id}</span>
                    <span class="ar-reward">${reward}</span>
                </div>
                <div class="ai-reason">
                    <span class="ai-label">🤖 AI:</span> ${escapeHtml(reason)}
                </div>
                <div class="ar-meta">
                    <span class="ar-status ${(assignment.status || 'active').toLowerCase()}">${assignment.status || 'active'}</span>
                    <span class="ar-date">${date}</span>
                </div>
            </div>
        </div>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}