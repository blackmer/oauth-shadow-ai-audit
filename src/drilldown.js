/**
 * drilldown.js — Drill-down table rendering with sort, filter, and column display.
 *
 * Each tile click opens a filterable, sortable table of the apps that triggered
 * that tile. Supports URL query param state for bookmarkable findings.
 */

// ============================================================================
// Column definitions
// ============================================================================

/**
 * Column definitions for the drill-down table.
 * Each column has: key, label, sortable flag, render function.
 */
export const COLUMNS = [
    {
        key: 'name',
        label: 'App Name',
        tooltip: 'The display name of the OAuth application or service principal.',
        sortable: true,
        render: app => app.name || '(unnamed)',
    },
    {
        key: 'platform',
        label: 'Platform',
        tooltip: 'Whether this app is registered in Google Workspace or Microsoft Entra ID.',
        sortable: true,
        render: app => app.platform === 'google' ? 'Google' : 'Microsoft',
    },
    {
        key: 'publisher',
        label: 'Publisher',
        tooltip: 'The verified publisher of the application, if available.',
        sortable: true,
        render: app => app.publisher || '\u2014',
    },
    {
        key: 'days_since_granted',
        label: 'Days Since Granted',
        tooltip: 'How many days ago OAuth access was granted. Older grants accumulate risk and may no longer be needed. Derived from the consent event log.',
        sortable: true,
        render: app => {
            if (!app.granted_at) return app.has_g2_data === false ? 'Predates log' : '\u2014';
            const days = Math.floor((Date.now() - new Date(app.granted_at).getTime()) / 86400000);
            return isNaN(days) ? '\u2014' : String(days);
        },
        sortValue: app => {
            if (!app.granted_at) return Infinity;
            return Date.now() - new Date(app.granted_at).getTime();
        },
    },
    {
        key: 'days_since_used',
        label: 'Days Since Last Used',
        tooltip: 'How many days since the app last used its OAuth token. Dormant tokens are attack surface. N/A means usage data is not available for this platform.',
        sortable: true,
        render: app => {
            if (!app.last_used_at) return app.platform === 'google' ? 'N/A' : '\u2014';
            const days = Math.floor((Date.now() - new Date(app.last_used_at).getTime()) / 86400000);
            return isNaN(days) ? '\u2014' : String(days);
        },
        sortValue: app => {
            if (!app.last_used_at) return Infinity;
            return Date.now() - new Date(app.last_used_at).getTime();
        },
    },
    {
        key: 'highest_tier',
        label: 'Access Level',
        tooltip: 'The highest risk tier among all scopes granted to this app. Tier 1 = Critical (tenant-wide write), Tier 2 = High (tenant read or user write), Tier 3 = Moderate, Tier 4 = Low.',
        sortable: true,
        render: app => {
            if (app.highest_tier === null) return 'No scopes';
            if (app.highest_tier === 'unclassified') return 'Unclassified';
            return `Tier ${app.highest_tier}`;
        },
        sortValue: app => {
            if (app.highest_tier === null) return 99;
            if (app.highest_tier === 'unclassified') return 98;
            return app.highest_tier;
        },
    },
    {
        key: 'grantor',
        label: 'Grantor',
        tooltip: 'The user or process that authorized this app. "Admin consent" = tenant-wide grant by an administrator. "Unknown" = predates the audit log retention window.',
        sortable: true,
        render: app => app.grantor || 'Unknown',
    },
    {
        key: 'verification',
        label: 'Verified',
        tooltip: 'Whether the app publisher has been verified by Google or Microsoft. Unverified apps have not passed platform review.',
        sortable: true,
        render: app => {
            if (app.publisher_verified === true) return 'Yes';
            if (app.publisher_verified === false) return 'No';
            return '\u2014';
        },
    },
    {
        key: 'scopes',
        label: 'Scopes',
        tooltip: 'The OAuth permission scopes granted to this app. Each scope defines a specific type of access (e.g., read mail, write files).',
        sortable: false,
        render: app => (app.scopes || []).join(', ') || 'None',
    },
    {
        key: 'admin_policy',
        label: 'Admin Policy',
        tooltip: 'The Google Workspace admin policy applied to this app: Trust (allowed), Limited (restricted), Block (denied), or Not configured (no policy set).',
        sortable: true,
        render: app => app.admin_policy || '\u2014',
    },
];

// ============================================================================
// Sorting
// ============================================================================

/**
 * Sorts an app list by the given column key and direction.
 *
 * @param {Array} apps - Apps to sort
 * @param {string} columnKey - Key from COLUMNS definition
 * @param {string} direction - "asc" or "desc"
 * @returns {Array} New sorted array (does not mutate input)
 */
