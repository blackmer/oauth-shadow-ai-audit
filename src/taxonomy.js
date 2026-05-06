/**
 * taxonomy.js — Scope tier classification engine.
 *
 * Loads taxonomy JSON files and classifies app scopes into risk tiers (1–4).
 * Unknown scopes are flagged as "unclassified" and surfaced in the dashboard.
 *
 * The taxonomy is the project's core IP — the framework that turns raw OAuth
 * scope strings into ranked risk findings.
 */

// ============================================================================
// Taxonomy loading and indexing
// ============================================================================

/**
 * Builds a lookup index from a taxonomy JSON object.
 *
 * For Google: key is the scope string (no permission_type distinction).
 * For Microsoft: key is "scope|permission_type" since the same scope can
 * have different tiers depending on delegated vs application context.
 *
 * @param {object} taxonomy - Parsed taxonomy JSON (version, platform, scopes array)
 * @returns {{ index: Map, version: string, platform: string }}
 */
export function buildTaxonomyIndex(taxonomy) {
    const index = new Map();

    for (const entry of taxonomy.scopes) {
        if (taxonomy.platform === 'microsoft' && entry.permission_type) {
            // Microsoft: keyed by scope + permission type
            const key = `${entry.scope}|${entry.permission_type}`;
            index.set(key, entry);
        } else {
            // Google (or Microsoft entries without permission_type): keyed by scope alone
            index.set(entry.scope, entry);
        }
    }

    return {
        index,
        version: taxonomy.version,
        platform: taxonomy.platform,
    };
}

// ============================================================================
// Classification
// ============================================================================

/**
 * Classifies a single scope string against a taxonomy index.
 *
 * @param {string} scope - The scope string to classify
 * @param {string|null} permissionType - "delegated" or "application" (Microsoft only)
 * @param {Map} index - Taxonomy index from buildTaxonomyIndex
 * @param {string} platform - "google" or "microsoft"
 * @returns {{ tier: number|"unclassified", rationale: string|null }}
 */
export function classifyScope(scope, permissionType, index, platform) {
    if (platform === 'microsoft' && permissionType) {
        // Try exact match with permission type first
        const key = `${scope}|${permissionType}`;
        const entry = index.get(key);
        if (entry) return { tier: entry.tier, rationale: entry.rationale };

        // Fall back to scope-only lookup (some entries may not have permission_type)
        const fallback = index.get(scope);
        if (fallback) return { tier: fallback.tier, rationale: fallback.rationale };
    } else {
        // Google: direct scope lookup
        const entry = index.get(scope);
        if (entry) return { tier: entry.tier, rationale: entry.rationale };
    }

    return { tier: 'unclassified', rationale: null };
}

/**
 * Classifies all scopes for an app and determines the highest (most critical) tier.
 *
 * @param {object} app - Unified App model object
 * @param {object} taxonomyIdx - Taxonomy index for the app's platform
 * @returns {{ highest_tier: number|"unclassified", scope_classifications: Array, unclassified: Array }}
 */
export function classifyApp(app, taxonomyIdx) {
    const classifications = [];
    const unclassified = [];
    let highestTier = null;

    if (app.platform === 'microsoft' && app.scopes_typed) {
        // Microsoft: use typed scopes for proper delegated/application distinction
        for (const st of app.scopes_typed) {
            const result = classifyScope(st.scope, st.type, taxonomyIdx.index, 'microsoft');
            classifications.push({
                scope: st.scope,
                permission_type: st.type,
                tier: result.tier,
                rationale: result.rationale,
            });
            if (result.tier === 'unclassified') {
                unclassified.push({ scope: st.scope, permission_type: st.type });
            } else if (highestTier === null || result.tier < highestTier) {
                highestTier = result.tier;
            }
        }
    } else {
        // Google (or fallback): scopes are flat strings
        for (const scope of app.scopes) {
            const result = classifyScope(scope, null, taxonomyIdx.index, app.platform);
            classifications.push({
                scope: scope,
                permission_type: null,
                tier: result.tier,
                rationale: result.rationale,
            });
            if (result.tier === 'unclassified') {
                unclassified.push({ scope: scope, permission_type: null });
            } else if (highestTier === null || result.tier < highestTier) {
                highestTier = result.tier;
            }
        }
    }

    // If all scopes are unclassified, highest_tier is "unclassified"
    // If no scopes at all, highest_tier is null (no access to classify)
    if (classifications.length === 0) {
        highestTier = null;
    } else if (highestTier === null) {
        highestTier = 'unclassified';
    }

    return { highest_tier: highestTier, scope_classifications: classifications, unclassified };
}

/**
 * Applies taxonomy classification to all apps in a collection.
 * Mutates each app's `highest_tier` field in place and returns aggregate stats.
 *
 * @param {Array} apps - Array of unified App model objects
 * @param {object} googleTaxonomy - Google taxonomy index (or null)
 * @param {object} microsoftTaxonomy - Microsoft taxonomy index (or null)
 * @returns {{ classified: number, unclassified_scopes: Array, stats: object }}
 */
export function classifyAllApps(apps, googleTaxonomy, microsoftTaxonomy) {
    const allUnclassified = [];
    let classified = 0;

    const stats = { tier1: 0, tier2: 0, tier3: 0, tier4: 0, unclassified: 0, no_scopes: 0 };

    for (const app of apps) {
        const taxonomy = app.platform === 'google' ? googleTaxonomy
                       : app.platform === 'microsoft' ? microsoftTaxonomy
                       : null;

        if (!taxonomy) {
            app.highest_tier = 'unclassified';
            stats.unclassified++;
            continue;
        }

        const result = classifyApp(app, taxonomy);
        app.highest_tier = result.highest_tier;
        app.scope_classifications = result.scope_classifications;

        if (result.highest_tier === null) {
            stats.no_scopes++;
        } else if (result.highest_tier === 'unclassified') {
            stats.unclassified++;
        } else {
            stats[`tier${result.highest_tier}`]++;
            classified++;
        }

        // Collect unclassified scopes for surfacing
        for (const u of result.unclassified) {
            allUnclassified.push({
                app_name: app.name,
                app_id: app.id,
                platform: app.platform,
                ...u,
            });
        }
    }

    return { classified, unclassified_scopes: allUnclassified, stats };
}
