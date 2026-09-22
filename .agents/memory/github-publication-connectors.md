---
name: GitHub publication via connectors
description: Reliable fallback when a healthy Git provider connection does not expose credentials to workspace Git or GitHub CLI.
---

Prefer the standard GitHub connector API when a healthy Git provider connection is unavailable to both workspace Git transport and the connector credential bridge. Throttle Git Data API writes below the connector proxy request limit.

**Why:** A healthy GitHub App connection can still be withheld from the execution context, and connector proxy writes are limited to 10 requests per second. GitHub also rejects Git Data API object creation until an empty repository has an initial commit.

**How to apply:** Create the repository through the standard GitHub connector. If Git transport remains unauthenticated, initialize an empty repository once, recreate and verify exact Git objects through the API at a throttled rate, then point the branch ref to the verified local commit SHA.