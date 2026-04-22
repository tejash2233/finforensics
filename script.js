let currentAnalysis = null;
let networkGraph = null;

// View Management
function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    if (window.event && window.event.target && window.event.target.tagName === 'A') {
        window.event.target.classList.add('active');
    }
}

// File Upload Handling
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const analyzeBtn = document.getElementById('analyzeBtn');
const uploadForm = document.getElementById('uploadForm');

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; updateFileInfo(); }
});
fileInput.addEventListener('change', updateFileInfo);

function updateFileInfo() {
    if (fileInput.files.length > 0) {
        fileInfo.textContent = `Selected: ${fileInput.files[0].name}`;
        fileInfo.classList.remove('hidden');
        analyzeBtn.classList.remove('hidden');
    }
}

// Form Submission
uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(uploadForm);
    
    switchView('processing-view');
    document.querySelector('.status-badge').textContent = 'Analyzing Active';
    document.querySelector('.status-badge').style.color = 'var(--accent-green)';

    let startTime = Date.now();
    let timerInt = setInterval(() => { document.getElementById('timer').textContent = ((Date.now() - startTime) / 1000).toFixed(1) + 's'; }, 100);

    setTimeout(() => { document.getElementById('step1').classList.remove('active'); document.getElementById('step2').classList.add('active'); }, 800);
    setTimeout(() => { document.getElementById('step2').classList.remove('active'); document.getElementById('step3').classList.add('active'); }, 1800);
    setTimeout(() => { document.getElementById('step3').classList.remove('active'); document.getElementById('step4').classList.add('active'); }, 2600);

    try {
        const res = await fetch("/upload", { method: "POST", body: formData });
        const data = await res.json();
        
        clearInterval(timerInt);
        
        // CRITICAL FIX: EXPLICITLY CHECK FOR ERRORS
        if (!res.ok || data.error) {
            throw new Error(data.error || `Server returned status ${res.status}`);
        }

        currentAnalysis = data.analysis;
        
        setTimeout(() => {
            switchView('dashboard-view');
            setTimeout(() => { updateDashboardUI(currentAnalysis, data.graph); }, 250);
        }, 500);

    } catch (error) {
        clearInterval(timerInt);
        // Display the EXACT error to the user
        alert("UPLOAD FAILED:\n\n" + error.message);
        switchView('upload-view');
    }
});

// Populate Dashboard
function updateDashboardUI(analysis, graphData) {
    document.getElementById('accounts-kpi').textContent = analysis.summary.total_accounts_analyzed;
    document.getElementById('suspicious-kpi').textContent = analysis.summary.suspicious_accounts_flagged;
    document.getElementById('rings-kpi').textContent = analysis.summary.fraud_rings_detected;
    document.getElementById('time-kpi').textContent = analysis.summary.processing_time_seconds + 's';
    document.getElementById('graph-stats').textContent = `${graphData.nodes.length} nodes · ${graphData.edges.length} edges`;
    renderGraph(graphData);
}

