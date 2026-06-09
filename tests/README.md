# Test Suite

This directory contains the Node-based regression tests for `LinuxDo-Bookmarks-to-Notion.user.js`.

## Verification model

- `npm test` runs `tests/utils.test.js`、`tests/logic-modules.test.js` and `tests/notion-oauth.test.js`.
- All three test files read the production userscript, reuse the same extraction seam as `scripts/build-extension.js`, and execute the current core in a sandbox with `new Function()`.
- This is intentional: the tests are tied to the shipped userscript, so they catch both behavior regressions and source-shape changes that would break the existing harness or build pipeline.

### Verification layers

- Automated invariants
  - `npm run verify:baseline`
  - `npm run verify:extension:bounded` for the optional bounded-host manifest smoke
  - `npm run verify:bridge-extension` for the runtime bookmark-bridge boundary smoke
  - `npm run build:extension` when the change affects the default extension delivery artifact
- Manual runtime smoke
  - `docs/ui-regression-checklist.md`
  - This checklist is the current runtime smoke source of truth in the repository

The current runtime story should be read consistently as:

- automated invariants prove code shape and key behavior seams
- manual smoke proves real host/runtime behavior across Linux.do, Notion, generic webpage, and `chrome-extension-full`

## Current coverage

- `utils.test.js`
  - `Utils.getPageTitle`
  - `Utils.extractNotionId`
  - `Utils.extractQuotedText`
  - `Utils.extractQuotedTexts`
- `logic-modules.test.js`
  - `OperationGuard` permission and danger-level helpers
  - `OperationLog` redaction hints and structured audit normalization
- `notion-oauth.test.js`
  - Notion OAuth callback handling, failure notice flow, manual fallback, and 401 refresh retry
  - `TargetState` behavior for AI target vs export target separation
  - `quickParseIntent` positive and negative coverage for page / block / comment / database phrasing
  - structured `assistant_result v1` / tool output normalization
  - selected `AGENT_TOOLS` structured output behavior
  - `scripts/build-extension.js` source anchors, generated-asset builder seams, manifest profile resolution, runtime bridge boundary assumptions, and smoke build against the current userscript shape
  - stable welcome chips / help entry points and key selector semantics used by the UI integration follow-up

## Running tests

From the project root:

```bash
npm test
npm run verify:baseline
npm run verify:extension:bounded
npm run verify:bridge-extension
npm run build:extension
# one-shot delivery gate
npm run verify:delivery
```
