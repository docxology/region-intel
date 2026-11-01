# Security policy

Security fixes target the current main branch and its exact pinned consumers.
Report a suspected vulnerability privately through GitHub's security reporting
facilities when available, or contact the repository owner privately. Include
affected source revisions, a minimal reproduction and redacted evidence.
Never include credentials or personal destination state in public issues.

## Captured provider material

Public HTML fixtures can contain third-party browser configuration. Sanitize
credential-shaped values before committing captures; retain the original only
in appropriately protected local evidence. A sanitized current fixture does not
revoke an exposed value in earlier Git history. Browser configuration alone does
not establish a harmless false positive or prove that provider restrictions exist.

For a secret-scanning alert, establish the value's owner and actual provider
disposition. Only mark revoked after owner/provider evidence; only mark false
positive after validating that classification. Keep unknown validity explicit.
Do not print raw values in logs, reports or review packets. History rewriting and
provider credential changes are separate operations with their own evidence.

The publication preflight checks which bytes Git will ship. It is not a secret
scanner, a revocation check, a legal assessment or a general security certification.
