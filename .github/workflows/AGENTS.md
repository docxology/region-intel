# Shared platform workflows

`core.yml` runs the complete shared gate on main pushes and pull requests using
Bun 1.4.2, frozen dependencies and separately installed Chromium.
`pr-gate.yml` retains the reference application's broader browser acceptance.
`pages.yml` and `weekly.yml` are manually invoked compatibility workflow examples;
their collection jobs are repository-guarded to Crescent City and do not publish
from the shared repository. Operational workflows live in the thin consumers.

Both release-gate modes parse all workflow YAML. `bun run validate -- --only=contracts`
prints omitted checks and is not a full gate. No local check establishes hosted
execution. Never add a shared workflow that deploys a consumer's hostname.

The shared gate captures complete stdout/stderr to the runner temporary directory,
prints it and exits with the original gate status. A seven-day artifact retains
those bytes on both success and failure. Keep the Bun pin, denominators, timeout
and coverage floor unchanged when adding diagnostics. A truncated hosted log is
not evidence of a passing suite.
