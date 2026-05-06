# OAuth & Shadow AI Control Audit Dashboard

A browser-based dashboard that audits OAuth application and service principal access in Google Workspace and Microsoft 365 / Entra ID tenants.

**Security model:** All processing happens client-side. No backend, no data transmission, no persistence, no telemetry.

## Status

v0.1.0 — Under active development. Private repository.

## Quick start

1. Clone the repo and serve it locally (any static HTTP server works):
   ```
   python3 -m http.server 8000
   ```
2. Open `http://localhost:8000` in your browser.
3. Export data from your admin consoles (see below).
4. Upload the files to their labeled slots in the dashboard.
5. Click **Run Analysis** to generate findings.

## Exporting data

### Google Workspace

Requires **Super Admin** access to the Google Admin Console.

**G1 — Accessed Apps (CSV)** — *required for Google audit*

1. Sign in to **admin.google.com**.
2. Navigate to **Security** > **Access and data control** > **API controls** > **App access control**.
3. Click **MANAGE APP ACCESS**, then select the **Accessed apps** tab.
4. Click **Download** (CSV icon). Save the file.

Provides: app inventory, scopes by service, verification status, ownership classification.

**G2 — OAuth Audit Log (CSV)** — *recommended*

1. Navigate to **Reporting** > **Audit and investigation** > **OAuth log events**.
2. Set date range as wide as available (Google retains approximately 6 months).
3. Click **Download**. Save the file.

Provides: grant/revoke timeline, grantor identity, last consent event dates.

| Feature | G1 only | G1 + G2 |
|---------|---------|---------|
| App inventory with scopes | Yes | Yes |
| Scope risk tier classification | Yes | Yes |
| IOC matching | Yes | Yes |
| Granted-by (grantor identity) | No | Yes |
| Grant date / days since granted | No | Yes |
| Revocation detection | No | Yes |

### Microsoft Entra ID / Microsoft 365

Requires at minimum **Global Reader** or **Application Administrator** role.

**M1 — Enterprise Applications (CSV)**

1. Sign in to **entra.microsoft.com**.
2. Navigate to **Identity** > **Applications** > **Enterprise applications** > **All applications**.
3. Click **Download** (export the list as CSV). Save the file.

Provides: app inventory metadata (names, IDs, creation dates). Does not include scopes or permissions.

**M2, M3, M4 — Graph Explorer JSON files**

1. Open **developer.microsoft.com/en-us/graph/graph-explorer** and sign in with your tenant admin account.
2. Consent to the required permissions when prompted.
3. Run each query, then copy the full JSON response and save it as a `.json` file.

| File | Query URL | Permission needed | Notes |
|------|-----------|-------------------|-------|
| M2 | `https://graph.microsoft.com/v1.0/oauth2PermissionGrants` | DelegatedPermissionGrant.Read.All | |
| M3 | `https://graph.microsoft.com/v1.0/servicePrincipals?$expand=appRoleAssignments&$top=999` | Application.Read.All | If the response contains `@odata.nextLink`, follow the link and save each page as a separate file. Upload all pages to the M3 slot. |
| M4 | `https://graph.microsoft.com/beta/reports/servicePrincipalSignInActivities` | AuditLog.Read.All | Requires **Entra ID P1** license. If unavailable, skip. |

| Feature | M1 only | M1 + M2 + M3 | M1 + M2 + M3 + M4 |
|---------|---------|--------------|-------------------|
| App inventory | Yes | Yes | Yes |
| IOC matching | Yes | Yes | Yes |
| Delegated permission scopes | No | Yes | Yes |
| Application permission roles | No | Yes | Yes |
| Scope risk tier classification | No | Yes | Yes |
| First-party vs third-party filter | No | Yes | Yes |
| Consent type (admin vs user) | No | Yes | Yes |
| Chained grant detection | No | Yes | Yes |
| Last sign-in / unused token detection | No | No | Yes (P1) |

## Dashboard features

### KPI tiles

- **Tier 1 (Critical) Access** — Apps with tenant-wide write to identity, mail, or files.
- **Granted >90 Days** — Long-lived grants that may no longer be justified.
- **Unused >30 Days** — Dormant tokens that are attack surface (Microsoft P1 required).
- **Distinct Grantors** — Per-user breakdown. Anomalies in single-admin tenants stand out.
- **Chained Grants** — App-to-app consent grants (consent chaining detection).
- **IOC Matches** — Apps matched against your IOC list by Client ID.

### Drill-down views

Click any tile to see the apps that triggered it. Drill-down tables are sortable by any column, with contextual descriptions and column tooltips explaining each field. Hover over column headers for definitions.

### Exports

- **CSV export** of any filtered drill-down view — includes taxonomy version for audit reproducibility.
- **Print to PDF** via browser print (Ctrl/Cmd + P) — print stylesheet produces clean, paginated audit output.
- **CEF security log** — downloadable Common Event Format log for SIEM import.

## Scope risk taxonomy

The scope risk taxonomy (`taxonomy/taxonomy-google.json`, `taxonomy/taxonomy-microsoft.json`) is the project's core intellectual property — the framework that turns raw OAuth scope strings into prioritized audit findings.

### Tier definitions

| Tier | Level | Description |
|------|-------|-------------|
| 1 | Critical | Tenant-wide write to identity, mail, or files. Application-type permissions that act without user context. |
| 2 | High | Tenant-wide read OR user-scoped write to sensitive resources (mail, full drive). |
| 3 | Moderate | User-scoped read to sensitive resources, or write to bounded resources. |
| 4 | Low | Profile, openid, basic identity claims, app-specific data. |

### Microsoft delegated vs. application

The same scope name can carry different risk depending on context. For example:
- `Mail.ReadWrite` (application) = **Tier 1** — acts on every mailbox in the tenant.
- `Mail.ReadWrite` (delegated) = **Tier 2** — acts only as the consenting user.

The taxonomy has separate entries per context. The dashboard determines context from the source endpoint: delegated scopes come from `oauth2PermissionGrants` (M2), application permissions from `appRoleAssignments` (M3).

### Updating the taxonomy

Edit the JSON files directly. Each entry has a `rationale` field documenting why the scope is classified at its tier. Bump the `version` field when you make changes — the version is logged in exports for audit reproducibility.

Unknown scopes (not in the taxonomy) are flagged as **"unclassified — review needed"** and surfaced in the dashboard. They are never silently bucketed.

## IOC matching (BYOIOCDB)

The dashboard does not ship with a pre-populated IOC list. Supply your own via:

- A local JSON file uploaded alongside your data exports.
- A URL pointing to a hosted JSON feed (respects CORS).

See `iocs/iocs.example.json` for the expected schema. Match is on `client_id` only — app name is informational and never used as a match key.

## Known limitations (v1)

- **File-based ingestion only** — findings are point-in-time snapshots, not real-time.
- **Google audit log retention is ~6 months.** Apps granted before that window lack timestamp data.
- **Google usage activity data** is not currently available from the G2 export. The "unused tokens" tile covers Microsoft only.
- **Google domain-wide delegation (DWD)** is not detectable from G1/G2 exports. DWD is a service account property surfaced under a separate admin console page.
- **Microsoft `AllPrincipals` consent** shows as "Admin consent" rather than identifying the specific admin.
- **Performance target** is tenants with up to 500 apps.

## Security

- No backend. No server. No data transmission off your machine.
- No persistence between sessions (no localStorage, sessionStorage, or IndexedDB).
- No telemetry, analytics, or error reporting of any kind.
- Content Security Policy restricts script and resource loading.
- Papa Parse bundled locally with Subresource Integrity hash.

## License

MIT
