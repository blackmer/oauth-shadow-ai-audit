/**
 * ui.js — Top-level orchestration for file import and dashboard rendering.
 *
 * Wires up the import panel, dispatches files to parsers, runs the full
 * pipeline (join → classify → IOC match → filter → tile computation),
 * and renders the dashboard view.
 *
 * Security: All processing is client-side. No data leaves the browser.
 * No persistence — state lives in memory only, gone on reload.
 */

import { parseFile, mergeM3Results, detectFileType } from './ingest.js';
import { joinGoogle, joinMicrosoft } from './join.js';
import { buildTaxonomyIndex, classifyAllApps } from './taxonomy.js';
import { parseIOCList, buildIOCIndex, matchIOCs, fetchIOCList } from './ioc.js';
import { filterApps } from './filter.js';
import { computeAllTiles } from './tiles.js';
import { COLUMNS, sortApps, renderDrilldown, encodeStateToURL, decodeStateFromURL } from './drilldown.js';
import { exportDrilldown, downloadFile } from './export.js';
import { logImport, logIOCMatch, logUnknownScope, logConfigLoad, exportLog, getLogEntries } from './log.js';

// ============================================================================
// Session state — lives in memory only, gone on reload
// ============================================================================

const state = {
    raw: {
        G1: null,
        G2: null,
        M1: null,
        M2: null,
        M3: [],
        M4: null,
    },
    m3Merged: null,
    iocList: null,
    taxonomy: { google: null, microsoft: null },
    // Computed state
    allApps: [],
    filteredApps: [],
    tiles: null,
    orphanSignIns: [],
    classificationResult: null,
    // UI state
    filters: {
        showFirstParty: false,
        platform: null,
        search: null,
    },
    drilldown: {
        tile: null,
        sort: 'highest_tier',
        dir: 'asc',
        apps: [],
    },
};

window.__auditState = state;

// ============================================================================
// Taxonomy loading
// ============================================================================

async function loadTaxonomies() {
    try {
        const [gRes, mRes] = await Promise.all([
            fetch('taxonomy/taxonomy-google.json'),
            fetch('taxonomy/taxonomy-microsoft.json'),
        ]);
        if (gRes.ok) {
            const gJson = await gRes.json();
            state.taxonomy.google = buildTaxonomyIndex(gJson);
            logConfigLoad('taxonomy', 'taxonomy-google.json');
        }
        if (mRes.ok) {
            const mJson = await mRes.json();
            state.taxonomy.microsoft = buildTaxonomyIndex(mJson);
            logConfigLoad('taxonomy', 'taxonomy-microsoft.json');
        }
        console.log('[Taxonomy] Loaded —',
            `Google: ${state.taxonomy.google?.index.size || 0} entries,`,
            `Microsoft: ${state.taxonomy.microsoft?.index.size || 0} entries`);
    } catch (e) {
        console.error('[Taxonomy] Load failed:', e);
    }
}

// ============================================================================
// Pipeline: join → classify → IOC → filter → tiles
// ============================================================================

