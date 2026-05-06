/**
 * ioc.js — IOC matching engine (BYOIOCDB).
 *
 * Loads an IOC list from a local file or URL, matches against app Client IDs,
 * and propagates match state for banner, tile, and row highlighting.
 *
 * The dashboard does not ship with a pre-populated IOC list. Users supply their own.
 * Match is on client_id only — app name is never used as a match key.
 */

// ============================================================================
// IOC list loading
// ============================================================================

/**
 * Parses and validates an IOC list from JSON text.
 *
 * Expected schema:
 * {
 *   "iocs": [
 *     { "client_id": "...", "name": "...", "platform": "google|microsoft|any",
 *       "severity": "critical|high|medium|low", "source": "...", "added": "...", "notes": "..." }
 *   ]
 * }
 *
 * @param {string} text - Raw JSON text
 * @returns {{ iocs: Array, warnings: Array<string>, error: string|null }}
 */
export function parseIOCList(text) {
    const result = { iocs: [], warnings: [], error: null };

    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        result.error = `IOC list JSON parse failed: ${e.message}`;
        return result;
    }

    // Support both { iocs: [...] } and bare array [...]
    const items = Array.isArray(json) ? json
                : (json.iocs && Array.isArray(json.iocs)) ? json.iocs
                : null;

    if (!items) {
        result.error = 'IOC list must contain an "iocs" array or be a JSON array';
        return result;
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (!item.client_id || typeof item.client_id !== 'string') {
            result.warnings.push(`IOC entry ${i}: missing or invalid client_id, skipped`);
            continue;
        }

        const severity = (item.severity || 'high').toLowerCase();
        if (!['critical', 'high', 'medium', 'low'].includes(severity)) {
            result.warnings.push(`IOC entry ${i}: unknown severity "${item.severity}", defaulting to "high"`);
        }

        const platform = (item.platform || 'any').toLowerCase();
        if (!['google', 'microsoft', 'any'].includes(platform)) {
            result.warnings.push(`IOC entry ${i}: unknown platform "${item.platform}", defaulting to "any"`);
        }

        result.iocs.push({
            client_id: item.client_id.trim(),
            name: item.name || '',
            platform: ['google', 'microsoft', 'any'].includes(platform) ? platform : 'any',
            severity: ['critical', 'high', 'medium', 'low'].includes(severity) ? severity : 'high',
            source: item.source || '',
            added: item.added || '',
            notes: item.notes || '',
        });
    }

    return result;
}

/**
 * Fetches an IOC list from a URL. Respects CORS — user-hosted feeds work,
 * third-party feeds may fail without proper headers.
 *
 * @param {string} url - URL to fetch
 * @returns {Promise<{ iocs: Array, warnings: Array<string>, error: string|null }>}
 */
export async function fetchIOCList(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return { iocs: [], warnings: [], error: `IOC fetch failed: HTTP ${response.status} from ${url}` };
        }
        const text = await response.text();
        const result = parseIOCList(text);
        if (!result.error) {
            result.warnings.unshift(`IOC list loaded from URL: ${url}`);
        }
        return result;
    } catch (e) {
        return {
            iocs: [],
            warnings: [],
            error: `IOC fetch failed: ${e.message}. URL may not support CORS or may be unreachable.`,
        };
    }
}

// ============================================================================
// IOC matching
// ============================================================================

/**
 * Builds a lookup index from an IOC list for efficient matching.
 * Key: client_id → Array of IOC entries (multiple IOCs can match same client_id).
 *
 * @param {Array} iocs - Parsed IOC entries
 * @returns {Map<string, Array>}
 */
export function buildIOCIndex(iocs) {
    const index = new Map();
    for (const ioc of iocs) {
        if (!index.has(ioc.client_id)) {
            index.set(ioc.client_id, []);
        }
        index.get(ioc.client_id).push(ioc);
    }
    return index;
}

/**
 * Matches apps against the IOC index. Mutates apps in place by adding
 * `ioc_matches` field. Returns summary of matches.
 *
 * @param {Array} apps - Unified App model objects
 * @param {Map} iocIndex - IOC index from buildIOCIndex
 * @returns {{ match_count: number, matched_apps: Array<{ app: object, iocs: Array }> }}
 */
export function matchIOCs(apps, iocIndex) {
    const matchedApps = [];

    for (const app of apps) {
        // Match on client_id (app.id is the Client ID / appId)
        const matches = iocIndex.get(app.id);
        if (!matches) {
            app.ioc_matches = [];
            continue;
        }

        // Filter by platform scope
        const platformMatches = matches.filter(ioc =>
            ioc.platform === 'any' || ioc.platform === app.platform
        );

        app.ioc_matches = platformMatches;

        if (platformMatches.length > 0) {
            matchedApps.push({ app, iocs: platformMatches });
        }
    }

    return { match_count: matchedApps.length, matched_apps: matchedApps };
}
