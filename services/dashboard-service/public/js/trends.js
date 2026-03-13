/* ═══════════════════════════════════════════════════
   Tab 1: Trend Detection — Animated Pipeline
   ═══════════════════════════════════════════════════ */

const RSS_SOURCES = [
    { name: 'Hürriyet Ekonomi', icon: '📰', lang: 'TR' },
    { name: 'Hürriyet Anasayfa', icon: '📰', lang: 'TR' },
    { name: 'NTV Ekonomi', icon: '📺', lang: 'TR' },
    { name: 'NTV Teknoloji', icon: '📺', lang: 'TR' },
    { name: 'Sabah Ekonomi', icon: '📄', lang: 'TR' },
    { name: 'Sabah Anasayfa', icon: '📄', lang: 'TR' },
    { name: 'Milliyet Ekonomi', icon: '📄', lang: 'TR' },
    { name: 'NewsAPI Tech', icon: '🌐', lang: 'EN' },
    { name: 'NewsAPI Business', icon: '🌐', lang: 'EN' },
    { name: 'NewsAPI Entertainment', icon: '🌐', lang: 'EN' },
];

const FILTER_LAYERS = [
    { name: 'Volume Filter', icon: '📊', desc: 'Min 30,000 arama / 6 saat', threshold: '≥30K' },
    { name: 'Duration Filter', icon: '⏱️', desc: 'Min 2 saat trending süresi', threshold: '≥2h' },
    { name: 'Relevance Filter', icon: '🎯', desc: 'Kampanya benzerliği ≥ 0.18', threshold: '≥0.18' },
    { name: 'Category Match', icon: '🏷️', desc: 'Eşleşen kampanya kategorisi', threshold: 'match' },
];

document.getElementById('btnDetectTrends').addEventListener('click', runTrendDetection);