function runPipeline() {
    // Join
    const g1Data = state.raw.G1?.data || null;
    const g2Data = state.raw.G2?.data || null;
    const m1Data = state.raw.M1?.data || null;
    const m2Data = state.raw.M2?.data || null;
    const m3Data = state.m3Merged?.data || null;
    const m4Data = state.raw.M4?.data || null;

    const hasGoogle = g1Data && g1Data.length > 0;
    const hasMicrosoft = m1Data || m3Data;

    if (!hasGoogle && !hasMicrosoft) {
        state.allApps = [];
        state.filteredApps = [];
        state.tiles = null;
        renderDashboard();
        return;
    }

    let googleApps = [];
    let msApps = [];
    state.orphanSignIns = [];

    if (hasGoogle) {
        const gResult = joinGoogle(g1Data, g2Data);
        googleApps = gResult.apps;
        if (gResult.warnings.length > 0) {
            console.warn('[Google Join]', gResult.warnings);
        }
    }

    if (hasMicrosoft) {
        const msResult = joinMicrosoft(m1Data, m2Data, m3Data, m4Data);
        msApps = msResult.apps;
        state.orphanSignIns = msResult.orphanSignIns;
        if (msResult.warnings.length > 0) {
            console.warn('[Microsoft Join]', msResult.warnings);
        }
    }

    state.allApps = [...googleApps, ...msApps];

    // Classify
    if (state.taxonomy.google || state.taxonomy.microsoft) {
        state.classificationResult = classifyAllApps(
            state.allApps, state.taxonomy.google, state.taxonomy.microsoft
        );
        // Log unclassified scopes
        for (const u of state.classificationResult.unclassified_scopes) {
            logUnknownScope(u.scope, u.app_name, u.platform);
        }
    }

    // IOC matching
    if (state.iocList && state.iocList.length > 0) {
        const iocIndex = buildIOCIndex(state.iocList);
        const iocResult = matchIOCs(state.allApps, iocIndex);
        for (const match of iocResult.matched_apps) {
            for (const ioc of match.iocs) {
                logIOCMatch(match.app.name, match.app.id, ioc.severity, ioc.source);
            }
        }
    }

    // Filter
    state.filteredApps = filterApps(state.allApps, state.filters);

    // Tiles
    state.tiles = computeAllTiles(state.filteredApps);

    renderDashboard();
}

// ============================================================================
// Dashboard rendering
// ============================================================================

function renderDashboard() {
    const dashboard = document.getElementById('dashboard');
    const importPanel = document.getElementById('import-panel');

    if (state.allApps.length === 0) {
        dashboard.classList.add('hidden');
        importPanel.classList.remove('hidden');
        return;
    }

    importPanel.classList.add('hidden');
    dashboard.classList.remove('hidden');
    dashboard.innerHTML = '';

    // IOC banner
    if (state.tiles && state.tiles.ioc.count > 0) {
        const banner = document.createElement('div');
        banner.className = 'ioc-banner';
        banner.innerHTML = `<strong>IOC Alert:</strong> ${state.tiles.ioc.count} app(s) matched known indicators of compromise.
            <button class="banner-action" data-tile="ioc">View matches</button>
            <button class="banner-dismiss" aria-label="Dismiss">×</button>`;
        banner.querySelector('.banner-action').addEventListener('click', () => openDrilldown('ioc'));
        banner.querySelector('.banner-dismiss').addEventListener('click', () => banner.remove());
        dashboard.appendChild(banner);
    }

    // Controls bar
    const controls = document.createElement('div');
    controls.className = 'controls-bar';
    controls.innerHTML = `
        <label class="filter-toggle">
            <input type="checkbox" id="show-first-party" ${state.filters.showFirstParty ? 'checked' : ''}>
            Show first-party services
        </label>
        <input type="text" id="search-input" placeholder="Search apps, scopes..." value="${state.filters.search || ''}">
        <button id="btn-export-log" title="Download CEF security log">Download Log</button>
        <button id="btn-show-import" title="Show import panel">Import</button>
    `;
    dashboard.appendChild(controls);

    // Wire controls
    controls.querySelector('#show-first-party').addEventListener('change', (e) => {
        state.filters.showFirstParty = e.target.checked;
        runPipeline();
    });
    controls.querySelector('#search-input').addEventListener('input', debounce((e) => {
        state.filters.search = e.target.value || null;
        runPipeline();
    }, 200));
    controls.querySelector('#btn-export-log').addEventListener('click', () => {
        const log = exportLog();
        downloadFile(log, `oauth-audit-log-${new Date().toISOString().slice(0, 10)}.cef`, 'text/plain');
    });
    controls.querySelector('#btn-show-import').addEventListener('click', () => {
        document.getElementById('import-panel').classList.remove('hidden');
        dashboard.classList.add('hidden');
    });

    // Tiles grid
    if (state.tiles) {
        const grid = document.createElement('div');
        grid.className = 'tiles-grid';
        grid.appendChild(createTile('critical', 'Tier 1 (Critical) Access', state.tiles.critical.count, 'critical'));
        grid.appendChild(createTile('stale', 'Granted >90 Days', state.tiles.stale.count, 'warning'));
        grid.appendChild(createUnusedTile());
        grid.appendChild(createGrantorTile());
        grid.appendChild(createTile('chained', 'Chained Grants', state.tiles.chained.count, 'warning'));
        grid.appendChild(createIOCTile());
        dashboard.appendChild(grid);
    }

    // Drilldown container
    const drilldownEl = document.createElement('div');
    drilldownEl.id = 'drilldown-container';
    dashboard.appendChild(drilldownEl);

    // Restore drilldown from URL state
    const urlState = decodeStateFromURL();
    if (urlState.tile) {
        state.drilldown.tile = urlState.tile;
        state.drilldown.sort = urlState.sort || 'highest_tier';
        state.drilldown.dir = urlState.dir || 'asc';
        openDrilldown(urlState.tile);
    }
}

