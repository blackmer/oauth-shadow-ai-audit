/**
 * tiles.js — KPI tile computation for the dashboard top-level view.
 *
 * Six tiles per PRD §4.2:
 * 1. Apps with Tier 1 (Critical) access
 * 2. Apps granted >90 days ago
 * 3. Apps with token unused >30 days
 * 4. Apps granted by user (per-grantor breakdown)
 * 5. Apps granted by other apps (chained grants)
 * 6. Known IOC matches
 */

// ============================================================================
// Tile computation functions
// ============================================================================

/**
 * Tile 1: Apps with critical (Tier 1) access.
 * Threshold is configurable — can include Tier 1+2, etc.
 *
 * @param {Array} apps - Filtered app list
 * @param {object} options
 * @param {number} options.maxTier - Include apps with tier <= this (default: 1)
 * @returns {{ count: number, apps: Array }}
 */
export function tileCriticalAccess(apps, options = {}) {
    const { maxTier = 1 } = options;
    const matched = apps.filter(app =>
        app.highest_tier !== null &&
        app.highest_tier !== 'unclassified' &&
        app.highest_tier <= maxTier
    );
    return { count: matched.length, apps: matched };
}

/**
 * Tile 2: Apps granted more than N days ago.
 * Configurable threshold, default 90 days.
 *
 * @param {Array} apps - Filtered app list
 * @param {object} options
 * @param {number} options.daysThreshold - Days since grant (default: 90)
 * @returns {{ count: number, apps: Array, no_data: Array }}
 */
export function tileStaleGrants(apps, options = {}) {
    const { daysThreshold = 90 } = options;
    const now = new Date();
    const threshold = daysThreshold * 24 * 60 * 60 * 1000;

    const stale = [];
    const noData = [];

    for (const app of apps) {
        if (!app.granted_at) {
            noData.push(app);
            continue;
        }
        const grantDate = new Date(app.granted_at);
        if (isNaN(grantDate.getTime())) {
            noData.push(app);
            continue;
        }
        if (now - grantDate > threshold) {
            stale.push(app);
        }
    }

    return { count: stale.length, apps: stale, no_data: noData };
}

/**
 * Tile 3: Apps with token unused for more than N days.
 * Configurable threshold, default 30 days.
 *
 * Apps without last_used_at data are placed in a separate "no telemetry" bucket
 * and NOT folded into the count.
 *
 * Google side: last_used_at derived from latest G2 event (requires Activity events in export).
 * Microsoft side: requires Entra ID P1 (M4 file).
 *
 * @param {Array} apps - Filtered app list
 * @param {object} options
 * @param {number} options.daysThreshold - Days since last use (default: 30)
 * @returns {{ count: number, apps: Array, no_data: Array, platform_unavailable: object }}
 */
export function tileUnusedTokens(apps, options = {}) {
    const { daysThreshold = 30 } = options;
    const now = new Date();
    const threshold = daysThreshold * 24 * 60 * 60 * 1000;

    const unused = [];
    const noData = [];

    // Track which platforms lack last_used_at entirely
    const platformCounts = { google: { total: 0, has_data: 0 }, microsoft: { total: 0, has_data: 0 } };

    for (const app of apps) {
        if (app.platform in platformCounts) {
            platformCounts[app.platform].total++;
        }

        if (!app.last_used_at) {
            noData.push(app);
            continue;
        }

        if (app.platform in platformCounts) {
            platformCounts[app.platform].has_data++;
        }

        const lastUsed = new Date(app.last_used_at);
        if (isNaN(lastUsed.getTime())) {
            noData.push(app);
            continue;
        }
        if (now - lastUsed > threshold) {
            unused.push(app);
        }
    }

    // Determine platform-level data availability
    const platformUnavailable = {};
    if (platformCounts.google.total > 0 && platformCounts.google.has_data === 0) {
        platformUnavailable.google = 'Usage data not available for Google apps';
    }
    if (platformCounts.microsoft.total > 0 && platformCounts.microsoft.has_data === 0) {
        platformUnavailable.microsoft = 'Last-used data unavailable — requires Entra ID P1';
    }

    return { count: unused.length, apps: unused, no_data: noData, platform_unavailable: platformUnavailable };
}

/**
 * Tile 4: Per-grantor breakdown — count of distinct apps per grantor.
 * Highlights anomalies in single-admin tenants.
 *
 * @param {Array} apps - Filtered app list
 * @returns {{ grantors: Array<{ grantor: string, count: number, apps: Array }>, total_grantors: number }}
 */
export function tileGrantorBreakdown(apps) {
    const byGrantor = new Map();

    for (const app of apps) {
        const grantor = app.grantor || 'Unknown';
        if (!byGrantor.has(grantor)) {
            byGrantor.set(grantor, []);
        }
        byGrantor.get(grantor).push(app);
    }

    const grantors = Array.from(byGrantor.entries())
        .map(([grantor, grantorApps]) => ({ grantor, count: grantorApps.length, apps: grantorApps }))
        .sort((a, b) => b.count - a.count);

    return { grantors, total_grantors: grantors.length };
}

/**
 * Tile 5: Apps granted by other apps (chained grants / consent chaining).
 * The granting principal is itself a service principal or OAuth application.
 *
 * @param {Array} apps - Filtered app list
 * @returns {{ count: number, apps: Array }}
 */
export function tileChainedGrants(apps) {
    const chained = apps.filter(app => app.grantor_type === 'application');
    return { count: chained.length, apps: chained };
}

/**
 * Tile 6: Known IOC matches.
 * Count of apps matched against the active IOC list by Client ID.
 *
 * @param {Array} apps - Filtered app list
 * @returns {{ count: number, apps: Array, no_ioc_list: boolean }}
 */
export function tileIOCMatches(apps) {
    // If no app has ioc_matches field, IOC list was never loaded
    const hasIOCData = apps.some(app => Array.isArray(app.ioc_matches));
    if (!hasIOCData) {
        return { count: 0, apps: [], no_ioc_list: true };
    }

    const matched = apps.filter(app => app.ioc_matches && app.ioc_matches.length > 0);
    return { count: matched.length, apps: matched, no_ioc_list: false };
}

// ============================================================================
// Aggregate computation
// ============================================================================

/**
 * Computes all six tiles in one pass.
 *
 * @param {Array} apps - Filtered app list (after first-party filter applied)
 * @param {object} options - Configurable thresholds
 * @param {number} options.criticalMaxTier - Tier threshold for critical tile (default: 1)
 * @param {number} options.staleDays - Days threshold for stale grants (default: 90)
 * @param {number} options.unusedDays - Days threshold for unused tokens (default: 30)
 * @returns {object} All tile results
 */
export function computeAllTiles(apps, options = {}) {
    const {
        criticalMaxTier = 1,
        staleDays = 90,
        unusedDays = 30,
    } = options;

    return {
        critical: tileCriticalAccess(apps, { maxTier: criticalMaxTier }),
        stale: tileStaleGrants(apps, { daysThreshold: staleDays }),
        unused: tileUnusedTokens(apps, { daysThreshold: unusedDays }),
        grantors: tileGrantorBreakdown(apps),
        chained: tileChainedGrants(apps),
        ioc: tileIOCMatches(apps),
    };
}
