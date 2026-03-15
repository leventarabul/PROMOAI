/* ═══════════════════════════════════════════════════
   Tab 5: Behavior Aggregation — 3-Step Pipeline
   Event → Davranış Özeti
   ═══════════════════════════════════════════════════ */

// NOTE: No optional chaining (?.) used anywhere — formatter breaks it

var _behaviorProfiles = {};

document.getElementById('btnAggregate').addEventListener('click', runBehaviorAggregation);

function bAnimateStep(stepId, connectorIndex) {
    return new Promise(function(resolve) {
        var step = document.getElementById(stepId);
        step.classList.add('active');
        var connectors = document.querySelectorAll('#behaviorPipeline .assign-connector');
        if (connectorIndex > 0 && connectors[connectorIndex - 1]) {
            connectors[connectorIndex - 1].classList.add('done');
        }
        setTimeout(resolve, 400);
    });
}

function bCompleteStep(stepId, text) {
    var step = document.getElementById(stepId);
    step.classList.remove('active');
    step.classList.add('done');
    step.querySelector('.assign-step-status').textContent = text;
}

function buildCategoryTags(categories) {
    if (!categories || categories.length === 0) return '<span style="color:var(--text-muted)">—</span>';
    return categories.map(function(cat) {
        var icon = CATEGORY_ICONS[cat] || '📦';
        return '<span class="ctx-tag">' + icon + ' ' + cat + '</span>';
    }).join('');
}

function buildFreqBadge(freq) {
    var colors = {
        weekly: { bg: 'var(--success-dim)', color: 'var(--success)', label: 'Haftalık' },
        biweekly: { bg: 'var(--accent-glow)', color: 'var(--accent)', label: '2 Haftalık' },
        monthly: { bg: 'var(--warning-dim)', color: 'var(--warning)', label: 'Aylık' },
        rare: { bg: 'var(--error-dim)', color: 'var(--error)', label: 'Seyrek' },
        none: { bg: 'var(--bg-secondary)', color: 'var(--text-muted)', label: 'Veri Yok' },
    };
    var cfg = colors[freq] || colors.none;
    return '<span class="freq-badge" style="background:' + cfg.bg + ';color:' + cfg.color + '">' + cfg.label + '</span>';
}