function createTile(tileKey, label, count, severity) {
    const tile = document.createElement('div');
    tile.className = `tile tile-${severity}`;
    tile.innerHTML = `<div class="tile-count">${count}</div><div class="tile-label">${label}</div>`;
    tile.addEventListener('click', () => openDrilldown(tileKey));
    return tile;
}

function createUnusedTile() {
    const t = state.tiles.unused;
    const tile = document.createElement('div');

    if (Object.keys(t.platform_unavailable).length > 0 && t.count === 0) {
        tile.className = 'tile tile-disabled';
        const msgs = Object.values(t.platform_unavailable);
        tile.innerHTML = `<div class="tile-count">—</div><div class="tile-label">Unused Tokens</div>
            <div class="tile-note">${msgs[0]}</div>`;
    } else {
        tile.className = 'tile tile-warning';
        tile.innerHTML = `<div class="tile-count">${t.count}</div><div class="tile-label">Unused >30 Days</div>`;
        tile.addEventListener('click', () => openDrilldown('unused'));
    }
    return tile;
}

function createGrantorTile() {
    const t = state.tiles.grantors;
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = `<div class="tile-count">${t.total_grantors}</div><div class="tile-label">Distinct Grantors</div>`;
    tile.addEventListener('click', () => openDrilldown('grantors'));
    return tile;
}

function createIOCTile() {
    const t = state.tiles.ioc;
    const tile = document.createElement('div');
    if (t.no_ioc_list) {
        tile.className = 'tile tile-disabled';
        tile.innerHTML = `<div class="tile-count">—</div><div class="tile-label">IOC Matches</div>
            <div class="tile-note">No IOC list loaded</div>`;
    } else {
        tile.className = t.count > 0 ? 'tile tile-critical' : 'tile tile-ok';
        tile.innerHTML = `<div class="tile-count">${t.count}</div><div class="tile-label">IOC Matches</div>`;
        if (t.count > 0) tile.addEventListener('click', () => openDrilldown('ioc'));
    }
    return tile;
}

// ============================================================================
// Tile and drill-down descriptions
// ============================================================================

