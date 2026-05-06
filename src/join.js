/**
 * join.js — Cross-file joins that produce the unified App model.
 *
 * Google: G1 + G2 → unified Google App model
 * Microsoft: M1 + M2 + M3 + M4 → unified Microsoft App model
 *
 * The normalized App model (per PRD §6.1) is the input to tiles, drill-downs,
 * taxonomy classification, and IOC matching.
 */

// ============================================================================
// Google join: G1 (state snapshot) + G2 (consent event log)
// ============================================================================

/**
 * Joins G1 apps with G2 events to produce the unified Google App model.
 *
 * @param {Array} g1Data - Parsed G1 records (from parseG1)
 * @param {Array|null} g2Data - Parsed G2 records (from parseG2), or null if G2 not loaded
 * @returns {{ apps: Array, warnings: Array<string> }}
 */
export function joinGoogle(g1Data, g2Data) {
    const warnings = [];
    const apps = [];

    if (!g1Data || g1Data.length === 0) {
        return { apps: [], warnings: ['Google join: no G1 data provided'] };
    }

    // Index G2 events by App ID for efficient lookup
    const g2ByAppId = new Map();
    if (g2Data) {
        for (const event of g2Data) {
            if (!g2ByAppId.has(event.app_id)) {
                g2ByAppId.set(event.app_id, []);
            }
            g2ByAppId.get(event.app_id).push(event);
        }
    }

    for (const app of g1Data) {
        const events = g2ByAppId.get(app.id) || [];

        // Find latest Authorize event → granted_at and grantor
        let grantedAt = null;
        let grantor = null;
        let lastEventDate = null;
        let isRevoked = false;

        if (events.length > 0) {
            // Sort events by date descending
            const sorted = [...events].sort((a, b) =>
                new Date(b.date).getTime() - new Date(a.date).getTime()
            );

            // Latest event of any type
            lastEventDate = sorted[0].date;

            // Check if latest event is a Revoke (app revoked after last authorize)
            if (sorted[0].event_type === 'revoke') {
                isRevoked = true;
            }

            // Latest Authorize event → granted_at + grantor
            const latestAuth = sorted.find(e => e.event_type === 'authorize');
            if (latestAuth) {
                grantedAt = latestAuth.date;
                grantor = latestAuth.user;
            }
        }

        // Skip revoked apps from the active set
        if (isRevoked) continue;

        apps.push({
            id: app.id,
            platform: 'google',
            name: app.name,
            publisher: null,  // Google doesn't provide publisher name directly
            publisher_verified: app.verification_status === 'Verified',
            granted_at: grantedAt,
            last_used_at: lastEventDate,
            grantor: grantor,
            grantor_type: 'user',  // Google chained-grant detection deferred to v1.x
            permission_type: null,  // Google doesn't split delegated/application in G1
            scopes: app.scopes,
            highest_tier: null,  // Set by taxonomy engine in a later step
            // Google-specific fields
            ownership: app.ownership,       // "Third party" | "Internal"
            admin_policy: app.access,       // "Trust" | "Limited" | "Block" | "Not configured"
            app_type: app.type,             // "Web Application" | "iOS" etc.
            services: app.services,         // Google services accessed
            // Metadata for display
            has_g2_data: events.length > 0,
        });
    }

    // Check for G2 events referencing apps not in G1 (edge case)
    if (g2Data) {
        const g1Ids = new Set(g1Data.map(a => a.id));
        const orphanIds = new Set();
        for (const event of g2Data) {
            if (!g1Ids.has(event.app_id)) {
                orphanIds.add(event.app_id);
            }
        }
        if (orphanIds.size > 0) {
            warnings.push(`${orphanIds.size} app(s) in G2 not found in G1 (possibly revoked and removed from state snapshot)`);
        }
    }

    return { apps, warnings };
}

// ============================================================================
// Microsoft join: M1 + M2 + M3 + M4 → unified Microsoft App model
// ============================================================================

/**
 * Microsoft first-party tenant ID. Service principals owned by this org are
 * Microsoft internal services, filtered from default view.
 */
