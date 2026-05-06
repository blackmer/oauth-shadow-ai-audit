/**
 * ingest.js — File parsing, schema validation, and normalization for all six input types.
 *
 * Each parser returns: { data: Array, warnings: Array<string>, error: string|null }
 * - data: normalized rows ready for cross-file joins
 * - warnings: non-fatal issues (skipped rows, unexpected values)
 * - error: fatal parse failure (null if successful)
 *
 * Security: All parsing is client-side via FileReader. No data leaves the browser.
 */

// ============================================================================
// Schema definitions — required columns/fields per file type
// ============================================================================

const SCHEMA = {
    G1: {
        required: ['App Name', 'Type', 'Id', 'Verification Status', 'Users',
                   'Access', 'Requested Services', 'Requested Services with Scopes', 'Ownership'],
        // Org Unit may be absent in some exports
        optional: ['Org Unit']
    },
    G2: {
        required: ['Date', 'App ID', 'App name', 'OAuth event', 'User', 'Scope'],
        optional: ['Description', 'API name', 'Method', 'Number of response bytes',
                   'IP address', 'Product', 'Client type', 'Network info']
    },
    M1: {
        required: ['id', 'displayName', 'appId', 'createdDateTime', 'state'],
        optional: ['homepage', 'certificateExpiryStatus', 'activeCertificateExpiryDate',
                   'appStatus', 'appVisibility', 'appProxy', 'identifierUri']
    },
    // M2, M3, M4 are JSON with @odata.context — validated by structure
};

// ============================================================================
// G1 Parser — Google Accessed Apps state snapshot (CSV)
// ============================================================================

/**
 * Parses the G1 scope format: "[Service : [scope1, scope2] | Service : [scope3]]"
 * Returns flat array of scope strings.
 */
function parseG1Scopes(raw) {
    if (!raw || raw.trim() === '') return [];

    const scopes = [];
    // Remove outer brackets
    let inner = raw.trim();
    if (inner.startsWith('[') && inner.endsWith(']')) {
        inner = inner.slice(1, -1);
    }

    // Split on " | " to separate service blocks
    const serviceBlocks = inner.split(' | ');
    for (const block of serviceBlocks) {
        // Format: "Service : [scope1, scope2]"
        const colonIdx = block.indexOf(' : [');
        if (colonIdx === -1) continue;

        const scopeList = block.slice(colonIdx + 4); // after " : ["
        // Remove trailing "]"
        const cleaned = scopeList.endsWith(']') ? scopeList.slice(0, -1) : scopeList;
        // Split on ", " — scopes are URLs or short identifiers
        const parts = cleaned.split(', ');
        for (const s of parts) {
            const trimmed = s.trim();
            if (trimmed) scopes.push(trimmed);
        }
    }
    return scopes;
}

/**
 * Parses the G1 services format: "[Gmail, Google Sign-in]"
 * Returns array of service names.
 */
function parseG1Services(raw) {
    if (!raw || raw.trim() === '') return [];
    let inner = raw.trim();
    if (inner.startsWith('[') && inner.endsWith(']')) {
        inner = inner.slice(1, -1);
    }
    return inner.split(',').map(s => s.trim()).filter(Boolean);
}

export function parseG1(text) {
    const result = { data: [], warnings: [], error: null };

    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    if (parsed.errors.length > 0) {
        const fatalErrors = parsed.errors.filter(e => e.type === 'Quotes' || e.type === 'FieldMismatch');
        if (fatalErrors.length > 0 && parsed.data.length === 0) {
            result.error = `G1 CSV parse failed: ${fatalErrors[0].message}`;
            return result;
        }
        // Non-fatal parse warnings
        for (const e of parsed.errors) {
            result.warnings.push(`G1 row ${e.row}: ${e.message}`);
        }
    }

    // Schema validation
    const headers = parsed.meta.fields || [];
    const missing = SCHEMA.G1.required.filter(col => !headers.includes(col));
    if (missing.length > 0) {
        result.error = `G1 missing required columns: ${missing.join(', ')}`;
        return result;
    }

    for (let i = 0; i < parsed.data.length; i++) {
        const row = parsed.data[i];
        const appName = (row['App Name'] || '').trim();
        const id = (row['Id'] || '').trim();

        if (!id) {
            result.warnings.push(`G1 row ${i + 2}: missing Id, skipped`);
            continue;
        }

        result.data.push({
            id: id,
            name: appName,
            type: (row['Type'] || '').trim(),
            verification_status: (row['Verification Status'] || '').trim(),
            users: (row['Users'] || '').trim(),
            access: (row['Access'] || '').trim(),  // admin_policy field
            services: parseG1Services(row['Requested Services']),
            scopes: parseG1Scopes(row['Requested Services with Scopes']),
            ownership: (row['Ownership'] || '').trim(),
        });
    }

    return result;
}