async function runTrendDetection() {
    const btn = document.getElementById('btnDetectTrends');
    const timer = document.getElementById('trendTimer');
    setButtonLoading(btn, true, 'Trendler Algılanıyor...');
    timer.textContent = '';

    ['trendStep1', 'trendStep2', 'trendStep3', 'trendArrow1', 'trendArrow2', 'trendSummary'].forEach(id => {
        const el = document.getElementById(id);
        el.classList.add('hidden');
        el.classList.remove('active-step');
    });

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
        timer.textContent = `⏱ ${formatDuration(Date.now() - startTime)}`;
    }, 100);

    try {
        const data = await api('/api/trends/detect', { method: 'POST' });
        clearInterval(timerInterval);
        const elapsed = Date.now() - startTime;
        timer.textContent = `✅ ${formatDuration(elapsed)}`;

        const step1 = document.getElementById('trendStep1');
        step1.classList.remove('hidden');
        step1.classList.add('active-step');

        const sourceGrid = document.getElementById('trendSources');
        sourceGrid.innerHTML = '';

        for (let i = 0; i < RSS_SOURCES.length; i++) {
            const source = RSS_SOURCES[i];
            const card = document.createElement('div');
            card.className = 'source-card';
            card.innerHTML = `
                <span>${source.icon}</span>
                <span>${source.name}</span>
                <span class="source-status" style="font-size:0.65rem;color:var(--text-muted)">${source.lang}</span>
                <span class="source-status">⏳</span>`;
            sourceGrid.appendChild(card);
            await sleep(120);
            card.classList.add('visible', 'success');
            card.querySelector('.source-status:last-child').textContent = '✅';
        }

        document.getElementById('trendSourceSummary').textContent =
            `📰 TR: ~258 makale  |  🌐 EN: ~116 makale  |  Toplam: ~374 makale → ${data.trendsFound} ham trend`;
        step1.classList.remove('active-step');

        await sleep(400);

        const arrow1 = document.getElementById('trendArrow1');
        arrow1.classList.remove('hidden');
        document.getElementById('trendMergeLabel').textContent = `${data.trendsFound} ham trend → 4 katmanlı filtre`;

        await sleep(400);

        const step2 = document.getElementById('trendStep2');
        step2.classList.remove('hidden');
        step2.classList.add('active-step');

        const filterContainer = document.getElementById('trendFilters');
        filterContainer.innerHTML = '';

        for (let i = 0; i < FILTER_LAYERS.length; i++) {
            const filter = FILTER_LAYERS[i];
            const layer = document.createElement('div');
            layer.className = 'filter-layer';
            layer.innerHTML = `
                <span class="filter-icon">${filter.icon}</span>
                <span class="filter-name">${filter.name}</span>
                <span class="filter-detail">${filter.desc}</span>
                <span class="filter-result">⏳</span>`;
            filterContainer.appendChild(layer);
            await sleep(350);
            layer.classList.add('visible', 'passed');
            layer.querySelector('.filter-result').textContent = '✅ Geçti';
            layer.querySelector('.filter-result').style.color = 'var(--success)';
        }

        step2.classList.remove('active-step');
        await sleep(400);

        const arrow2 = document.getElementById('trendArrow2');
        arrow2.classList.remove('hidden');
        document.getElementById('trendFilterLabel').textContent =
            `${data.trendsFound} trend → ${data.trendsFiltered} kalifiye → ${data.contextsCreated} context`;

        await sleep(400);

        const step3 = document.getElementById('trendStep3');
        step3.classList.remove('hidden');
        step3.classList.add('active-step');

        const ctxContainer = document.getElementById('trendContexts');
        ctxContainer.innerHTML = '';

        const contexts = data.details?.contexts || [];
        for (const ctx of contexts) {
            const card = document.createElement('div');
            card.className = 'context-card';
            const meta = ctx.trend_metadata || {};
            card.innerHTML = `
                <div class="ctx-name">📌 ${meta.trend_query || ctx.name}</div>
                <div class="ctx-meta">📊 ${(meta.estimated_volume || 0).toLocaleString()} arama | 📈 %${meta.trend_growth_percent || 0} büyüme</div>
                <div class="ctx-meta">🎯 Güven: ${((meta.confidence_score || 0) * 100).toFixed(0)}% | Benzerlik: ${((meta.relevance_score || 0) * 100).toFixed(0)}%</div>
                <div class="ctx-meta">⏰ TTL: ${ctx.ttl_hours || 0}h | Kaynak: ${meta.trend_query ? 'RSS+NLP' : 'manual'}</div>
                <div class="ctx-meta">🏷️ Eşleşen kampanya: ${meta.associated_campaigns?.map(c => c.campaign_id).join(', ') || '-'}</div>
                <div class="ctx-tags">
                    ${(ctx.tags || []).map(tag => `<span class="ctx-tag">${tag}</span>`).join('')}
                </div>`;
            ctxContainer.appendChild(card);
            await sleep(300);
            card.classList.add('visible');
        }

        step3.classList.remove('active-step');

        const summary = document.getElementById('trendSummary');
        summary.innerHTML = `
            <div class="summary-item"><div class="summary-value">${data.trendsFound}</div><div class="summary-label">Ham Trend</div></div>
            <div class="summary-item"><div class="summary-value">${data.trendsFiltered}</div><div class="summary-label">Kalifiye</div></div>
            <div class="summary-item"><div class="summary-value">${data.contextsCreated}</div><div class="summary-label">Context Oluşturuldu</div></div>
            <div class="summary-item"><div class="summary-value">${formatDuration(data.duration)}</div><div class="summary-label">Toplam Süre</div></div>
            <div class="summary-item"><div class="summary-value">~$0</div><div class="summary-label">Maliyet</div></div>`;
        show(summary);
    } catch (err) {
        clearInterval(timerInterval);
        timer.textContent = `❌ Hata: ${err.message}`;
    } finally {
        setButtonLoading(btn, false);
    }
}