const TILE_INFO = {
    critical: {
        title: 'Apps with Tier 1 (Critical) Access',
        description: 'Apps that hold at least one OAuth scope classified as Tier 1 (Critical) in the scope risk taxonomy. Tier 1 scopes grant tenant-wide write access to identity, mail, or files — or in Google, domain-wide delegation. These represent the highest-risk OAuth grants and should be reviewed for business justification.',
    },
    stale: {
        title: 'Apps Granted >90 Days Ago',
        description: 'Apps whose OAuth access was granted more than 90 days ago. Long-lived grants accumulate risk — the app may no longer be in use, the vendor relationship may have changed, or the original business justification may no longer apply. Review for revocation or re-authorization.',
    },
    unused: {
        title: 'Apps Unused >30 Days',
        description: 'Apps with valid OAuth tokens that have not been used in over 30 days. Unused tokens are dormant attack surface — if the app or its credentials are compromised, the token still grants access. Consider revoking tokens for apps with no recent activity.',
    },
    grantors: {
        title: 'All Apps by Grantor',
        description: 'Breakdown of which users or admin processes granted OAuth access. In single-admin tenants, any grantor other than the expected administrator is an anomaly worth investigating. "Admin consent" indicates a tenant-wide grant applied by an administrator. "Unknown" means the grant predates the audit log retention window.',
    },
    chained: {
        title: 'Chained Grants (App-to-App)',
        description: 'Apps where the granting principal is itself a service principal or OAuth application, rather than a human user. This is consent chaining — one app granting access to another — which can indicate legitimate automation or an unauthorized lateral movement pattern. Each chained grant should be traced to its originating human authorization.',
    },
    ioc: {
        title: 'IOC Matches',
        description: 'Apps whose Client ID matches an entry in your loaded Indicator of Compromise (IOC) list. A match means this exact OAuth application has been flagged — by a breach disclosure, threat intelligence feed, or your own internal finding. Matched apps require immediate investigation and likely revocation.',
    },
};

// ============================================================================
// Drilldown interaction
// ============================================================================

function openDrilldown(tileKey) {
    const container = document.getElementById('drilldown-container');
    if (!container || !state.tiles) return;

    const isNewTile = state.drilldown.tile !== tileKey;
    state.drilldown.tile = tileKey;
    const info = TILE_INFO[tileKey] || { title: 'All Apps', description: '' };
    let apps = [];

    switch (tileKey) {
        case 'critical':
            apps = state.tiles.critical.apps;
            break;
        case 'stale':
            apps = state.tiles.stale.apps;
            break;
        case 'unused':
            apps = state.tiles.unused.apps;
            break;
        case 'grantors':
            apps = state.filteredApps;
            if (isNewTile) state.drilldown.sort = 'grantor';
            break;
        case 'chained':
            apps = state.tiles.chained.apps;
            break;
        case 'ioc':
            apps = state.tiles.ioc.apps;
            break;
        default:
            apps = state.filteredApps;
    }

    // Sort
    apps = sortApps(apps, state.drilldown.sort, state.drilldown.dir);
    state.drilldown.apps = apps;

    // Render
    renderDrilldown(container, apps, {
        title: info.title,
        description: info.description,
        sortColumn: state.drilldown.sort,
        sortDirection: state.drilldown.dir,
        onSort: (colKey) => {
            if (state.drilldown.sort === colKey) {
                state.drilldown.dir = state.drilldown.dir === 'asc' ? 'desc' : 'asc';
            } else {
                state.drilldown.sort = colKey;
                state.drilldown.dir = 'asc';
            }
            openDrilldown(tileKey);
        },
    });

    // Export button
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-export';
    exportBtn.textContent = 'Export to CSV';
    exportBtn.addEventListener('click', () => {
        const version = state.taxonomy.google?.version || state.taxonomy.microsoft?.version || '';
        exportDrilldown(apps, tileKey, version);
    });
    container.appendChild(exportBtn);

    // Update URL
    encodeStateToURL({
        tile: tileKey,
        sort: state.drilldown.sort,
        dir: state.drilldown.dir,
        search: state.filters.search,
    });
}

// ============================================================================
// File import handling
// ============================================================================

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
        reader.readAsText(file);
    });
}

function updateSlotStatus(slotEl, result) {
    const statusEl = slotEl.querySelector('.slot-status');
    if (result.error) {
        statusEl.textContent = `Error: ${result.error}`;
        statusEl.className = 'slot-status status-error';
    } else {
        const count = result.data.length;
        const warnCount = result.warnings.length;
        let msg = `Loaded ${count} record${count !== 1 ? 's' : ''}`;
        if (warnCount > 0) msg += ` (${warnCount} warning${warnCount !== 1 ? 's' : ''})`;
        statusEl.textContent = msg;
        statusEl.className = 'slot-status status-ok';
    }
    if (result.warnings.length > 0) {
        console.warn(`[${result.slot || 'unknown'}] Warnings:`, result.warnings);
    }
}

