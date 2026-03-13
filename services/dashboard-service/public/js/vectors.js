/* ═══════════════════════════════════════════════════
   Tab 2: Vector DB — 3D Scatter Plot (Plotly)
   ═══════════════════════════════════════════════════ */

document.getElementById('btnLoadEmbeddings').addEventListener('click', loadEmbeddings);

async function loadEmbeddings() {
    const btn = document.getElementById('btnLoadEmbeddings');
    setButtonLoading(btn, true, 'Embedding Yükleniyor...');

    const statsEl = document.getElementById('embeddingStats');
    const msgEl = document.getElementById('vectorMessage');
    hide(msgEl);

    try {
        const data = await api('/api/embeddings/scatter');

        if (!data.points || data.points.length < 3) {
            show(msgEl);
            msgEl.textContent = data.message || 'Yeterli embedding bulunamadı. Önce Trend ve Assignment job çalıştırın.';
            statsEl.innerHTML = '';
            Plotly.purge('scatterPlot');
            return;
        }

        // Stats badges
        const s = data.stats;
        statsEl.innerHTML = `
            <span class="stat-badge">🔴 Kampanya: <strong>${s.campaigns}</strong></span>
            <span class="stat-badge">🔵 Müşteri: <strong>${s.customers}</strong></span>
            <span class="stat-badge">🟢 Context: <strong>${s.contexts}</strong></span>
            <span class="stat-badge">Toplam: <strong>${s.total}</strong></span>`;

        renderScatter(data.points);
    } catch (err) {
        show(msgEl);
        msgEl.textContent = `Hata: ${err.message}`;
    } finally {
        setButtonLoading(btn, false);
    }
}

function renderScatter(points) {
    const typeConfig = {
        campaign: { color: '#ff4466', symbol: 'diamond', name: 'Kampanyalar', size: 12 },
        customer: { color: '#00d4ff', symbol: 'circle', name: 'Müşteriler', size: 10 },
        context: { color: '#00ff88', symbol: 'square', name: "Context'ler", size: 9 },
    };

    const traces = [];

    for (const [type, cfg] of Object.entries(typeConfig)) {
        const pts = points.filter(p => p.type === type);
        if (pts.length === 0) continue;

        traces.push({
            x: pts.map(p => p.x),
            y: pts.map(p => p.y),
            z: pts.map(p => p.z),
            text: pts.map(p => {
                const lines = [`<b>${p.label}</b>`];
                if (p.category) lines.push(`Kategori: ${p.category}`);
                if (p.segment) lines.push(`Segment: ${p.segment}`);
                if (p.location) lines.push(`Lokasyon: ${p.location}`);
                if (p.priority) lines.push(`Öncelik: ${p.priority}`);
                return lines.join('<br>');
            }),
            hoverinfo: 'text',
            mode: 'markers+text',
            textposition: 'top center',
            textfont: { size: 9, color: cfg.color },
            marker: {
                size: cfg.size,
                color: cfg.color,
                symbol: cfg.symbol,
                opacity: 0.9,
                line: { width: 1, color: 'rgba(255,255,255,0.3)' },
            },
            name: cfg.name,
            type: 'scatter3d',
        });
    }

    // Draw connection lines from customers to their nearest campaigns
    const campaigns = points.filter(p => p.type === 'campaign');
    const customers = points.filter(p => p.type === 'customer');
    if (campaigns.length > 0 && customers.length > 0) {
        for (const cust of customers) {
            let minDist = Infinity,
                nearest = null;
            for (const camp of campaigns) {
                const d = Math.sqrt((cust.x - camp.x) ** 2 + (cust.y - camp.y) ** 2 + (cust.z - camp.z) ** 2);
                if (d < minDist) { minDist = d;
                    nearest = camp; }
            }
            if (nearest) {
                traces.push({
                    x: [cust.x, nearest.x],
                    y: [cust.y, nearest.y],
                    z: [cust.z, nearest.z],
                    mode: 'lines',
                    line: { color: 'rgba(0,212,255,0.15)', width: 2 },
                    showlegend: false,
                    hoverinfo: 'skip',
                    type: 'scatter3d',
                });
            }
        }
    }

    const layout = {
        paper_bgcolor: '#0d1025',
        plot_bgcolor: '#0d1025',
        font: { family: 'Inter, sans-serif', color: '#e8eaf6', size: 11 },
        scene: {
            xaxis: { title: 'PC1', gridcolor: '#1a1e4a', zerolinecolor: '#2a2e5a', showbackground: false },
            yaxis: { title: 'PC2', gridcolor: '#1a1e4a', zerolinecolor: '#2a2e5a', showbackground: false },
            zaxis: { title: 'PC3', gridcolor: '#1a1e4a', zerolinecolor: '#2a2e5a', showbackground: false },
            bgcolor: '#0d1025',
            camera: { eye: { x: 1.5, y: 1.5, z: 1.0 } },
        },
        legend: { x: 0, y: 1, bgcolor: 'rgba(13,16,37,0.8)', bordercolor: 'rgba(0,212,255,0.12)', borderwidth: 1 },
        margin: { l: 0, r: 0, t: 30, b: 0 },
        title: { text: 'Embedding Uzayı (PCA → 3D)', font: { size: 14, color: '#7882a4' } },
    };

    Plotly.newPlot('scatterPlot', traces, layout, {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
    });

    // Auto-rotate
    let angle = 0;
    const rotateInterval = setInterval(() => {
        angle += 0.5;
        const rad = (angle * Math.PI) / 180;
        Plotly.relayout('scatterPlot', {
            'scene.camera.eye': { x: 1.8 * Math.cos(rad), y: 1.8 * Math.sin(rad), z: 0.8 },
        });
    }, 80);

    // Stop rotation on user interaction
    document.getElementById('scatterPlot').on('plotly_relayout', () => {
        clearInterval(rotateInterval);
    });
}