// ============================================================================
// G2 Parser — Google OAuth audit log (CSV)
// ============================================================================

export function parseG2(text) {
    const result = { data: [], warnings: [], error: null };

    // Papa Parse handles multiline quoted fields (Network info has embedded JSON)
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    if (parsed.errors.length > 0) {
        const fatal = parsed.errors.filter(e => e.type === 'Quotes');
        if (fatal.length > 0 && parsed.data.length === 0) {
            result.error = `G2 CSV parse failed: ${fatal[0].message}`;
            return result;
        }
        for (const e of parsed.errors) {
            result.warnings.push(`G2 row ${e.row}: ${e.message}`);
        }
    }

    const headers = parsed.meta.fields || [];
    const missing = SCHEMA.G2.required.filter(col => !headers.includes(col));
    if (missing.length > 0) {
        result.error = `G2 missing required columns: ${missing.join(', ')}`;
        return result;
    }

    for (let i = 0; i < parsed.data.length; i++) {
        const row = parsed.data[i];
        const appId = (row['App ID'] || '').trim();

        if (!appId) {
            result.warnings.push(`G2 row ${i + 2}: missing App ID, skipped`);
            continue;
        }

        // OAuth event: "Authorize", "Revoke", or blank/empty (activity)
        const event = (row['OAuth event'] || '').trim();
        const eventType = event === 'Authorize' ? 'authorize'
                        : event === 'Revoke' ? 'revoke'
                        : 'activity';

        result.data.push({
            date: (row['Date'] || '').trim(),
            app_id: appId,
            app_name: (row['App name'] || '').trim(),
            event_type: eventType,
            user: (row['User'] || '').trim(),
            scope: (row['Scope'] || '').trim(),
            ip_address: (row['IP address'] || '').trim(),
        });
    }

    return result;
}

// ============================================================================
// M1 Parser — Microsoft Service Principals export (CSV)
// ============================================================================

export function parseM1(text) {
    const result = { data: [], warnings: [], error: null };

    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    if (parsed.errors.length > 0) {
        const fatal = parsed.errors.filter(e => e.type === 'Quotes');
        if (fatal.length > 0 && parsed.data.length === 0) {
            result.error = `M1 CSV parse failed: ${fatal[0].message}`;
            return result;
        }
        for (const e of parsed.errors) {
            result.warnings.push(`M1 row ${e.row}: ${e.message}`);
        }
    }

    const headers = parsed.meta.fields || [];
    const missing = SCHEMA.M1.required.filter(col => !headers.includes(col));
    if (missing.length > 0) {
        result.error = `M1 missing required columns: ${missing.join(', ')}`;
        return result;
    }

    for (let i = 0; i < parsed.data.length; i++) {
        const row = parsed.data[i];
        const appId = (row['appId'] || '').trim();

        if (!appId) {
            result.warnings.push(`M1 row ${i + 2}: missing appId, skipped`);
            continue;
        }

        result.data.push({
            id: (row['id'] || '').trim(),           // SP object ID
            display_name: (row['displayName'] || '').trim(),
            app_id: appId,
            homepage: (row['homepage'] || '').trim(),
            created_at: (row['createdDateTime'] || '').trim(),
            state: (row['state'] || '').trim(),
            app_status: (row['appStatus'] || '').trim(),
            app_visibility: (row['appVisibility'] || '').trim(),
        });
    }

    return result;
}

// ============================================================================
// M2 Parser — Delegated permission grants (Graph JSON)
// ============================================================================

/**
 * Detects whether a JSON object is a Graph API response by checking for
 * @odata.context or a value array.
 */
