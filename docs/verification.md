# Client verification records (PRD §6.3-1 / §6.3-6b)

| Gate | Status | Record |
| ---- | ------ | ------ |
| Timed onboarding (Claude Code, fresh machine, <10 min) | ⏳ PENDING — needs a live WP + Etch install | protocol: clock starts at README open, stops at first successful etch_status |
| Claude Desktop config verified (same machine) | ⏳ PENDING | config block in README §3 |
| OpenCode config | documented best-effort (README §3) | — |
| OpenAI Agents SDK config | documented best-effort (README §3) | — |
| CI pack/handshake matrix (Node 20/22) | ✅ automated — release.yml pack-test job | local run 2026-06-12: handshake OK, 20 tools |
| Canonical demo (§6.3-2) | ⏳ PENDING — needs a live builder tab | prompt + pass checks in README §4 |

Run the pending gates against a live Etch install and record (date, OS, elapsed time) here before tagging v1.0.0.