function formatMoney(val) {
    return Number(val).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

async function runBehaviorAggregation() {
    var btn = document.getElementById('btnAggregate');
    var timer = document.getElementById('behaviorTimer');
    setButtonLoading(btn, true, 'Profiller Güncelleniyor...');
    timer.textContent = '';

    // Reset pipeline steps
    document.querySelectorAll('#behaviorPipeline .assign-step').forEach(function(step) {
        step.classList.remove('active', 'done');
        step.querySelector('.assign-step-status').textContent = '';
    });
    document.querySelectorAll('#behaviorPipeline .assign-connector').forEach(function(c) {
        c.classList.remove('done');
    });
    hide(document.getElementById('behaviorStatsPanel'));
    hide(document.getElementById('behaviorGrid'));
    hide(document.getElementById('behaviorSummary'));

    var startTime = Date.now();
    var timerInterval = setInterval(function() {
        timer.textContent = '⏱ ' + formatDuration(Date.now() - startTime);
    }, 100);

    try {
        // ── Step 1: Veri Toplama ──
        await bAnimateStep('bStep1', 0);

        var stats = await api('/api/behavior/stats');
        var events = stats.events || {};
        var profiles = stats.profiles || [];

        _behaviorProfiles = {};
        for (var i = 0; i < profiles.length; i++) {
            _behaviorProfiles[profiles[i].customer_id] = profiles[i];
        }

        var statsPanel = document.getElementById('behaviorStatsPanel');
        document.getElementById('statEvents').innerHTML =
            '<div class="stat-big">' + formatMoney(events.total_events || 0) + '</div>' +
            '<div class="stat-label">Toplam Event</div>';
        document.getElementById('statCustomers').innerHTML =
            '<div class="stat-big">' + (events.unique_users || 0) + '</div>' +
            '<div class="stat-label">Aktif Müşteri</div>';
        document.getElementById('statDateRange').innerHTML =
            '<div class="stat-big">90</div>' +
            '<div class="stat-label">Gün Aralığı</div>';
        show(statsPanel);

        bCompleteStep('bStep1', (events.total_events || 0) + ' event');
        await sleep(400);

        // ── Step 2: Hesaplama ──
        await bAnimateStep('bStep2', 1);

        var result = await api('/api/behavior/aggregate', { method: 'POST' });

        bCompleteStep('bStep2', result.customersProcessed + ' müşteri');
        await sleep(400);

        // ── Step 3: Kaydetme ──
        await bAnimateStep('bStep3', 2);

        var grid = document.getElementById('behaviorGrid');
        grid.innerHTML = '';
        show(grid);

        var results = result.results || [];
        for (var j = 0; j < results.length; j++) {
            var r = results[j];
            var profile = _behaviorProfiles[r.customer_id] || {};
            var segment = (profile.segment || 'standard').toLowerCase();
            var segColor = SEGMENT_COLORS[segment] || SEGMENT_COLORS.standard;
            var newData = r['new'] || {};
            var oldData = r.old || {};

            var spendDiff = newData.total_spend - oldData.total_spend;
            var spendDiffStr = '';
            if (spendDiff > 0) {
                spendDiffStr = '<span style="color:var(--success);font-size:0.7rem"> ▲ +₺' + formatMoney(spendDiff) + '</span>';
            } else if (spendDiff < 0) {
                spendDiffStr = '<span style="color:var(--error);font-size:0.7rem"> ▼ -₺' + formatMoney(Math.abs(spendDiff)) + '</span>';
            }

            var eventDiff = newData.total_events - oldData.total_events;
            var eventDiffStr = '';
            if (eventDiff > 0) {
                eventDiffStr = '<span style="color:var(--success);font-size:0.7rem"> +' + eventDiff + '</span>';
            } else if (eventDiff < 0) {
                eventDiffStr = '<span style="color:var(--error);font-size:0.7rem"> ' + eventDiff + '</span>';
            }

            var card = document.createElement('div');
            card.className = 'behavior-card';
            card.innerHTML =
                '<div class="bcard-header">' +
                '<div class="cust-avatar ' + segment + '">' + r.customer_id.replace('u_', '') + '</div>' +
                '<div class="bcard-info">' +
                '<div class="bcard-name">' + r.customer_id + '</div>' +
                '<div class="bcard-meta">' +
                '<span class="segment-badge ' + segment + '" style="font-size:0.65rem;padding:2px 8px">' + segment.toUpperCase() + '</span> · ' +
                (profile.age_range || '') + ' · ' + (profile.location || '') +
                '</div>' +
                '</div>' +
                (r.changed ? '<div class="bcard-badge" style="color:var(--success)">✅ Güncellendi</div>' :
                    '<div class="bcard-badge" style="color:var(--text-muted)">— Değişiklik yok</div>') +
                '</div>' +
                '<div class="bcard-metrics">' +
                '<div class="metric-item">' +
                '<div class="metric-value">₺' + formatMoney(newData.total_spend) + '</div>' +
                '<div class="metric-label">Toplam Harcama ' + spendDiffStr + '</div>' +
                '</div>' +
                '<div class="metric-item">' +
                '<div class="metric-value">' + newData.total_events + '</div>' +
                '<div class="metric-label">Toplam Event ' + eventDiffStr + '</div>' +
                '</div>' +
                '<div class="metric-item">' +
                '<div class="metric-value">₺' + formatMoney(newData.avg_order_value) + '</div>' +
                '<div class="metric-label">Ort. Sipariş</div>' +
                '</div>' +
                '<div class="metric-item">' +
                buildFreqBadge(newData.purchase_frequency) +
                '<div class="metric-label">Sıklık (~' + (newData.avg_days_between || 0) + ' gün)</div>' +
                '</div>' +
                '</div>' +
                '<div class="bcard-categories">' +
                '<span style="font-size:0.72rem;color:var(--text-dim);margin-right:6px">Favori:</span>' +
                buildCategoryTags(newData.favorite_categories) +
                '</div>';

            grid.appendChild(card);
            await sleep(200);
            card.classList.add('visible');
        }

        bCompleteStep('bStep3', result.customersUpdated + ' güncellendi');

        // ── Summary ──
        clearInterval(timerInterval);
        var elapsed = Date.now() - startTime;
        timer.textContent = '✅ ' + formatDuration(elapsed);

        var summary = document.getElementById('behaviorSummary');
        summary.innerHTML =
            '<div class="summary-item"><div class="summary-value">' + result.customersProcessed + '</div><div class="summary-label">Müşteri</div></div>' +
            '<div class="summary-item"><div class="summary-value">' + (events.total_events || 0) + '</div><div class="summary-label">Event İşlendi</div></div>' +
            '<div class="summary-item"><div class="summary-value">' + result.customersUpdated + '</div><div class="summary-label">Güncellendi</div></div>' +
            '<div class="summary-item"><div class="summary-value">' + formatDuration(result.duration) + '</div><div class="summary-label">DB Süresi</div></div>' +
            '<div class="summary-item"><div class="summary-value">' + formatDuration(elapsed) + '</div><div class="summary-label">Toplam Süre</div></div>';
        show(summary);

    } catch (err) {
        clearInterval(timerInterval);
        timer.textContent = '❌ Hata: ' + err.message;
    } finally {
        setButtonLoading(btn, false);
    }
}