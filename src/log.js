/**
 * log.js — CEF-formatted security event log.
 *
 * Generates Common Event Format (CEF) log entries for security-relevant events.
 * Log retention is per-session in memory. User downloads if needed for SIEM import.
 * No logs are transmitted anywhere — matches the no-server posture.
 *
 * CEF Format:
 * CEF:Version|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension
 */

const CEF_VENDOR = 'Blackmer Advisory';
const CEF_PRODUCT = 'OAuth Shadow AI Audit';
const CEF_VERSION = '0.1.0';

// ============================================================================
// Log store (session-only, in memory)
// ============================================================================

const logEntries = [];

/**
 * Returns all log entries accumulated this session.
 * @returns {Array<string>} CEF-formatted log lines
 */
export function getLogEntries() {
    return [...logEntries];
}

/**
 * Clears the in-memory log (e.g., on data reimport).
 */
export function clearLog() {
    logEntries.length = 0;
}

// ============================================================================
// Event logging
// ============================================================================

/**
 * Logs a data import event.
 *
 * @param {string} platform - "google" or "microsoft"
 * @param {string} fileSlot - File slot identifier (G1, G2, M1, etc.)
 * @param {number} rowCount - Number of records parsed
 * @param {string} taxonomyVersion - Active taxonomy version
 */
export function logImport(platform, fileSlot, rowCount, taxonomyVersion) {
    const entry = buildCEF({
        signatureId: '100',
        name: 'Data Import',
        severity: 1, // Informational
        extension: {
            cs1: platform,
            cs1Label: 'Platform',
            cs2: fileSlot,
            cs2Label: 'FileSlot',
            cn1: rowCount,
            cn1Label: 'RecordCount',
            cs3: taxonomyVersion,
            cs3Label: 'TaxonomyVersion',
        },
    });
    logEntries.push(entry);
}

/**
 * Logs an IOC match detection event.
 *
 * @param {string} appName - Name of the matched app
 * @param {string} clientId - Client ID that matched
 * @param {string} iocSeverity - Severity from IOC entry
 * @param {string} iocSource - Source attribution of the IOC
 */
export function logIOCMatch(appName, clientId, iocSeverity, iocSource) {
    const severityMap = { critical: 10, high: 7, medium: 4, low: 1 };
    const entry = buildCEF({
        signatureId: '200',
        name: 'IOC Match Detected',
        severity: severityMap[iocSeverity] || 7,
        extension: {
            dhost: appName,
            cs1: clientId,
            cs1Label: 'ClientID',
            cs2: iocSeverity,
            cs2Label: 'IOCSeverity',
            cs3: iocSource,
            cs3Label: 'IOCSource',
        },
    });
    logEntries.push(entry);
}

/**
 * Logs an unknown (unclassified) scope encounter.
 *
 * @param {string} scope - The unclassified scope string
 * @param {string} appName - App that holds this scope
 * @param {string} platform - "google" or "microsoft"
 */
export function logUnknownScope(scope, appName, platform) {
    const entry = buildCEF({
        signatureId: '300',
        name: 'Unknown Scope Encountered',
        severity: 3, // Low — informational but review needed
        extension: {
            cs1: scope,
            cs1Label: 'Scope',
            cs2: appName,
            cs2Label: 'AppName',
            cs3: platform,
            cs3Label: 'Platform',
        },
    });
    logEntries.push(entry);
}

/**
 * Logs a configuration load event (taxonomy or IOC source).
 *
 * @param {string} configType - "taxonomy" or "ioc"
 * @param {string} source - File name or URL (not contents)
 */
export function logConfigLoad(configType, source) {
    const entry = buildCEF({
        signatureId: '400',
        name: 'Configuration Loaded',
        severity: 1, // Informational
        extension: {
            cs1: configType,
            cs1Label: 'ConfigType',
            cs2: source,
            cs2Label: 'Source',
        },
    });
    logEntries.push(entry);
}

// ============================================================================
// CEF formatting
// ============================================================================

/**
 * Builds a CEF-formatted log line.
 *
 * @param {object} params
 * @param {string} params.signatureId - Event class ID
 * @param {string} params.name - Human-readable event name
 * @param {number} params.severity - 0-10 scale
 * @param {object} params.extension - Key-value pairs for the extension field
 * @returns {string} CEF log line
 */
function buildCEF({ signatureId, name, severity, extension }) {
    const timestamp = new Date().toISOString();
    const ext = Object.entries(extension)
        .map(([k, v]) => `${k}=${cefEscape(String(v))}`)
        .join(' ');

    return `CEF:0|${CEF_VENDOR}|${CEF_PRODUCT}|${CEF_VERSION}|${signatureId}|${cefEscapeHeader(name)}|${severity}|rt=${timestamp} ${ext}`;
}

/**
 * Escapes a value for CEF extension fields.
 * CEF requires escaping: backslash, equals sign, newlines.
 */
function cefEscape(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/=/g, '\\=')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

/**
 * Escapes a value for CEF header fields.
 * CEF header fields escape: backslash and pipe.
 */
function cefEscapeHeader(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|');
}

// ============================================================================
// Export / download
// ============================================================================

/**
 * Generates the full CEF log as downloadable text.
 *
 * @returns {string} Complete CEF log content
 */
export function exportLog() {
    const header = [
        `# CEF Security Log — ${CEF_PRODUCT}`,
        `# Generated: ${new Date().toISOString()}`,
        `# Entries: ${logEntries.length}`,
        '#',
    ].join('\n');

    return header + '\n' + logEntries.join('\n') + '\n';
}
