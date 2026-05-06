# OAuth & Shadow AI Control Audit Dashboard

A browser-based dashboard that audits OAuth application and service principal access in Google Workspace and Microsoft 365 / Entra ID tenants.

**Security model:** All processing happens client-side. No backend, no data transmission, no persistence, no telemetry.

## Status

v0.1.0 — Project skeleton. Under active development. Private repository.

## How it works

1. Export data from your Google Workspace admin console and Microsoft Entra ID / Graph Explorer (six files total).
2. Load the files into the dashboard in your browser.
3. Review findings across six KPI tiles: critical access, stale grants, unused tokens, per-grantor breakdown, chained grants, and IOC matches.
4. Drill down, filter, sort, and export findings to CSV for remediation or audit deliverables.

## File inputs

| Slot | Platform | Source | Purpose |
|------|----------|--------|---------|
| G1 | Google | Admin Console → Accessed apps CSV | App inventory with scopes |
| G2 | Google | Admin Console → OAuth log events CSV | Grant/revoke/activity timeline |
| M1 | Microsoft | Entra → Enterprise Apps CSV | App inventory (metadata only) |
| M2 | Microsoft | Graph Explorer → oauth2PermissionGrants | Delegated permission grants |
| M3 | Microsoft | Graph Explorer → servicePrincipals?$expand=appRoleAssignments | App details + application permissions |
| M4 | Microsoft | Graph Explorer → reports/servicePrincipalSignInActivities | Last sign-in activity (requires P1) |

## Scope taxonomy

The scope risk taxonomy (`taxonomy/taxonomy-google.json`, `taxonomy/taxonomy-microsoft.json`) maps OAuth scope strings to risk tiers (1–4). This is the project's core IP — the framework that turns raw scope data into prioritized audit findings.

To update the taxonomy, edit the JSON files directly. Each entry includes a rationale field documenting why a scope is classified at its tier.

## IOC matching (BYOIOCDB)

The dashboard does not ship with a pre-populated IOC list. Supply your own via:

- A local JSON file uploaded alongside your data exports
- A URL pointing to a hosted JSON feed (respects CORS)

See `iocs/iocs.example.json` for the schema.

## Known limitations (v1)

- File-based ingestion only — findings are point-in-time snapshots, not real-time.
- Google audit log retention is ~6 months. Apps granted before that window lack timestamp data.
- Microsoft `AllPrincipals` (admin consent) grants show as "Admin consent" rather than identifying the specific admin.
- Google domain-wide delegation (DWD) is not detectable from G1/G2 exports. DWD is a service account property surfaced under a separate admin console page, not in the Accessed apps or OAuth log exports.
- Performance target is tenants with up to 500 apps.

## License

MIT