const MS_FIRST_PARTY_ORG_ID = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a';

/**
 * Resolves an appRoleId to a permission name by looking up the role in the
 * resource service principal's appRoles collection.
 *
 * @param {string} appRoleId - GUID of the app role
 * @param {string} resourceId - SP object ID of the resource (e.g., Microsoft Graph SP)
 * @param {Map} spById - Map of SP object ID → parsed M3 SP record
 * @returns {string} Permission name (e.g., "Mail.ReadWrite") or the raw GUID if unresolved
 */
function resolveAppRoleId(appRoleId, resourceId, spById) {
    const resourceSp = spById.get(resourceId);
    if (!resourceSp) return appRoleId;

    const role = resourceSp.app_roles.find(r => r.id === appRoleId);
    return role ? role.value : appRoleId;
}

/**
 * Joins M1 + M2 + M3 + M4 to produce the unified Microsoft App model.
 *
 * Critical join: M2.clientId = M3.id (NOT appId).
 * M2's clientId is the service principal object ID in the tenant.
 *
 * @param {Array|null} m1Data - Parsed M1 records
 * @param {Array|null} m2Data - Parsed M2 records
 * @param {Array|null} m3Data - Parsed M3 records (merged if paginated)
 * @param {Array|null} m4Data - Parsed M4 records
 * @returns {{ apps: Array, orphanSignIns: Array, warnings: Array<string> }}
 */