function extractGraphValues(obj) {
    if (Array.isArray(obj)) return obj;
    if (obj && Array.isArray(obj.value)) return obj.value;
    return null;
}

export function parseM2(text) {
    const result = { data: [], warnings: [], error: null };

    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        result.error = `M2 JSON parse failed: ${e.message}`;
        return result;
    }

    const items = extractGraphValues(json);
    if (!items) {
        result.error = 'M2: expected a Graph API response with a "value" array';
        return result;
    }

    // Validate expected context
    const context = json['@odata.context'] || '';
    if (context && !context.includes('oauth2PermissionGrants')) {
        result.warnings.push(`M2: @odata.context does not reference oauth2PermissionGrants — verify correct file`);
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (!item.clientId) {
            result.warnings.push(`M2 item ${i}: missing clientId, skipped`);
            continue;
        }

        // Scope is a space-separated string; trim leading/trailing whitespace
        const scopeStr = (item.scope || '').trim();
        const scopes = scopeStr ? scopeStr.split(/\s+/) : [];

        result.data.push({
            id: item.id || null,
            client_id: item.clientId,             // SP object ID — joins to M3.id
            consent_type: item.consentType || '',  // "AllPrincipals" or "Principal"
            principal_id: item.principalId || null, // user ID for Principal consents
            resource_id: item.resourceId || '',
            scopes: scopes,
        });
    }

    return result;
}

// ============================================================================
// M3 Parser — Service principals with appRoleAssignments (Graph JSON)
// Accepts multiple files (pagination); merge by id.
// ============================================================================

export function parseM3(text) {
    const result = { data: [], warnings: [], error: null };

    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        result.error = `M3 JSON parse failed: ${e.message}`;
        return result;
    }

    const items = extractGraphValues(json);
    if (!items) {
        result.error = 'M3: expected a Graph API response with a "value" array';
        return result;
    }

    const context = json['@odata.context'] || '';
    if (context && !context.includes('servicePrincipals')) {
        result.warnings.push(`M3: @odata.context does not reference servicePrincipals — verify correct file`);
    }

    if (json['@odata.nextLink']) {
        result.warnings.push('M3: response contains @odata.nextLink — additional pages exist. Upload all pages for complete data.');
    }

    for (let i = 0; i < items.length; i++) {
        const sp = items[i];

        if (!sp.id) {
            result.warnings.push(`M3 item ${i}: missing id, skipped`);
            continue;
        }

        // Extract appRoleAssignments
        const appRoleAssignments = (sp.appRoleAssignments || []).map(ara => ({
            app_role_id: ara.appRoleId || '',
            resource_id: ara.resourceId || '',
            resource_display_name: ara.resourceDisplayName || '',
            principal_type: ara.principalType || '',
            created_at: ara.createdDateTime || null,
        }));

        // Extract verifiedPublisher
        const vp = sp.verifiedPublisher || {};

        result.data.push({
            id: sp.id,                                         // SP object ID — M2.clientId joins here
            app_id: sp.appId || '',
            display_name: sp.displayName || sp.appDisplayName || '',
            app_owner_org_id: sp.appOwnerOrganizationId || null,
            account_enabled: sp.accountEnabled !== false,
            service_principal_type: sp.servicePrincipalType || '',
            sign_in_audience: sp.signInAudience || '',
            homepage: sp.homepage || null,
            created_at: sp.createdDateTime || null,
            verified_publisher_name: vp.displayName || null,
            verified_publisher_id: vp.verifiedPublisherId || null,
            app_role_assignments: appRoleAssignments,
            // Preserve appRoles for role ID resolution (resource SPs expose these)
            app_roles: (sp.appRoles || []).map(role => ({
                id: role.id || '',
                value: role.value || '',
                display_name: role.displayName || '',
            })),
            tags: sp.tags || [],
        });
    }

    return result;
}

/**
 * Merges multiple M3 parse results (pagination support).
 * Deduplicates by SP id — later pages overwrite earlier if duplicated.
 */
export function mergeM3Results(results) {
    const merged = { data: [], warnings: [], error: null };
    const seenIds = new Map();

    for (const r of results) {
        if (r.error) {
            merged.error = r.error;
            return merged;
        }
        merged.warnings.push(...r.warnings);
        for (const sp of r.data) {
            seenIds.set(sp.id, sp);
        }
    }

    merged.data = Array.from(seenIds.values());
    return merged;
}