function updateImportSummary() {
    const summaryEl = document.getElementById('import-summary');
    const resultsEl = document.getElementById('import-results');
    const slots = ['G1', 'G2', 'M1', 'M2', 'M3', 'M4'];
    const loaded = [];

    for (const slot of slots) {
        if (slot === 'M3') {
            if (state.raw.M3.length > 0) loaded.push(`M3 (${state.m3Merged?.data.length || 0} SPs)`);
        } else if (state.raw[slot]) {
            loaded.push(`${slot} (${state.raw[slot].data.length})`);
        }
    }

    if (loaded.length === 0) {
        summaryEl.classList.add('hidden');
        return;
    }

    summaryEl.classList.remove('hidden');
    resultsEl.innerHTML = `Files loaded: ${loaded.join(', ')}
        <button id="btn-run-analysis" class="btn-primary">Run Analysis</button>`;
    document.getElementById('btn-run-analysis').addEventListener('click', () => {
        // Log imports
        if (state.raw.G1) logImport('google', 'G1', state.raw.G1.data.length, state.taxonomy.google?.version || '');
        if (state.raw.G2) logImport('google', 'G2', state.raw.G2.data.length, '');
        if (state.raw.M1) logImport('microsoft', 'M1', state.raw.M1.data.length, '');
        if (state.raw.M2) logImport('microsoft', 'M2', state.raw.M2.data.length, '');
        if (state.m3Merged) logImport('microsoft', 'M3', state.m3Merged.data.length, state.taxonomy.microsoft?.version || '');
        if (state.raw.M4) logImport('microsoft', 'M4', state.raw.M4.data.length, '');
        runPipeline();
    });
}

async function handleFileInput(event) {
    const input = event.target;
    const slot = input.dataset.slot;
    const slotEl = input.closest('.import-slot');
    const files = input.files;

    if (!files || files.length === 0) return;

    for (const file of files) {
        try {
            const text = await readFileAsText(file);

            const detected = detectFileType(text, file.name);
            if (detected && detected !== slot) {
                console.warn(`File "${file.name}" looks like ${detected} but was placed in ${slot} slot`);
            }

            const result = parseFile(text, slot);

            if (slot === 'M3') {
                state.raw.M3.push(result);
                state.m3Merged = mergeM3Results(state.raw.M3);
                updateSlotStatus(slotEl, state.m3Merged);
            } else {
                state.raw[slot] = result;
                updateSlotStatus(slotEl, result);
            }
        } catch (err) {
            const statusEl = slotEl.querySelector('.slot-status');
            statusEl.textContent = `Error: ${err.message}`;
            statusEl.className = 'slot-status status-error';
            console.error(`[${slot}] File read error:`, err);
        }
    }

    updateImportSummary();
}

// ============================================================================
// IOC file handling
// ============================================================================

async function handleIOCFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const text = await readFileAsText(file);
    const result = parseIOCList(text);
    const statusEl = document.getElementById('ioc-status');

    if (result.error) {
        statusEl.textContent = `Error: ${result.error}`;
        statusEl.className = 'slot-status status-error';
    } else {
        state.iocList = result.iocs;
        statusEl.textContent = `Loaded ${result.iocs.length} IOC(s)`;
        statusEl.className = 'slot-status status-ok';
        logConfigLoad('ioc', file.name);
    }
}

// ============================================================================
// Utilities
// ============================================================================

function debounce(fn, ms) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    // Load taxonomies
    await loadTaxonomies();

    // Wire file inputs
    const inputs = document.querySelectorAll('.import-slot input[type="file"]');
    for (const input of inputs) {
        input.addEventListener('change', handleFileInput);
    }

    // Wire IOC input
    const iocInput = document.getElementById('ioc-file-input');
    if (iocInput) iocInput.addEventListener('change', handleIOCFile);

    console.log('[OAuth Audit Dashboard] Initialized. State available at window.__auditState');
}

document.addEventListener('DOMContentLoaded', init);