export function joinMicrosoft(m1Data, m2Data, m3Data, m4Data) {
    const warnings = [];

    // Build lookup maps
    // M3 is the backbone — it has the richest SP data
    const spById = new Map();       // M3.id → SP record
    const spByAppId = new Map();    // M3.appId → SP record
    if (m3Data) {
        for (const sp of m3Data) {
            spById.set(sp.id, sp);
            spByAppId.set(sp.app_id, sp);
        }
    }

    // M1 indexed by appId (supplementary metadata)
    const m1ByAppId = new Map();
    if (m1Data) {
        for (const row of m1Data) {
            m1ByAppId.set(row.app_id, row);
        }
    }

    // M2 indexed by clientId (SP object ID) — groups all delegated grants per SP
    const m2ByClientId = new Map();
    if (m2Data) {
        for (const grant of m2Data) {
            if (!m2ByClientId.has(grant.client_id)) {
                m2ByClientId.set(grant.client_id, []);
            }
            m2ByClientId.get(grant.client_id).push(grant);
        }
    }

    // M4 indexed by appId
    const m4ByAppId = new Map();
    if (m4Data) {
        for (const record of m4Data) {
            m4ByAppId.set(record.app_id, record);
        }
    }

    // Primary join: iterate M3 service principals as the source of truth
    const apps = [];
    const processedAppIds = new Set();

    if (m3Data) {
        for (const sp of m3Data) {
            processedAppIds.add(sp.app_id);

            // Delegated scopes from M2 (join on M2.clientId = M3.id)
            const delegatedGrants = m2ByClientId.get(sp.id) || [];
            const delegatedScopes = [];
            let consentType = null;
            let grantor = null;
            let grantorType = 'user';

            for (const grant of delegatedGrants) {
                delegatedScopes.push(...grant.scopes);
                // Track consent type — AllPrincipals = admin consent
                if (grant.consent_type === 'AllPrincipals') {
                    consentType = 'AllPrincipals';
                    grantor = 'Admin consent';
                    grantorType = 'user';  // Admin is still a human; v1.x resolves identity
                } else if (grant.consent_type === 'Principal' && grant.principal_id) {
                    consentType = 'Principal';
                    grantor = grant.principal_id;  // User object ID; display resolution deferred
                    grantorType = 'user';
                }
            }

            // Application permissions from M3 appRoleAssignments
            const applicationPermissions = sp.app_role_assignments.map(ara => {
                const permName = resolveAppRoleId(ara.app_role_id, ara.resource_id, spById);
                return permName;
            });

            // Chained grant detection: if principalType in appRoleAssignment is
            // "ServicePrincipal", the granting entity is an app, not a human
            const chainedGrant = sp.app_role_assignments.some(
                ara => ara.principal_type === 'ServicePrincipal'
            );
            if (chainedGrant) {
                grantorType = 'application';
                // Use the SP's own name as grantor if it granted itself roles
                if (!grantor) grantor = sp.display_name;
            }

            // Last sign-in from M4
            const signInRecord = m4ByAppId.get(sp.app_id);
            const lastUsedAt = signInRecord ? signInRecord.last_sign_in : null;

            // Supplementary metadata from M1
            const m1Record = m1ByAppId.get(sp.app_id);

            // Combine all scopes for tier classification
            const allScopes = [
                ...delegatedScopes.map(s => ({ scope: s, type: 'delegated' })),
                ...applicationPermissions.map(s => ({ scope: s, type: 'application' })),
            ];

            apps.push({
                id: sp.app_id,
                platform: 'microsoft',
                name: sp.display_name,
                publisher: sp.verified_publisher_name || null,
                publisher_verified: sp.verified_publisher_id !== null,
                granted_at: sp.created_at || (m1Record ? m1Record.created_at : null),
                last_used_at: lastUsedAt,
                grantor: grantor,
                grantor_type: grantorType,
                permission_type: applicationPermissions.length > 0 ? 'application' : 'delegated',
                scopes: allScopes.map(s => s.scope),
                scopes_typed: allScopes,  // Preserves delegated vs application context for taxonomy
                highest_tier: null,  // Set by taxonomy engine
                // Microsoft-specific fields
                is_first_party: sp.app_owner_org_id === MS_FIRST_PARTY_ORG_ID,
                app_owner_org_id: sp.app_owner_org_id,
                account_enabled: sp.account_enabled,
                consent_type: consentType,
                sp_object_id: sp.id,
                homepage: sp.homepage || (m1Record ? m1Record.homepage : null),
                state: m1Record ? m1Record.state : null,
                has_m4_data: signInRecord !== null,
            });
        }
    }

    // Handle M1 apps not in M3 (if M3 not loaded, or M1 has apps M3 doesn't)
    if (m1Data && !m3Data) {
        // M3 not loaded — build minimal model from M1 only
        for (const row of m1Data) {
            if (processedAppIds.has(row.app_id)) continue;
            processedAppIds.add(row.app_id);

            const signInRecord = m4ByAppId.get(row.app_id);

            apps.push({
                id: row.app_id,
                platform: 'microsoft',
                name: row.display_name,
                publisher: null,
                publisher_verified: null,
                granted_at: row.created_at,
                last_used_at: signInRecord ? signInRecord.last_sign_in : null,
                grantor: null,
                grantor_type: 'user',
                permission_type: null,
                scopes: [],
                scopes_typed: [],
                highest_tier: null,
                is_first_party: null,  // Cannot determine without M3
                app_owner_org_id: null,
                account_enabled: null,
                consent_type: null,
                sp_object_id: row.id,
                homepage: row.homepage,
                state: row.state,
                has_m4_data: signInRecord !== null,
            });
        }
        warnings.push('M3 not loaded — Microsoft apps lack scope and permission data');
    }

    // Orphan sign-ins: M4 records for appIds not in M3
    // Per VALIDATION-DATA.md: surface as "sign-in activity for apps not in current inventory"
    const orphanSignIns = [];
    if (m4Data) {
        for (const record of m4Data) {
            if (!processedAppIds.has(record.app_id)) {
                orphanSignIns.push({
                    app_id: record.app_id,
                    last_sign_in: record.last_sign_in,
                    delegated_last_sign_in: record.delegated_last_sign_in,
                    application_last_sign_in: record.application_last_sign_in,
                });
            }
        }
    }
    if (orphanSignIns.length > 0) {
        warnings.push(`${orphanSignIns.length} sign-in records in M4 for apps not in current SP inventory`);
    }

    return { apps, orphanSignIns, warnings };
}
