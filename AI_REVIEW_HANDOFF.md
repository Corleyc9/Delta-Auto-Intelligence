# Delta Auto Intelligence — AI Review Handoff

This ZIP contains the complete tracked source for the current Delta Auto Intelligence revision.

## Revision

- Git commit: `f7a6e95e4a3eabb6ac6f95501020d6117dc4b368`
- Live application: `https://delta-auto-intelligence.leepjillian1.chatgpt.site`
- Stack: Vinext/React/TypeScript, Cloudflare Worker, D1 database, Windows Python/Playwright reader

## What the system does

- Reads live Tekmetric reports from a Windows shop computer that remains signed in.
- Uses a custom Wednesday-through-Tuesday weekly range.
- Stores weekly, daily, and previous-week snapshots.
- Displays sales, gross profit, labor sales, total ROs, ARO, hours sold per RO, and technician billed hours.
- Tracks technician targets: Stacy 60 hours/week, Mario 20, Mike 40, Beau 40; Devin appears only when he bills hours and has no target.
- Includes a Job Board monitor, ticket auditor, service-writer scorecards, Steer Opportunity Hub leads, and AI question interface.
- Includes the Windows reader and installer under `reader/`.

## Current business rules

- Weekly period: Wednesday through Tuesday.
- Weekly sales goal: $60,000.
- Weekly Hours Sold goal: 175 hours (35-hour daily pace).
- Weekly car-count goal: 60 ROs.
- Daily pace equivalents: $10,000 sales and 12 ROs over five operating weekdays.
- ARO goal: $1,000. Calculation: total sales divided by total ROs.
- Hours/RO goal: 3.00. Calculation: Tekmetric Hours Sold divided by total ROs.
- GP target: 60%; 58–59.9% acceptable; below 58% red.
- Ticket-audit minimum overall GP/hour: $170.
- Diagnostic-test lines are excluded from the GP/hour violation rule, but the overall ticket must still meet the minimum.
- The reader is intended to refresh every two minutes; ticket auditing may take longer.

## Important recent correction

Tekmetric stores report date ranges independently. The reader now reapplies the exact custom date range after opening Technician Hours so the Today view cannot inherit weekly technician hours.

The dashboard now calculates:

- `ARO = totalSales / totalROs`
- `Hours per RO = hoursSold / totalROs`

The Today view uses daily technician targets and daily sales/car-count pace, while weekly projections are shown separately.

## Security boundaries

- No passwords, API keys, machine tokens, or live database contents are included in this ZIP.
- Runtime secrets are supplied through hosted environment variables or local configuration.
- The Tekmetric reader is intended to be read-only.

## Suggested review request

Review this application for calculation errors, stale-data risks, Playwright reliability, data-model problems, security weaknesses, and places where daily/weekly/last-week ranges could be mixed. Pay special attention to `app/page.tsx`, the API routes under `app/api/`, and `reader/reader.py`. Do not assume that a displayed metric is correct merely because it is populated; trace each value from Tekmetric extraction through storage to the UI.
