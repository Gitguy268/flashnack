# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting form: <https://github.com/Gitguy268/flashnack/security/advisories/new>

Include what you found, how to reproduce it, and the browser and OS you used. You should get a reply within a week. Please give the fix time to ship before you publish details.

## Scope

Flashnack runs entirely in the browser and sends nothing anywhere. The most useful reports are about:

- a crafted DNG, JPEG or zip that runs code, reads other files or hangs the tab for good;
- a zip whose entry names write or read outside what you dropped;
- anything that makes the page send photos or settings to a server;
- the GitHub Actions workflows in this repository.

## Supported versions

Only the latest version on the `main` branch is supported.