// Graph Rendering
function renderGraph(graphData) {
    const container = document.getElementById("network");
    container.style.height = "550px"; 
    container.style.width = "100%";
    
    const visData = { nodes: new vis.DataSet(graphData.nodes), edges: new vis.DataSet(graphData.edges) };

    const options = {
        nodes: { shape: 'dot', borderWidth: 2, borderWidthSelected: 4, font: { face: 'Inter', size: 12, strokeWidth: 3, strokeColor: '#0b1120' } },
        edges: { arrows: { to: { enabled: true, scaleFactor: 0.5 } }, smooth: { type: 'continuous' } },
        layout: { improvedLayout: false },
        physics: { barnesHut: { gravitationalConstant: -3000, centralGravity: 0.3, springLength: 95 }, stabilization: { iterations: 150 } },
        interaction: { hover: true, tooltipDelay: 200 }
    };

    if (networkGraph !== null) networkGraph.destroy();
    networkGraph = new vis.Network(container, visData, options);
    
    setTimeout(() => { networkGraph.redraw(); networkGraph.fit(); }, 200);

    networkGraph.on("click", function (params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const accData = currentAnalysis.suspicious_accounts.find(a => String(a.account_id) === String(nodeId));
            
            document.getElementById('default-side').classList.add('hidden');
            const detailsPanel = document.getElementById('node-details');
            detailsPanel.classList.remove('hidden');

            if(accData) {
                document.getElementById('node-title').textContent = accData.account_id;
                document.getElementById('node-score').textContent = accData.suspicion_score;
                const color = accData.suspicion_score >= 85 ? 'var(--accent-red)' : 'var(--accent-orange)';
                document.getElementById('node-title').style.color = color;
                document.querySelector('.score-circle').style.color = color;
                const stageBadge = document.getElementById('node-stage');
                stageBadge.textContent = accData.lifecycle_stage;
                stageBadge.style.color = color;
                stageBadge.style.borderColor = color;
                stageBadge.style.backgroundColor = accData.suspicion_score >= 85 ? 'var(--accent-red-bg)' : 'rgba(245, 158, 11, 0.1)';
                document.getElementById('node-ring').textContent = accData.ring_id || 'None';
                
                const tagsContainer = document.getElementById('node-patterns');
                tagsContainer.innerHTML = '';
                accData.detected_patterns.forEach(p => {
                    const span = document.createElement('span');
                    span.className = 'tag'; span.textContent = p; tagsContainer.appendChild(span);
                });
                document.getElementById('node-narrative').textContent = accData.ai_narrative;
            } else {
                document.getElementById('node-title').textContent = nodeId;
                document.getElementById('node-score').textContent = "0";
                document.getElementById('node-stage').textContent = "Legitimate Account";
                document.getElementById('node-stage').style.color = "var(--text-muted)";
                document.getElementById('node-stage').style.borderColor = "var(--text-muted)";
                document.getElementById('node-stage').style.backgroundColor = "transparent";
                document.getElementById('node-ring').textContent = "N/A";
                document.getElementById('node-patterns').innerHTML = "<span class='tag'>None</span>";
                document.getElementById('node-narrative').textContent = "Standard transaction behavior. No anomalous flow or cycles detected.";
            }
        }
    });
}

document.getElementById('downloadBtn').addEventListener('click', () => { window.location.href = "/download"; });

// History Management
async function loadHistory() {
    switchView('history-view');
    const container = document.getElementById('history-list');
    container.innerHTML = '<p class="text-center text-gray mt-2">Loading past analyses...</p>';

    try {
        const res = await fetch('/history');
        const data = await res.json();
        container.innerHTML = '';
        
        if(data.length === 0) {
            container.innerHTML = '<p class="text-center text-gray mt-2">No past analyses found in database.</p>';
            return;
        }

        data.forEach(item => {
            const date = new Date(item.created_at * 1000).toLocaleString();
            const div = document.createElement('div');
            div.className = 'upload-card w-full flex-between mb-1'; 
            div.style.padding = '1.5rem'; div.style.cursor = 'pointer';
            div.innerHTML = `
                <div>
                    <h4 class="text-blue" style="margin-bottom: 5px;">Analysis run on: ${date}</h4>
                    <p class="text-sm text-gray">👥 ${item.analysis.summary.total_accounts_analyzed} accounts | 🚨 ${item.analysis.summary.suspicious_accounts_flagged} flagged | 📈 ${item.analysis.summary.fraud_rings_detected} rings</p>
                </div>
                <button class="btn-secondary">Load Graph &rarr;</button>
            `;
            div.onclick = () => loadHistoryItem(item._id);
            container.appendChild(div);
        });
    } catch (error) {
        container.innerHTML = '<p class="text-red text-center mt-2">Failed to load history from database.</p>';
    }
}

async function loadHistoryItem(id) {
    switchView('processing-view'); 
    try {
        const res = await fetch(`/history/${id}`);
        const full = await res.json();
        currentAnalysis = full.analysis;
        setTimeout(() => { switchView('dashboard-view'); setTimeout(() => { updateDashboardUI(currentAnalysis, full.graph); }, 250); }, 500);
    } catch (error) {
        alert('Failed to load this record.'); switchView('history-view');
    }
}let currentAnalysis = null;
let networkGraph = null;

