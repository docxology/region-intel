# Committed and staged publication preflight

Run these commands in a thin regional consumer, using its frozen shared package.

~~~sh
bun run publication:check
bun run publication:check -- --staged
~~~

The first command checks the current commit. The second checks the actual Git
index before committing. Stage only the intended paths first; this command never
stages, commits, fetches or pushes. It reads no model service or live provider.

The shared method checks the selected deployment, civic/adapter configuration,
package and lock, thin entry point, and required/present optional public seed
files. A consumer-authored manuscript additionally requires successful current
native-packet replay and includes every captured manuscript input and every
declared packet member, including fonts, mathematics, cover and figures.

For each required regular file, its raw Git blob identity must equal the selected
commit/index entry. Binary bytes are hashed without text decoding or line-ending
normalization. Ignored, absent, linked, unmerged or modified required files fail.
The root must be the actual Git checkout, not a directory inside another repo.
Public path membership is bounded, and files and reference listings are reread
to reject observed changes during verification. The result records the exact
file-set and reference-listing SHA-256 commitments.

This addresses the observed MathJax publication failure: an unanchored output/
ignore rule omitted nested output modules even while a local packet validated.
The gate rejects that real Git condition; it does not exempt missing modules.
It uses argument-array Git reads, disables fsmonitor and transport protocols, and
does not create a temporary checkout or inspect the user's private output tree.

## Integration order

1. Validate the consumer and regenerate/inspect any changed native packet.
2. Stage the intended public paths.
3. Run the staged preflight and inspect the staged diff.
4. Commit, then run the committed preflight.
5. Push normally and verify the exact hosted source and native/Pages workflows.

CI runs the committed check immediately after frozen installation. The check
does not establish source semantics, upstream currency, scientific/legal review,
secret revocation, complete Git-object-store integrity, or release authorization.
Public seed semantics still belong to corpus/Pages validators. Rerun preflight
after any further edit, staging operation or reference change.

Optional seed members and the manuscript configuration marker participate when
present in either the working tree or the selected Git reference. Removing a
tracked member locally therefore rejects HEAD and index until its deletion is
staged; a staged deletion can pass the index check while still rejecting HEAD.
Deleting a tracked manuscript marker cannot silently disable packet checking.