export function sortApps(apps, columnKey, direction = 'asc') {
    const col = COLUMNS.find(c => c.key === columnKey);
    if (!col || !col.sortable) return [...apps];

    const getValue = col.sortValue || col.render;
    const sorted = [...apps].sort((a, b) => {
        const va = getValue(a);
        const vb = getValue(b);

        // Handle numeric vs string comparison
        if (typeof va === 'number' && typeof vb === 'number') {
            return direction === 'asc' ? va - vb : vb - va;
        }

        const sa = String(va).toLowerCase();
        const sb = String(vb).toLowerCase();
        const cmp = sa.localeCompare(sb);
        return direction === 'asc' ? cmp : -cmp;
    });

    return sorted;
}

// ============================================================================
// Table rendering (DOM construction)
// ============================================================================

/**
 * Renders a drill-down table into a container element.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {Array} apps - Apps to display
 * @param {object} options
 * @param {string} options.title - Table title
 * @param {string} options.description - Contextual description of what this drill-down shows
 * @param {string} options.sortColumn - Currently sorted column key
 * @param {string} options.sortDirection - "asc" or "desc"
 * @param {function} options.onSort - Callback when sort header clicked: (columnKey) => void
 * @param {Array} options.visibleColumns - Which column keys to show (default: all)
 */
export function renderDrilldown(container, apps, options = {}) {
    const {
        title = 'Drill-Down',
        description = '',
        sortColumn = null,
        sortDirection = 'asc',
        onSort = null,
        visibleColumns = null,
    } = options;

    // Determine which columns to show
    const columns = visibleColumns
        ? COLUMNS.filter(c => visibleColumns.includes(c.key))
        : COLUMNS;

    container.innerHTML = '';

    // Title
    const header = document.createElement('h3');
    header.textContent = `${title} (${apps.length} app${apps.length !== 1 ? 's' : ''})`;
    container.appendChild(header);

    // Description
    if (description) {
        const desc = document.createElement('p');
        desc.className = 'drilldown-description';
        desc.textContent = description;
        container.appendChild(desc);
    }

    if (apps.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No apps match the current filters.';
        empty.className = 'drilldown-empty';
        container.appendChild(empty);
        return;
    }

    // Table
    const table = document.createElement('table');
    table.className = 'drilldown-table';

    // Header row
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of columns) {
        const th = document.createElement('th');
        th.textContent = col.label;
        if (col.tooltip) th.title = col.tooltip;
        th.dataset.column = col.key;

        if (col.sortable && onSort) {
            th.className = 'sortable';
            if (sortColumn === col.key) {
                th.className += ` sorted-${sortDirection}`;
            }
            th.addEventListener('click', () => onSort(col.key));
        }

        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body rows
    const tbody = document.createElement('tbody');
    for (const app of apps) {
        const row = document.createElement('tr');

        // IOC match highlighting
        if (app.ioc_matches && app.ioc_matches.length > 0) {
            row.className = 'row-ioc-match';
        } else if (app.highest_tier === 1) {
            row.className = 'row-tier1';
        }

        // First-party indicator
        if (app.is_first_party) {
            row.className += ' row-first-party';
        }

        for (const col of columns) {
            const td = document.createElement('td');
            td.dataset.column = col.key;

            // Scope column gets special treatment — expandable
            if (col.key === 'scopes' && app.scopes && app.scopes.length > 3) {
                const preview = app.scopes.slice(0, 3).join(', ');
                td.innerHTML = `<span class="scope-preview">${escapeHtml(preview)}...</span>
                    <span class="scope-full hidden">${escapeHtml(app.scopes.join(', '))}</span>
                    <button class="scope-toggle" aria-label="Show all scopes">+${app.scopes.length - 3} more</button>`;
                td.querySelector('.scope-toggle').addEventListener('click', (e) => {
                    const btn = e.target;
                    const preview = td.querySelector('.scope-preview');
                    const full = td.querySelector('.scope-full');
                    if (full.classList.contains('hidden')) {
                        preview.classList.add('hidden');
                        full.classList.remove('hidden');
                        btn.textContent = 'Show less';
                    } else {
                        preview.classList.remove('hidden');
                        full.classList.add('hidden');
                        btn.textContent = `+${app.scopes.length - 3} more`;
                    }
                });
            } else {
                td.textContent = col.render(app);
            }

            row.appendChild(td);
        }

        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    container.appendChild(table);
}

// ============================================================================
// URL query param state
// ============================================================================

/**
 * Encodes current drill-down state (tile, sort, filters) into URL query params.
 */
export function encodeStateToURL(state) {
    const params = new URLSearchParams();
    if (state.tile) params.set('tile', state.tile);
    if (state.sort) params.set('sort', state.sort);
    if (state.dir) params.set('dir', state.dir);
    if (state.search) params.set('q', state.search);
    if (state.platform) params.set('platform', state.platform);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
}

/**
 * Decodes drill-down state from URL query params.
 */
export function decodeStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    return {
        tile: params.get('tile') || null,
        sort: params.get('sort') || null,
        dir: params.get('dir') || 'asc',
        search: params.get('q') || null,
        platform: params.get('platform') || null,
    };
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
