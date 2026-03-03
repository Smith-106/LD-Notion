# Testing Utils

This directory contains unit tests for utility functions in `LinuxDo-Bookmarks-to-Notion.user.js`.

## How it works

The tests run in Node.js. To avoid duplicating code and ensure we are testing the actual production logic, the tests programmatically extract the function bodies from the userscript file.

The `extractGetPageTitle` function in `utils.test.js`:
1. Reads the `LinuxDo-Bookmarks-to-Notion.user.js` file.
2. Uses a regular expression to locate the start of the `getPageTitle` function.
3. Uses brace counting to find the end of the function body.
4. Validates that the extracted code contains expected logic patterns (e.g., loops and return statements).
5. Uses `new Function()` to create a testable version of the function.

## Why this approach?

- **No Duplication:** We don't have to maintain two versions of the same logic.
- **Production-Ready:** Tests run against the exact code that will be used by users.
- **Self-Validating:** The extraction logic fails if the userscript structure changes significantly, alerting developers to update the tests or extraction mechanism.

## Running tests

Run the following command from the project root:

```bash
npm test
```
