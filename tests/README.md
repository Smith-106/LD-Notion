# Test Suite

This directory contains the Node-based regression tests for `LinuxDo-Bookmarks-to-Notion.user.js`.

## Verification model

- `npm test` runs `tests/utils.test.js` and `tests/notion-oauth.test.js`.
- Both test files read the production userscript, strip the userscript header and IIFE wrapper, and execute the current core in a sandbox with `new Function()`.
- This is intentional: the tests are tied to the shipped userscript, so they catch both behavior regressions and source-shape changes that would break the existing harness or build pipeline.

## Current coverage

- `utils.test.js`
  - `Utils.getPageTitle`
  - `Utils.extractNotionId`
  - `Utils.extractQuotedText`
  - `Utils.extractQuotedTexts`
- `notion-oauth.test.js`
  - Notion OAuth callback handling, failure notice flow, manual fallback, and 401 refresh retry
  - `TargetState` behavior for AI target vs export target separation
  - `quickParseIntent` positive and negative coverage for page / block / comment / database phrasing
  - structured `assistant_result v1` / tool output normalization
  - selected `AGENT_TOOLS` structured output behavior
  - `scripts/build-extension.js` smoke build against the current userscript shape

## Running tests

From the project root:

```bash
npm test
node --check LinuxDo-Bookmarks-to-Notion.user.js
```
