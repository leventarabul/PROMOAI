/* ═══════════════════════════════════════════════════
   Tab 3: Assignment Pipeline — Animated Flow
   ═══════════════════════════════════════════════════ */

document.getElementById('btnRunAssignment').addEventListener('click', runAssignment);

async function runAssignment() {
    const btn = document.getElementById('btnRunAssignment');
    const timer = document.getElementById('assignTimer');
    setButtonLoading(btn, true, 'Pipeline Çalışıyor...');
    timer.textContent = '';

    document.querySelectorAll('.assign-step').forEach(step => {
        step.classList.remove('active', 'done');
        step.querySelector('.assign-step-status').textContent = '';
    });
    document.querySelectorAll('.assign-connector').forEach(connector => connector.classList.remove('done'));
    hide(document.getElementById('assignSummary'));

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
        timer.textContent = `⏱ ${formatDuration(Date.now() - startTime)}`;
    }, 100);

    try {
        const customers = await api('/api/customers');

        const progressEl = document.getElementById('customerProgress');
        const cardsEl = document.getElementById('customerCards');
        cardsEl.innerHTML = '';
        show(progressEl);

        for (const customer of customers) {
            const segment = (customer.segment || 'silver').toLowerCase();
            const interests = customer.preferences?.interests?.join(', ') || customer.favorite_categories?.join(', ') || '-';
            const card = document.createElement('div');
            card.className = 'customer-card';
            card.id = `ccard-${customer.customer_id}`;
            card.innerHTML = `
                <div class="cust-avatar ${segment}">${customer.customer_id.replace('u_', '')}</div>
                <div class="cust-info">
                    <div class="cust-name">${customer.customer_id}</div>
                    <div class="cust-detail">${segment.toUpperCase()} · ${customer.age_range} · ${customer.location} · ${interests}</div>
                </div>
                <div class="cust-progress"><div class="cust-progress-bar" id="pbar-${customer.customer_id}"></div></div>
                <div class="cust-result" id="presult-${customer.customer_id}">Bekliyor</div>`;
            cardsEl.appendChild(card);
        }

        for (const customer of customers) {
            await sleep(100);
            document.getElementById(`ccard-${customer.customer_id}`).classList.add('visible');
        }

        await sleep(300);

        await animateStep('aStep1', 0);
        const ctxData = await api('/api/contexts/active');
        const ctxCount = ctxData.contexts?.length || 0;
        completeStep('aStep1', `${ctxCount} context`);

        await sleep(300);

        await animateStep('aStep2', 1);
        await sleep(200);
        completeStep('aStep2', `${customers.length} müşteri`);

        await sleep(300);

        const animationPromise = animateCustomerSteps(customers);
        const result = await api('/api/assignments/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });

        await animationPromise;

        clearInterval(timerInterval);
        const elapsed = Date.now() - startTime;
        timer.textContent = `✅ ${formatDuration(elapsed)}`;

        const summary = document.getElementById('assignSummary');
        summary.innerHTML = `
            <div class="summary-item"><div class="summary-value">${result.totalCustomers}</div><div class="summary-label">Müşteri</div></div>
            <div class="summary-item"><div class="summary-value">${result.processed}</div><div class="summary-label">İşlendi</div></div>
            <div class="summary-item"><div class="summary-value">${result.assignmentsInserted}</div><div class="summary-label">Yeni Atama</div></div>
            <div class="summary-item"><div class="summary-value">${result.activeContexts}</div><div class="summary-label">Aktif Context</div></div>
            <div class="summary-item"><div class="summary-value">${result.failures}</div><div class="summary-label">Hata</div></div>
            <div class="summary-item"><div class="summary-value">${formatDuration(elapsed)}</div><div class="summary-label">Toplam Süre</div></div>`;
        show(summary);
    } catch (err) {
        clearInterval(timerInterval);
        timer.textContent = `❌ Hata: ${err.message}`;
    } finally {
        setButtonLoading(btn, false);
    }
}

async function animateStep(stepId, connectorIndex) {
    const step = document.getElementById(stepId);
    step.classList.add('active');
    step.querySelector('.assign-step-status').textContent = '⏳';

    const connectors = document.querySelectorAll('.assign-connector');
    if (connectorIndex > 0 && connectors[connectorIndex - 1]) {
        connectors[connectorIndex - 1].classList.add('done');
    }
}

function completeStep(stepId, text) {
    const step = document.getElementById(stepId);
    step.classList.remove('active');
    step.classList.add('done');
    step.querySelector('.assign-step-status').textContent = `✅ ${text}`;

    const steps = ['aStep1', 'aStep2', 'aStep3', 'aStep4', 'aStep5', 'aStep6'];
    const idx = steps.indexOf(stepId);
    const connectors = document.querySelectorAll('.assign-connector');
    if (idx >= 0 && connectors[idx]) {
        connectors[idx].classList.add('done');
    }
}

async function animateCustomerSteps(customers) {
    const stepNames = [
        { id: 'aStep3', label: 'Embedding', conn: 2 },
        { id: 'aStep4', label: 'Vector Search', conn: 3 },
        { id: 'aStep5', label: 'GPT Seçim', conn: 4 },
        { id: 'aStep6', label: 'Kaydet', conn: 5 },
    ];

    for (let stepIndex = 0; stepIndex < stepNames.length; stepIndex++) {
        const stepMeta = stepNames[stepIndex];
        await animateStep(stepMeta.id, stepMeta.conn);

        for (let customerIndex = 0; customerIndex < customers.length; customerIndex++) {
            const customer = customers[customerIndex];
            const card = document.getElementById(`ccard-${customer.customer_id}`);
            const progressBar = document.getElementById(`pbar-${customer.customer_id}`);
            const resultEl = document.getElementById(`presult-${customer.customer_id}`);

            card.classList.add('processing');
            resultEl.textContent = `${stepMeta.label}...`;
            resultEl.style.color = 'var(--warning)';

            const progress = ((stepIndex * customers.length + customerIndex + 1) / (stepNames.length * customers.length)) * 100;
            progressBar.style.width = `${progress}%`;

            await sleep(stepIndex === 2 ? 400 : 150);
        }

        completeStep(stepMeta.id, `${customers.length} müşteri`);
    }

    for (const customer of customers) {
        const card = document.getElementById(`ccard-${customer.customer_id}`);
        const resultEl = document.getElementById(`presult-${customer.customer_id}`);
        card.classList.remove('processing');
        card.classList.add('done');
        resultEl.textContent = '✅ Tamamlandı';
        resultEl.style.color = 'var(--success)';
    }
}