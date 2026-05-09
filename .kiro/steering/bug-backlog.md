# Bug Backlog and Final QA Phase

This file tracks known issues deferred from phase-by-phase feature work and
defines a dedicated final phase for cleanup. It is checked into
`.kiro/steering/` so every Kiro session on this repo honors it.

## Working Rule

- Continue feature development phase by phase.
- Do NOT spend significant time polishing small UI bugs mid-phase unless the
  bug completely blocks the main feature of that phase.
- Log every UI/UX/flow issue you notice into the "Bug Backlog" section below
  instead of fixing it ad-hoc.
- All accumulated items get resolved together in the "Final QA, Bugfix, and
  UX Hardening" phase described at the bottom of this file.

## Bug Backlog

Items are ordered by the phase that introduced them, newest first. When you
notice a new issue, append it here with a short description and the file(s)
or route(s) likely involved. Do not delete entries — mark them `[fixed in PR
#N]` when addressed in the final QA phase so we keep provenance.

### Phase 3 (manual CSV import)

1. `/import` styling may still render inconsistently in some browsers.
   Needs a full visual diff against `/search`, `/dashboard`, `/portfolio`,
   `/heatmap`, `/saved`, `/export`.
2. Drag-and-drop CSV upload needs full browser verification (Chrome, Firefox,
   Safari). Handlers exist in `src/components/import/csv-uploader.tsx` but
   only unit-level reasoning has been done so far.
3. Click-to-upload CSV needs full browser verification (drop-zone click AND
   the "Choose file" button, no double-open of the file dialog).
4. End-to-end manual QA needed for: CSV preview, column-mapping auto-suggest,
   confirm-import persistence, dataset list refresh, search integration
   (verify imported rows actually surface in `/search`).
5. Sidebar/layout consistency must be checked on EVERY dashboard route
   (`/dashboard`, `/search`, `/portfolio`, `/heatmap`, `/saved`, `/export`,
   `/trending`, `/import`, `/settings`) — same navy sidebar, same lavender
   main background, same topbar behavior.
6. Data-quality badges (`DataQualityBadge`, `DataQualityBanner`) must remain
   visible and accurate across all pages and stay in sync with the provider
   selection logic in `src/lib/providers/index.ts`.
7. Export history + "download again" flow (`/export`, `/api/export`,
   `/api/export/history`) needs manual verification.
8. Mobile / responsive behavior needs a full pass: sidebar drawer toggle,
   topbar search, preview table horizontal scroll, drop zone on touch.

Add new backlog items below this line as subsequent phases progress.

## Final Phase: "Final QA, Bugfix, and UX Hardening"

Create a single dedicated PR titled exactly:

> Final QA, Bugfix, and UX Hardening

### Scope (in this order)

1. Manually test every route: `/`, `/auth/*`, `/dashboard`, `/search`,
   `/portfolio`, `/heatmap`, `/saved`, `/export`, `/trending`, `/import`,
   `/settings`.
2. Resolve every open item in the "Bug Backlog" section above. Mark each as
   `[fixed in PR #N]`, do not delete.
3. Fix any remaining styling / layout inconsistencies across dashboard
   routes (sidebar, topbar, page-header, lavender background, card radii).
4. Fix any broken upload / import / export flows surfaced by manual QA.
5. Fix all console errors / warnings / hydration mismatches.
6. Fix mobile + sidebar drawer issues.
7. Verify full behavior of: auth (login, register, forgot/reset), import,
   search, saved, export, dashboard, portfolio, heatmap, trending.
8. Add a small sample CSV under `docs/samples/adobe-stock-sample.csv`
   (or similar) so reviewers can reproduce the import flow deterministically.
9. Update `README.md` with a final "Testing steps" section that walks
   through the sample-CSV import and each page's expected behavior.
10. Keep CI green. Do not disable lints or tests to make this phase pass —
    fix the underlying issues.

### Hard Constraints (still in force)

These restrictions apply to the final phase AND to every phase after it.
Do not relax them without explicit user approval.

- Do NOT add live Adobe scraping.
- Do NOT call private / undocumented Adobe APIs.
- Do NOT add proxy rotation.
- Do NOT add user-agent evasion or any anti-bot circumvention.
- Data sources remain: (a) mock provider, (b) user-imported CSV via
  `manualImportProvider`, (c) the officially-supported Adobe Stock provider
  stub.