// View Management
function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    if (window.event && window.event.target && window.event.target.tagName === 'A') {
        window.event.target.classList.add('active');
    }
}

// File Upload Handling
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const analyzeBtn = document.getElementById('analyzeBtn');
const uploadForm = document.getElementById('uploadForm');

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; updateFileInfo(); }
});
fileInput.addEventListener('change', updateFileInfo);

function updateFileInfo() {
    if (fileInput.files.length > 0) {
        fileInfo.textContent = `Selected: ${fileInput.files[0].name}`;
        fileInfo.classList.remove('hidden');
        analyzeBtn.classList.remove('hidden');
    }
}

// Form Submission
uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(uploadForm);
    
    switchView('processing-view');
    document.querySelector('.status-badge').textContent = 'Analyzing Active';
    document.querySelector('.status-badge').style.color = 'var(--accent-green)';

    let startTime = Date.now();
    let timerInt = setInterval(() => { document.getElementById('timer').textContent = ((Date.now() - startTime) / 1000).toFixed(1) + 's'; }, 100);

    setTimeout(() => { document.getElementById('step1').classList.remove('active'); document.getElementById('step2').classList.add('active'); }, 800);
    setTimeout(() => { document.getElementById('step2').classList.remove('active'); document.getElementById('step3').classList.add('active'); }, 1800);
    setTimeout(() => { document.getElementById('step3').classList.remove('active'); document.getElementById('step4').classList.add('active'); }, 2600);

    try {
        const res = await fetch("/upload", { method: "POST", body: formData });
        const data = await res.json();
        
        clearInterval(timerInt);
        
        // CRITICAL FIX: EXPLICITLY CHECK FOR ERRORS
        if (!res.ok || data.error) {
            throw new Error(data.error || `Server returned status ${res.status}`);
        }

        currentAnalysis = data.analysis;
        
        setTimeout(() => {
            switchView('dashboard-view');
            setTimeout(() => { updateDashboardUI(currentAnalysis, data.graph); }, 250);
        }, 500);

    } catch (error) {
        clearInterval(timerInt);
        // Display the EXACT error to the user
        alert("UPLOAD FAILED:\n\n" + error.message);
        switchView('upload-view');
    }
});

// Populate Dashboard
function updateDashboardUI(analysis, graphData) {
    document.getElementById('accounts-kpi').textContent = analysis.summary.total_accounts_analyzed;
    document.getElementById('suspicious-kpi').textContent = analysis.summary.suspicious_accounts_flagged;
    document.getElementById('rings-kpi').textContent = analysis.summary.fraud_rings_detected;
    document.getElementById('time-kpi').textContent = analysis.summary.processing_time_seconds + 's';
    document.getElementById('graph-stats').textContent = `${graphData.nodes.length} nodes · ${graphData.edges.length} edges`;
    renderGraph(graphData);
}

