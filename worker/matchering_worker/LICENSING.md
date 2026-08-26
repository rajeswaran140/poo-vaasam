# Licensing — matchering worker

## Matchering: GPL-3.0-or-later

The [`matchering`](https://pypi.org/project/matchering/) library (v2.0.6, dormant
since 2022-10-19) is licensed under **GNU General Public License v3.0 or later
(GPL-3.0-or-later)**. Verified against PyPI on 2026-08-26.

## Why this container exists as a separate boundary

GPL is a **distribution license**. Its source-disclosure obligations trigger when
you distribute GPL-covered code (or a "combined work") to third parties.
TamilAgaval uses this container as an **internal SaaS component** — a private
AWS Lambda that no third party executes. That usage does NOT trigger the
distribution obligations.

To keep it that way, this container is deliberately isolated:

1. **Runs in its own process boundary.** No other TamilAgaval code — Node
   worker, Next.js SSR, admin UI — links or imports Matchering. The Node
   master-worker invokes this Lambda over the AWS API, which is aggregation at
   runtime, not "combined work" under GPL.

2. **This directory contains only Matchering-adjacent code.** The Dockerfile,
   handler, requirements — nothing else. Do NOT co-locate proprietary code
   here.

3. **Container image stored in private ECR.** The image is not shared publicly
   and is not distributed outside AWS.

4. **NOT open-sourced alongside proprietary integration code.** If
   TamilAgaval ever open-sources its stack, this directory needs a compliance
   review before it can be included.

## Hard rules going forward

- **Do NOT** bundle Matchering into any other TamilAgaval Docker image or Lambda
  zip.
- **Do NOT** import Matchering directly from Node/TypeScript code.
- **Do NOT** push this container image to a public registry.
- **Do NOT** open-source this directory without a compliance review.

If TamilAgaval ever offers a distributable form of the mastering system (e.g.
self-hosted), revisit GPL obligations from scratch. At that point either replace
Matchering with a permissively-licensed alternative, or comply fully with GPL
distribution requirements (ship source, preserve license, etc.).

## Full license text

The Matchering source and GPL-3.0 license text are available at
<https://github.com/sergree/matchering>. This container includes an unmodified
copy of Matchering installed via pip; the full license text ships within the
`matchering` package on disk in the container.