// ============================================================================
// M4 Parser — Service principal sign-in activities (Graph JSON, beta)
// ============================================================================

export function parseM4(text) {
    const result = { data: [], warnings: [], error: null };

    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        result.error = `M4 JSON parse failed: ${e.message}`;
        return result;
    }

    const items = extractGraphValues(json);
    if (!items) {
        result.error = 'M4: expected a Graph API response with a "value" array';
        return result;
    }

    const context = json['@odata.context'] || '';
    if (context && !context.includes('servicePrincipalSignInActivities')) {
        result.warnings.push(`M4: @odata.context does not reference servicePrincipalSignInActivities — verify correct file`);
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (!item.appId) {
            result.warnings.push(`M4 item ${i}: missing appId, skipped`);
            continue;
        }

        // Extract the most recent sign-in across all activity types
        const activities = [
            item.lastSignInActivity,
            item.delegatedClientSignInActivity,
            item.delegatedResourceSignInActivity,
            item.applicationAuthenticationClientSignInActivity,
            item.applicationAuthenticationResourceSignInActivity,
        ];

        let lastSignIn = null;
        for (const act of activities) {
            if (act && act.lastSignInDateTime) {
                const dt = new Date(act.lastSignInDateTime);
                if (!lastSignIn || dt > lastSignIn) {
                    lastSignIn = dt;
                }
            }
        }

        result.data.push({
            id: item.id || '',
            app_id: item.appId,
            last_sign_in: lastSignIn ? lastSignIn.toISOString() : null,
            // Preserve granular activity for potential future use
            delegated_last_sign_in: item.delegatedClientSignInActivity?.lastSignInDateTime || null,
            application_last_sign_in: item.applicationAuthenticationClientSignInActivity?.lastSignInDateTime || null,
        });
    }

    return result;
}

// ============================================================================
// File type detection — identify file slot by content inspection
// ============================================================================

/**
 * Attempts to auto-detect which file slot a given file belongs to.
 * Returns: 'G1' | 'G2' | 'M1' | 'M2' | 'M3' | 'M4' | null
 */
export function detectFileType(text, filename) {
    const lower = filename.toLowerCase();

    // JSON files — check @odata.context
    if (lower.endsWith('.json')) {
        try {
            const json = JSON.parse(text);
            const context = (json['@odata.context'] || '').toLowerCase();
            if (context.includes('oauth2permissiongrants')) return 'M2';
            if (context.includes('serviceprincipals')) return 'M3';
            if (context.includes('serviceprincipalSignInActivities'.toLowerCase())) return 'M4';
            // Fallback: check value array structure
            if (json.value && json.value.length > 0) {
                const first = json.value[0];
                if ('consentType' in first && 'scope' in first) return 'M2';
                if ('appRoleAssignments' in first || 'servicePrincipalType' in first) return 'M3';
                if ('lastSignInActivity' in first) return 'M4';
            }
        } catch (e) {
            // Not valid JSON
        }
        return null;
    }

    // CSV files — check header row
    if (lower.endsWith('.csv')) {
        const firstLine = text.split('\n')[0] || '';
        if (firstLine.includes('App Name') && firstLine.includes('Requested Services with Scopes')) return 'G1';
        if (firstLine.includes('App ID') && firstLine.includes('OAuth event')) return 'G2';
        if (firstLine.includes('appId') && firstLine.includes('displayName') && firstLine.includes('createdDateTime')) return 'M1';
    }

    return null;
}

// ============================================================================
// Unified parse dispatcher
// ============================================================================

/**
 * Parses a file given its text content and known slot type.
 * Returns { slot, data, warnings, error }.
 */
export function parseFile(text, slot) {
    switch (slot) {
        case 'G1': return { slot, ...parseG1(text) };
        case 'G2': return { slot, ...parseG2(text) };
        case 'M1': return { slot, ...parseM1(text) };
        case 'M2': return { slot, ...parseM2(text) };
        case 'M3': return { slot, ...parseM3(text) };
        case 'M4': return { slot, ...parseM4(text) };
        default:   return { slot, data: [], warnings: [], error: `Unknown file slot: ${slot}` };
    }
}
