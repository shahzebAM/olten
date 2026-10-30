# Employee details dialog scroll repair — 30 October 2026

## Problem and change

The Employee Details & Pay Setup dialog clipped fields below the visible area. Its form and native fieldset retained their minimum content size inside a height-limited flex dialog, preventing the intended inner scroll area from shrinking. The fixed footer covered the remaining fields.

The screen-only payroll stylesheet now gives the dialog an explicit viewport-relative height, allows its form and fieldset to shrink, and keeps a visible native vertical scrollbar on the fieldset. The title and Save/Cancel footer remain stationary. Desktop, mobile and short landscape viewport limits are respected.

No application handlers, payroll formulas, employee data, saved payrolls, database schema or print templates change in this repair. In particular, this layout repair does not establish a match with the unexplained Sunday amount in the customer's Excel screenshot.

## Verification

- Reproduced the original failure using the stylesheet from commit `ee8d0ac` with the current real PayrollModule: wheel and programmatic scrolling stayed at zero and the daily-rate field remained clipped in all three viewports.
- Checked the repaired real PayrollModule in fresh Chromium contexts at 1440 × 900, 390 × 844 and 844 × 390. Mouse-wheel scrolling reached the daily rate, expanded advanced fields remained scrollable, header/footer positions stayed fixed, and Save passed an actionability trial without submission. Cancel and Close worked.
- Confirmed a visible 10-pixel native scrollbar gutter in the local Chrome run with its headless scrollbar-hiding flag removed. Browser errors, API errors, external requests and mutating API requests were all zero. Test employee/API data was synthetic.
- Frontend TypeScript and production build passed. All 92 frontend tests passed, including protected payroll calculation and print-template checks. The existing PayrollModule lint comparison found no newly introduced diagnostics; its legacy diagnostics remain outside this CSS repair.
- The portable browser regression script passed Node syntax and Git whitespace checks. Private screenshots/reports stay outside the repository.

## Repeating the browser regression

From the repository root, run `node frontend/scripts/verify-payroll-dialog-scroll.mjs --mode post`. The script uses the existing frontend dependencies and an existing Playwright installation; if Playwright is not locally resolvable, set `PLAYWRIGHT_MODULE_DIR` to its package directory. Chrome must be available. No packages are installed.

The default output/cache directory is a fresh operating-system Temp directory. Set `PAYROLL_SCROLL_REQUIRE_GUTTER=1` to additionally require a native gutter on the browser/platform under test. To reproduce the pre-fix behavior, use `--mode pre --baseline ee8d0ac`. The fixture binds an ephemeral localhost port and rejects all API writes.

## Release

Deploy the matching frontend through the existing GitHub deployment pipeline. No migration or data repair is required. Users should refresh the page to load the updated stylesheet. Rollback is a revert of this layout commit.
