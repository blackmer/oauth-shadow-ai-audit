# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Known Limitations

- Google `last_used_at` not derivable from G2 (consent events only). Under investigation.
- Google domain-wide delegation not detectable from G1/G2 exports (deferred to v1.x).
- Microsoft `AllPrincipals` consent grantor identity shows as "Admin consent" (v1.x).
- M2 user-consent (Principal) path untested against real data (Marc's tenant is admin-consent only).
