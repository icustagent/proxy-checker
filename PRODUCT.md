# Product

## Register

product

## Users

Users batch-check free proxy lists for general HTTPS access and AI service reachability. They work with large pasted lists, repeated detection runs, saved repositories, cloud sync, and public deployments, so the interface must stay dense, predictable, protected, and fast to operate.

## Product Purpose

Proxy Checker v5 verifies HTTP, HTTPS, SOCKS4, SOCKS5, and SOCKS5H proxies against a generic target plus optional OpenAI, Grok, Gemini, and Claude profiles. It reports stability, service reachability, API reachability, exit IP, country, IP type, and helps users save, re-check, export, sync, and share usable proxies.

Detection results are deployment-relative. The recommended deployment target is the same server that will actually use the proxies, because a proxy that is reachable from one server may be unreachable from another. The product should explain this clearly instead of implying globally valid proxy quality.

## Brand Personality

Technical, direct, utilitarian. The product should feel like a reliable operations tool, not a landing page or decorative demo.

## Anti-references

Avoid marketing-page composition, decorative cards, oversized hero sections, hidden primary actions, and server-specific defaults that would leak a private deployment into the public GitHub version.

## Design Principles

- Keep repeated workflows one click away.
- Make status and failure reasons visible without extra ceremony.
- Preserve standard controls and predictable button placement.
- Prefer public, portable defaults over private deployment assumptions.
- Keep the UI compact enough for large proxy batches.
- Protect operational actions with a configurable login password while keeping generated repository links usable by other programs.
- On same-origin self-hosted deployments, unauthenticated users should receive only the login page, not the main app shell.
- Treat `config.local.json`, environment variables, logs, repository data, and checked history as deployment-local state.
- Remind users that the meaningful path is their own server to proxy IP to target service.

## Accessibility & Inclusion

Prefer complete, low-friction workflows that do not require manual stitching. Keep actions explicit, labels plain, and controls reachable without relying on hover-only discovery.

## Release Context

v5 is the public GitHub release line. It replaces the old ChatGPT-specific positioning with a general-purpose proxy checking workflow, adds AI service profiles, dynamic proxy source aggregation, repository filters, refresh-safe detection UI, configurable concurrency, and password-protected operations.
