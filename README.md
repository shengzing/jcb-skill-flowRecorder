# jcb-skill-flowRecorder

Semi-automatic website flow recorder for Codex.

Author: Chengbin Jia

`jcb-skill-flowRecorder` records a site's real menu navigation path while you click through it manually in a visible browser. It captures rendered pages, screenshots, downloaded resources, and `fetch` / `xhr` traffic so the session can later be turned into navigation maps, Mermaid diagrams, and backend interface inventories.

It is designed for cases where you need more than a simple sitemap. The skill helps you:

- record menu-to-page navigation paths
- capture full-page screenshots
- save rendered HTML after client-side loading
- persist downloaded page resources
- inspect `fetch` / `xhr` API calls
- summarize the captured output into flow diagrams and interface inventories

This skill works especially well for:

- marketing sites
- documentation portals
- login-gated cloud consoles
- reverse-engineering UI flows into page maps and backend service boundaries

## Quick Start

Install this skill into your local Codex skills directory, then run:

```bash
node /Users/jcb/.codex/skills/jcb-skill-flowRecorder/scripts/record-menu-flow.mjs https://example.com
```

Typical flow:

1. Open the target site in a visible browser.
2. Log in manually if needed.
3. Return to the terminal and press Enter to start recording.
4. Click menus and links manually in the browser.
5. Press `Ctrl+C` to stop and save the session.

## What This Skill Includes

```text
jcb-skill-flowRecorder/
  SKILL.md
  README.md
  README.zh-CN.md
  agents/openai.yaml
  scripts/record-menu-flow.mjs
  references/output-format.md
```

## Included Files

- `SKILL.md`: skill entrypoint and usage guidance for Codex
- `agents/openai.yaml`: display metadata for compatible agent surfaces
- `scripts/record-menu-flow.mjs`: the actual recorder script
- `references/output-format.md`: output schema and interpretation notes
- `README.md` and `README.zh-CN.md`: release-facing documentation

## Requirements

- Node.js
- `playwright`
- a Playwright browser runtime, usually Chromium

Install dependencies if needed:

```bash
npm install -D playwright
npx playwright install chromium
```

## Installation

This directory can be published as a standalone skill folder.

Typical local installation shape:

```text
~/.codex/skills/jcb-skill-flowRecorder/
  SKILL.md
  README.md
  README.zh-CN.md
  agents/
  scripts/
  references/
```

If you distribute it as a repository or archive, keep the folder structure unchanged so the relative paths referenced by `SKILL.md` remain valid.

## How To Run

From a workspace that has this skill installed:

```bash
node /Users/jcb/.codex/skills/jcb-skill-flowRecorder/scripts/record-menu-flow.mjs https://example.com
```

Write output to a specific directory:

```bash
node /Users/jcb/.codex/skills/jcb-skill-flowRecorder/scripts/record-menu-flow.mjs https://example.com --output docs/menu-flow
```

Capture full request and response samples without redaction:

```bash
node /Users/jcb/.codex/skills/jcb-skill-flowRecorder/scripts/record-menu-flow.mjs https://example.com --include-sensitive
```

The script defaults to headed mode and writes output to `tools/menu-flow-output` unless `--output` is specified.

## Typical Workflow

1. Start the script with a target URL.
2. A visible browser opens.
3. Log in manually if the target site requires authentication.
4. Return to the terminal and press Enter to start recording.
5. Click the menus manually in the browser.
6. Stop the session with `Ctrl+C`.
7. Review the generated files.

## Output Structure

Example output:

```text
docs/menu-flow/
  navigation-log.json
  navigation-map.csv
  navigation-flow.md
  captures/
    <capture_id>/
      screenshot.png
      page.html
      network.json
      api-calls.json
      resources/
```

See [references/output-format.md](./references/output-format.md) for field-level details.

## Recommended Publishing Positioning

This skill is best presented as:

- a semi-automatic website flow recorder
- a documentation and reverse-mapping capture tool
- a safe local recorder with redaction enabled by default
- a companion utility for page inventory, API inventory, and information architecture work

## Recommended Analysis Workflow

When analyzing captured data:

1. Start with `navigation-log.json`
2. Deduplicate edges by `(source_url, clicked_text, target_url)`
3. Generate a human-readable Mermaid diagram
4. Separate business APIs from telemetry and frontend transport
5. Group backend endpoints by service prefix such as:
   - `iam-server`
   - `walletd-server`
   - `biz-server`
   - `api-server`
   - `panel-server`
   - `account-server`

## Privacy And Safety

- Default mode should be treated as safer because common sensitive fields are redacted.
- `--include-sensitive` should only be used in a trusted local environment.
- Do not publish raw captures containing tokens, cookies, phone numbers, email addresses, or private business data.
- Only use this skill on sites and accounts where you are authorized to record traffic and content.

## Limitations

- Best suited for semi-automatic capture, not full autonomous crawling.
- Some SPA transitions may not be perfectly captured if they do not produce a clear click-to-route change.
- Some responses may be frontend transport payloads such as `_rsc` streams instead of normal business JSON.
- Output only reflects pages and APIs actually visited during the recorded session.

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md).

## License

Released under the [MIT License](./LICENSE).
