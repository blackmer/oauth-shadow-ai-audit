/**
 * filter.js — First-party vs third-party filtering and general app filters.
 *
 * Default behavior: third-party apps only. Microsoft first-party services
 * (appOwnerOrganizationId = f8cdef31-...) and Google internal apps are
 * filtered out by default to keep audit focus on external access.
 *
 * Toggle exposes first-party with visual distinction in drill-downs.
 */

// ============================================================================
// First-party / third-party classification
// ============================================================================

/**
 * Microsoft first-party organization IDs. Primary is Microsoft's tenant.
 * Additional known platform tenants can be added here as discovered.
 */
const MS_FIRST_PARTY_ORG_IDS = new Set([
    'f8cdef31-a31e-4b4a-93e4-5f571e91255a',  // Microsoft Corporation
]);

/**
 * Determines whether an app is first-party (platform-owned).
 *
 * Microsoft: appOwnerOrganizationId matches known first-party tenant IDs.
 * Google: Ownership === "Internal"
 *
 * @param {object} app - Unified App model object
 * @returns {boolean}
 */
export function isFirstParty(app) {
    if (app.platform === 'microsoft') {
        return app.is_first_party === true;
    }
    if (app.platform === 'google') {
        return app.ownership === 'Internal';
    }
    return false;
}

// ============================================================================
// Filter application
// ============================================================================

/**
 * Filters an app list based on active filter settings.
 *
 * @param {Array} apps - All unified App model objects
 * @param {object} filters - Active filter settings
 * @param {boolean} filters.showFirstParty - Include first-party apps (default: false)
 * @param {string|null} filters.platform - Limit to "google" or "microsoft" (null = both)
 * @param {number|null} filters.maxTier - Only apps with highest_tier <= this value (null = all)
 * @param {string|null} filters.search - Text search across name, publisher, scopes
 * @returns {Array} Filtered apps
 */
export function filterApps(apps, filters = {}) {
    const {
        showFirstParty = false,
        platform = null,
        maxTier = null,
        search = null,
    } = filters;

    let result = apps;

    // First-party filter (default: hide first-party)
    if (!showFirstParty) {
        result = result.filter(app => !isFirstParty(app));
    }

    // Platform filter
    if (platform) {
        result = result.filter(app => app.platform === platform);
    }

    // Tier filter
    if (maxTier !== null) {
        result = result.filter(app =>
            app.highest_tier !== null &&
            app.highest_tier !== 'unclassified' &&
            app.highest_tier <= maxTier
        );
    }

    // Text search
    if (search && search.trim()) {
        const term = search.trim().toLowerCase();
        result = result.filter(app => {
            const haystack = [
                app.name,
                app.publisher,
                app.grantor,
                ...(app.scopes || []),
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(term);
        });
    }

    return result;
}