// Graph Rendering
function renderGraph(graphData) {
    const container = document.getElementById("network");
    container.style.height = "550px"; 
    container.style.width = "100%";
    
    const visData = { nodes: new vis.DataSet(graphData.nodes), edges: new vis.DataSet(graphData.edges) };

    const options = {
        nodes: { shape: 'dot', borderWidth: 2, borderWidthSelected: 4, font: { face: 'Inter', size: 12, strokeWidth: 3, strokeColor: '#0b1120' } },
        edges: { arrows: { to: { enabled: true, scaleFactor: 0.5 } }, smooth: { type: 'continuous' } },
        layout: { improvedLayout: false },
        physics: { barnesHut: { gravitationalConstant: -3000, centralGravity: 0.3, springLength: 95 }, stabilization: { iterations: 150 } },
        interaction: { hover: true, tooltipDelay: 200 }
    };

    if (networkGraph !== null) networkGraph.destroy();
    networkGraph = new vis.Network(container, visData, options);
    
    setTimeout(() => { networkGraph.redraw(); networkGraph.fit(); }, 200);

    networkGraph.on("click", function (params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const accData = currentAnalysis.suspicious_accounts.find(a => String(a.account_id) === String(nodeId));
            
            document.getElementById('default-side').classList.add('hidden');
            const detailsPanel = document.getElementById('node-details');
            detailsPanel.classList.remove('hidden');

            if(accData) {
                document.getElementById('node-title').textContent = accData.account_id;
                document.getElementById('node-score').textContent = accData.suspicion_score;
                const color = accData.suspicion_score >= 85 ? 'var(--accent-red)' : 'var(--accent-orange)';
                document.getElementById('node-title').style.color = color;
                document.querySelector('.score-circle').style.color = color;
                const stageBadge = document.getElementById('node-stage');
                stageBadge.textContent = accData.lifecycle_stage;
                stageBadge.style.color = color;
                stageBadge.style.borderColor = color;
                stageBadge.style.backgroundColor = accData.suspicion_score >= 85 ? 'var(--accent-red-bg)' : 'rgba(245, 158, 11, 0.1)';
                document.getElementById('node-ring').textContent = accData.ring_id || 'None';
                
                const tagsContainer = document.getElementById('node-patterns');
                tagsContainer.innerHTML = '';
                accData.detected_patterns.forEach(p => {
                    const span = document.createElement('span');
                    span.className = 'tag'; span.textContent = p; tagsContainer.appendChild(span);
                });
                document.getElementById('node-narrative').textContent = accData.ai_narrative;
            } else {
                document.getElementById('node-title').textContent = nodeId;
                document.getElementById('node-score').textContent = "0";
                document.getElementById('node-stage').textContent = "Legitimate Account";
                document.getElementById('node-stage').style.color = "var(--text-muted)";
                document.getElementById('node-stage').style.borderColor = "var(--text-muted)";
                document.getElementById('node-stage').style.backgroundColor = "transparent";
                document.getElementById('node-ring').textContent = "N/A";
                document.getElementById('node-patterns').innerHTML = "<span class='tag'>None</span>";
                document.getElementById('node-narrative').textContent = "Standard transaction behavior. No anomalous flow or cycles detected.";
            }
        }
    });
}

document.getElementById('downloadBtn').addEventListener('click', () => { window.location.href = "/download"; });

// History Management
async function loadHistory() {
    switchView('history-view');
    const container = document.getElementById('history-list');
    container.innerHTML = '<p class="text-center text-gray mt-2">Loading past analyses...</p>';

    try {
        const res = await fetch('/history');
        const data = await res.json();
        container.innerHTML = '';
        
        if(data.length === 0) {
            container.innerHTML = '<p class="text-center text-gray mt-2">No past analyses found in database.</p>';
            return;
        }

        data.forEach(item => {
            const date = new Date(item.created_at * 1000).toLocaleString();
            const div = document.createElement('div');
            div.className = 'upload-card w-full flex-between mb-1'; 
            div.style.padding = '1.5rem'; div.style.cursor = 'pointer';
            div.innerHTML = `
                <div>
                    <h4 class="text-blue" style="margin-bottom: 5px;">Analysis run on: ${date}</h4>
                    <p class="text-sm text-gray">👥 ${item.analysis.summary.total_accounts_analyzed} accounts | 🚨 ${item.analysis.summary.suspicious_accounts_flagged} flagged | 📈 ${item.analysis.summary.fraud_rings_detected} rings</p>
                </div>
                <button class="btn-secondary">Load Graph &rarr;</button>
            `;
            div.onclick = () => loadHistoryItem(item._id);
            container.appendChild(div);
        });
    } catch (error) {
        container.innerHTML = '<p class="text-red text-center mt-2">Failed to load history from database.</p>';
    }
}

async function loadHistoryItem(id) {
    switchView('processing-view'); 
    try {
        const res = await fetch(`/history/${id}`);
        const full = await res.json();
        currentAnalysis = full.analysis;
        setTimeout(() => { switchView('dashboard-view'); setTimeout(() => { updateDashboardUI(currentAnalysis, full.graph); }, 250); }, 500);
    } catch (error) {
        alert('Failed to load this record.'); switchView('history-view');
    }
}