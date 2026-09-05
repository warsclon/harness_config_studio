# Public presentation and demo

The [public presentation and read-only demo](https://warsclon.github.io/harness_config_studio/)
are deployed on GitHub Pages. Initial deployment and browser verification completed
on 2026-09-05. The npm release remains a separate, pending phase.

## Build and preview

```sh
npm ci
npx playwright install chromium
npm run site:check
npm run site:preview
```

Open the loopback URL printed by the preview command. Stop it with Ctrl+C.
`site:build` generates `_site/`, which is ignored by Git. The build copies only
the landing page, generated demo and three media files. Relative URLs work at the
repository Pages prefix. The landing page adapts to mobile; the actual application
and its demo retain their desktop layout.

`site/fixture.json` contains fictional Inventory and readable artifacts with stable
paths under `/demo/`. The demo reuses `renderWebShell` through an explicit read-only
adapter. No server or filesystem access is needed in the deployed page, the CSP
blocks connections, and unavailable native actions are omitted. Refresh returns the
same fixture. Nothing persists across reloads. Fixtures are public examples, never
snapshots of personal configuration.

## Refresh the media

Install FFmpeg separately as a maintainer tool, then run:

```sh
npm run capture:media
npm run site:check
```

Playwright captures `docs/media/hero.png`, `workspace.png` and a 12-second
`workflow.gif` from the same demo. The GIF has four scenes held for three seconds
each. The landing page offers the animation on demand and a still-image alternative.
Review and commit refreshed media whenever the relevant interface changes.
FFmpeg is not an npm dependency and is not required for installation or CI checks.

The npm allowlist excludes `site/`, scripts and media. README images use absolute
URLs to the public repository so npm does not need to bundle large media. Publish
and verify those source URLs before announcing the npm package.

## Deploy after source publication is approved

1. Publish the reviewed source to the confirmed public repository.
2. In repository Settings → Pages, select GitHub Actions as the source. Configure
   the `github-pages` environment and restrict deployment to the reviewed branch;
   add required reviewers if that is the selected maintainer policy.
3. Run **Publish presentation to GitHub Pages** on that reviewed branch/commit.
   This workflow is manual-only; ordinary pushes do not deploy the website.
4. Observe the validation and deployment jobs, then verify the returned URL,
   navigation, media, read-only behavior and browser console on the live site.
5. Keep the README and this document aligned with verified availability. A
   documentation change becomes a new npm release candidate and must be qualified
   accordingly. Site deployment never publishes to npm.

GitHub's maintained actions document the [Pages artifact format](https://github.com/actions/upload-pages-artifact)
and [deployment permissions and environment](https://github.com/actions/deploy-pages).
Verify the Actions result and the live site after every deployment.
