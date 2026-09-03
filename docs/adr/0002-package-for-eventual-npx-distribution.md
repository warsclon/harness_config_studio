# Package compiled JavaScript for npm and npx distribution

The product was developed privately through v0 and v1. Its public distribution
shape is an installable Node.js CLI that can run through `npx`, following the
distribution model already proven by openspec-viewer. Keeping packaging as a
first-class constraint avoids a checkout-only tool that must be redesigned
before release.

The source is TypeScript, but the package exposes compiled ESM JavaScript from
`dist/`. Runtime support starts with Node.js 22 and 24, and the application has
no production dependencies. V1 keeps that boundary by using a native text
editor rather than shipping a rich editor runtime. This avoids relying on direct
TypeScript execution inside `node_modules` and keeps installation predictable.
