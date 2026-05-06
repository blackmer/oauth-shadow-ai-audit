/**
 * export.js — CSV export of filtered drill-down views and print stylesheet support.
 *
 * CSV export is essential for handing remediation lists to clients.
 * Print-to-PDF uses browser native print with a clean audit-grade stylesheet.
 */

// ============================================================================
// CSV export
// ============================================================================

/**
 * Exports a drill-down view to CSV format.
 *
 * @param {Array} apps - Filtered apps currently displayed in the drill-down
 * @param {object} options
 * @param {string} options.title - Export title (included as metadata row)
 * @param {string} options.taxonomyVersion - Taxonomy version for audit reproducibility
 * @returns {string} CSV text content
 */
export function exportToCSV(apps, options = {}) {
    const { title = 'OAuth Audit Export', taxonomyVersion = '' } = options;

    const headers = [
        'App Name',
        'Platform',
        'Client ID',
        'Publisher',
        'Verified',
        'Highest Tier',
        'Days Since Granted',
        'Days Since Last Used',
        'Grantor',
        'Grantor Type',
        'Permission Type',
        'Admin Policy',
        'IOC Match',
        'Scopes',
    ];

    const rows = apps.map(app => [
        app.name || '',
        app.platform || '',
        app.id || '',
        app.publisher || '',
        app.publisher_verified === true ? 'Yes' : app.publisher_verified === false ? 'No' : '',
        app.highest_tier === null ? '' : app.highest_tier === 'unclassified' ? 'Unclassified' : `Tier ${app.highest_tier}`,
        formatDaysSince(app.granted_at),
        formatDaysSince(app.last_used_at),
        app.grantor || '',
        app.grantor_type || '',
        app.permission_type || '',
        app.admin_policy || '',
        (app.ioc_matches && app.ioc_matches.length > 0) ? `YES (${app.ioc_matches[0].severity})` : '',
        (app.scopes || []).join('; '),
    ]);

    // Build CSV with metadata header
    const lines = [];
    lines.push(`# ${title}`);
    if (taxonomyVersion) lines.push(`# Taxonomy version: ${taxonomyVersion}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push(`# Records: ${apps.length}`);
    lines.push('');
    lines.push(headers.map(csvEscape).join(','));
    for (const row of rows) {
        lines.push(row.map(csvEscape).join(','));
    }

    return lines.join('\n');
}

/**
 * Triggers a file download in the browser.
 *
 * @param {string} content - File content
 * @param {string} filename - Suggested filename
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType = 'text/csv') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Exports the current drill-down view and triggers download.
 *
 * @param {Array} apps - Apps to export
 * @param {string} tileName - Which tile triggered this export (for filename)
 * @param {string} taxonomyVersion - For audit reproducibility
 */
export function exportDrilldown(apps, tileName = 'audit', taxonomyVersion = '') {
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `oauth-audit-${tileName}-${timestamp}.csv`;
    const csv = exportToCSV(apps, { title: `OAuth Audit — ${tileName}`, taxonomyVersion });
    downloadFile(csv, filename);
}

// ============================================================================
// Utilities
// ============================================================================

function csvEscape(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function formatDaysSince(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return String(Math.floor((Date.now() - d.getTime()) / 86400000));
}
