# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-05-12

### Added

- `favicon.svg` and corresponding `<link>` reference in `index.html`. Eliminates `/favicon.ico` 404 in server logs and adds a browser tab icon.
- UI-drift disclaimer in both README and dashboard import panel, noting that admin console UIs change and the file schemas are the source of truth.
- `docs/screenshots/dashboard_screenshot.png` — dashboard reference screenshot for README.
- `docs/security-verification-network-trace.png` — canonical reference for clean-load network trace, referenced from README security section.

### Changed

- Promoted `README.md` from `docs/` to repo root for GitHub default rendering.
- README opener rewritten — removed marketing-style framing in favor of factual product description.

### Fixed

- G1 (Google Accessed Apps) export instructions corrected against live admin console (verified 2026-05-12). Adds missing intermediate steps: tile carousel navigation, "View list" click, "Download list" action, format dialog, and Tasks list retrieval. Previous instructions referenced a non-existent "Accessed apps tab" and "CSV icon."
- M1 (Microsoft Enterprise Applications) export instructions corrected against live Entra admin center (verified 2026-05-12). Nav path updated to `Entra ID → Enterprise apps → All applications` (previously `Identity → Applications → Enterprise applications → All applications`). Documents the async bulk-operations flow.

## [0.1.0] — 2026-05-05

### Added

- Project skeleton: directory structure, taxonomy schema stubs, IOC example file, README, CHANGELOG.
- File ingestion parsers for all six input types (G1, G2, M1, M2, M3, M4) with schema validation.
- Papa Parse 5.4.1 bundled with SRI hash for robust CSV handling (multiline quoted fields in G2).
- Cross-file join logic: G1+G2 for Google, M1+M2+M3+M4 for Microsoft, producing unified App model.
- Scope risk taxonomy: 65 Google entries, 85 Microsoft entries (including delegated/application differentiation).
- Taxonomy classification engine with per-app tier assignment and unclassified scope surfacing.
- IOC matching engine (BYOIOCDB): local file or URL, Client ID matching, platform-scoped, severity levels.
- First-party vs third-party filter (default: third-party only). Microsoft: appOwnerOrganizationId. Google: Ownership field.
- Six KPI tiles: critical access, stale grants, unused tokens, per-grantor breakdown, chained grants, IOC matches.
- Drill-down table: sortable columns, filterable, IOC/Tier1 row highlighting, expandable scope display.
- CSV export of any filtered drill-down view with taxonomy version for audit reproducibility.
- CEF-formatted security event log (per-session, downloadable on demand).
- Print stylesheet for audit-grade PDF output via browser print.
- Interactive dashboard UI: import panel, IOC banner, controls bar, tile click-through, URL state.

### Changed

- Google `last_used_at` now derived from latest G2 event of any type (authorize, revoke, or activity). Requires wide-date-range G2 export with Activity events. "Unused tokens" tile now covers both platforms.
- Updated performance documentation: tested with ~21,000 G2 event rows, no perceptible delay.

### Known Limitations

- Google domain-wide delegation not detectable from G1/G2 exports (deferred to v1.x).
- Microsoft `AllPrincipals` consent grantor identity shows as "Admin consent" (v1.x).
- M2 user-consent (Principal) path untested against real data (Marc's tenant is admin-consent only).
