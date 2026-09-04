# Release procedure

The public product source is `warsclon/harness_config_studio`. Keep development
history and prototypes from the private repository out of this repository.
The current candidate remains `harness-config-studio@0.2.6`; its command is
`harness-config`. An unpublished candidate may be corrected without bumping its
version. Never overwrite an already published npm version.

## Current status

The release workflow is prepared locally. The public repository, remote CI,
private security-reporting form, npm ownership/authentication and actual publication
have not been verified. Do not describe any of these as available merely because
this procedure or a workflow exists.

## Prepare and qualify

1. Commit the final code and documentation. From a clean checkout, run `npm ci`,
   `npm run typecheck`, `npm run build`, and `npm test` on Node 22 and 24. The package
   tests run after the main suite because packaging rebuilds the compiled CLI.
2. Run `npm run package:smoke -- --retain-dir release-artifacts`. The destination
   must be new; successful validation preserves the exact tested tarball and
   `evidence.json`. An uncommitted source tree is recorded as unclean and cannot
   pass release verification. Use a separate output directory for each runtime.
3. Review intended public history and every tarball file for credentials and
   private data, including source maps and documentation. Use a secret scanner
   as an additional check, not a substitute for content review.
4. On macOS, use identified disposable fixtures to verify actual Finder reveal
   and Trash for a file, symbolic link and Managed Skill Directory. Verify that
   link targets survive. Record permission prompts, failures and unexecuted checks.
   Automated package evidence explicitly reports `realFinderTrash: false`.
5. Once public code publication is authorized, create/connect the confirmed public
   repository, push the reviewed history, and observe CI green for the exact commit.
   Enable GitHub Private Vulnerability Reporting, verify the report form, and update
   the pending setup notice in the security policy. Any resulting code/documentation
   commit becomes a new candidate that must be validated.
6. Dispatch **Prepare or publish npm release** on the reviewed workflow revision,
   specifying the full candidate commit and leaving `publish` false. This reuses
   CI on Node 22/24, preserves both tested artifacts and checks their hashes match.
   It neither stages nor publishes a package, nor creates a tag or GitHub Release.
   Download the candidate artifact before its 14-day retention expires.
7. Record package/version, source commit, SHA-256, CI run and the separate manual
   qualification. Do not infer remote CI or real macOS results from the smoke's
   evidence. The verifier checks artifact identity; it is not a substitute for
   maintainer approval of the qualification record.

Locally, verify a retained candidate against its reviewed commit and hash with:

```sh
node scripts/verify-release.mjs release-artifacts FULL_COMMIT APPROVED_SHA256
```

The command prints the verified tarball path or fails. It does not publish. Keep
release evidence outside tracked files: committing evidence after a build would
change the source commit it refers to.

## First npm publication: maintainer setup

- Confirm the logged-in npm identity with `npm whoami` and that the account has
  the right to publish the selected package name. Check name/version availability
  immediately before publishing. A registry E404 is not a reservation or proof of
  ownership; fail closed on authentication or network errors.
- A new package may need its initial authenticated interactive publication before
  its package settings expose Trusted Publisher configuration. Verify npm's current
  account flow; do not publish a placeholder package merely to unlock settings.
- If interactive first publication is required, use `npm login` with the maintainer's
  account and required 2FA, finish the same qualification and explicit approval,
  then pass the verified tarball to `npm publish --access public --ignore-scripts`.
  Do not publish the working directory or rebuild between verification and upload.
  Do not store credentials in the repository, logs or release evidence.
- Once package settings are available, configure a GitHub Trusted Publisher for
  owner `warsclon`, repository `harness_config_studio`, workflow `release.yml`, and
  environment `npm-publish`. Permit direct publication only if that is the selected
  maintainer flow; this workflow does not implement npm staging.
- Create the `npm-publish` GitHub environment with required reviewers and restricted
  deployment branches. Verify those protections before setting the repository
  variable `NPM_PUBLISH_ENABLED` to `true`. Preparation works without that variable;
  a request to publish fails while it is unset.
- The publish job alone receives OIDC write permission. It installs npm 11 on
  Node 24; npm documents OIDC support from npm 11.5.1 and Node 22.14.0. No persistent
  npm write token is part of this workflow. A saved Trusted Publisher configuration
  is not proof that a release can authenticate.

Sources: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
Recheck requirements before first publication because account/registry flows change.

## Publish an approved candidate

1. Obtain maintainer authorization for public source, package version, exact commit
   and qualified SHA-256. Creating a ticket or running preparation does not grant it.
2. For OIDC publication, dispatch the manual release workflow with the same commit,
   `publish` true, and that SHA-256. The flow revalidates both runtimes, requires
   matching artifact bytes, and then waits at the configured environment approval.
   A different build hash requires a new review, not an automatic approval change.
3. Review the qualification evidence before approving the environment. The publish
   job verifies the downloaded, tested Node 24 tarball again and publishes those
   exact bytes with lifecycle scripts disabled. npm rejects version conflicts;
   do not retry by silently choosing a different version.
4. Observe the registry result. On an uncertain result, query that exact version
   before retrying. Download the published tarball and reconcile its bytes/integrity
   with the approved artifact.
5. In a clean environment, use the exact published version through `npx` to check
   version, help, read-only Inventory and web startup against disposable fixtures.
6. Create the version tag and GitHub Release pointing to the published source
   commit; verify all public repository, documentation and support links. Describe
   provenance only if the registry actually provides it.
7. Update public installation availability wording after verification. Documentation
   embedded in the already-published tarball cannot be changed in place; keep its
   candidate wording honest, and ship updated package text in a future version if
   necessary. A repository-only documentation update does not change the release tag.

Report local validation, GitHub CI, public source availability, npm availability
and GitHub Release separately. Do not mark a partially completed release successful.
