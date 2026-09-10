import { fetchJson, nodeUrl, printJson } from "../client";
import type { NodeInfo } from "../types";

const TEMPLATE = `# Routstr Node Agent Instructions

## Identity
You are interacting with a Routstr node — a payment proxy for permissionless AI inference.
Node: {name} — {description}

## Connection
- Node URL: {node_url}
- API: OpenAI-compatible (POST /v1/chat/completions)
- Payment: Cashu ecash tokens, Lightning Network

## Two ways to use this node

### A) HTTP API (any client, no install)
Inference + balance + node info — no admin token needed.

### B) Routstr CLI (recommended for ops & batch tasks)
Lightweight TS CLI for inspecting and configuring the node, including admin tasks
(providers, models, wallet withdrawals, config). Install:
\`\`\`
cd cli && bun install
alias routstr="bun run $(pwd)/cli/src/index.ts"
routstr init --node-url {node_url} --token <admin-session-token>
\`\`\`
Run \`routstr schema\` for the full machine-readable command tree, or \`routstr <cmd> --help\`.

---

## HTTP API — Inference

### Check Available Models
\`\`\`
GET {node_url}/v1/models
\`\`\`
Returns models with pricing (per-token USD in \`pricing\`, per-token sats in \`sats_pricing\`).

### Check Balance
\`\`\`
GET {node_url}/v1/balance
Headers: Authorization: Bearer <api_key>
\`\`\`

### Make an Inference Request
\`\`\`
POST {node_url}/v1/chat/completions
Headers:
  Authorization: Bearer <cashu_token_or_api_key>
  Content-Type: application/json
Body: {"model": "<model_id>", "messages": [{"role": "user", "content": "..."}]}
\`\`\`
Standard OpenAI chat completion. Supports \`"stream": true\`. Also supports
\`POST /v1/responses\` (OpenAI Responses API).

### Node Info
\`\`\`
GET {node_url}/v1/info
\`\`\`

## Payment Flow
1. Obtain Cashu tokens from a supported mint: {mints}
2. Include token in Authorization header: \`Bearer <cashu_token>\`
3. Node deducts cost based on model pricing and token usage
4. Change (remaining balance) returned via x-cashu response header

## Error Codes
- 402: Insufficient payment / balance
- 429: Rate limited
- 503: No upstream provider available
- 500: Upstream provider error (details in response body)

---

## CLI command map (use this as the source of truth)

Global flags (apply to every command):
- \`-n, --node <url>\`     — override node URL
- \`-o, --output <fmt>\`    — \`text\` (default) or \`json\` for machine parsing
- \`-q, --quiet\`           — suppress non-essential output
- \`--no-input\`            — agent mode (never prompt)

### Auth & config
- \`routstr init --node-url <url> --token <admin-token>\` — save to ~/.routstr/config.json
- \`routstr init --show\` — print current config
- \`routstr status\` — node health, version
- \`routstr config show\` — full node settings (admin-redacted)
- \`routstr config get <key>\` — single setting
- \`routstr config set <key> <value> -t <admin>\` — write a setting

### Models (read-only public view)
- \`routstr models list [--provider <name>]\` — pricing for all enabled models

### Providers (admin-only)
Provider refs accept either numeric ID or stable slug. Prefer slugs in automation.
- \`routstr providers list -t <admin>\` — upstream providers, including stable \`slug\`
- \`routstr providers show <provider> -t <admin>\` — full provider details by ID or slug
- \`routstr providers add <type> --base-url <url> --api-key <key> [--slug <slug>] -t <admin>\`
- \`routstr providers update <provider> [--type|--base-url|--api-key|--api-version|--enabled <bool>|--fee <mult>|--settings <json>|--slug <slug>] -t <admin>\`
- \`routstr providers enable <provider> -t <admin>\` / \`disable <provider>\`
- \`routstr providers remove <provider> -t <admin>\`
- \`routstr providers test <provider> -t <admin>\` — health-check upstream

### Provider models (per-model edits scoped to a provider; admin-only)
Use the provider slug from \`routstr providers list -t <admin> -o json\` as \`<provider>\` when possible.
- \`routstr providers models list <provider> [--source all|db|remote] -t <admin>\` — DB + upstream-discovered models
- \`routstr providers models show <provider> <model_id> -t <admin>\` — full model detail
- \`routstr providers models update <provider> <model_id> [--forwarded-model-id <id>|--enabled <bool>|--name|--description|PRICE_FLAGS] -t <admin>\`

#### Pricing (admin-only)
All price flags are USD and interpreted per-token by default. Pass \`--price-unit per-1m\`
to enter human-friendly per-million prices instead (the CLI divides by 1e6).
Flags: \`--prompt\`, \`--completion\`, \`--request\`, \`--image\`, \`--web-search\`,
\`--internal-reasoning\`, \`--input-cache-read\`, \`--input-cache-write\`,
\`--max-prompt-cost\`, \`--max-completion-cost\`, \`--max-cost\`.
For anything exotic, \`--pricing '<json>'\` merges arbitrary pricing keys over the current
pricing object. Sats pricing (\`sats_pricing\`) is derived server-side from USD pricing;
set USD and re-read the model to confirm.

Pricing examples:
\`\`\`
# $0.15 / 1M input, $0.60 / 1M output, cache read $0.003 / 1M
routstr providers models update <provider> <model_id> --price-unit per-1m \\
  --prompt 0.15 --completion 0.60 --input-cache-read 0.003 -t <admin>

# exact per-token values, plus a raw JSON override
routstr providers models update <provider> <model_id> \\
  --prompt 1.5e-7 --completion 6e-7 --pricing '{"request":0.001}' -t <admin>
\`\`\`

Batch update example (loop over ids):
\`\`\`
routstr providers models list <provider-slug> --source db -o json -t <admin> \\
  | jq -r '.db_models[].id' \\
  | xargs -I{} routstr providers models update <provider-slug> {} --forwarded-model-id {} -t <admin>
\`\`\`

### Wallet
- \`routstr wallet balance -k <api_key>\` — current balance for an API key
- \`routstr wallet send <amount> -m <mint_url> -t <admin>\` — withdraw as Cashu token
- \`routstr wallet receive\` — supported mints

### Discovery (for agents)
- \`routstr instruct [--format text|json|openai]\` — this document
- \`routstr schema\` — full command tree as JSON
- \`<any cmd> --help\` — per-command help

### Operating the node
- \`routstr serve [-h <host>] [-p <port>] [-w <workers>] [--reload]\` — start FastAPI server
- \`routstr monitor [-r <secs>]\` — TUI dashboard (providers, models, requests)

## Tips for agents
- Always pair admin commands with \`-t <admin-token>\` or pre-run \`routstr init --token <…>\`
- Use \`-o json\` everywhere for parsing; status code is non-zero on error
- Use \`routstr schema\` to discover commands without parsing this prose
- Discover model ids from \`routstr models list -o json\` (public) or \`routstr providers models list <pid> -o json\` (admin, includes disabled and remote)
- For batch model edits, iterate ids client-side — the API expects per-model PATCH/POST
`;

function fillTemplate(name: string, description: string, url: string, mints: string): string {
  return TEMPLATE.replaceAll("{name}", name)
    .replaceAll("{description}", description)
    .replaceAll("{node_url}", url)
    .replaceAll("{mints}", mints);
}

export async function instructCommand(opts: { format?: string }): Promise<void> {
  const info = await fetchJson<NodeInfo>("/v1/info");
  const name = info?.name ?? "Routstr Node";
  const description = info?.description ?? "A Routstr Node";
  const mints = info?.mints ?? [];
  const url = nodeUrl();

  const text = fillTemplate(
    name,
    description,
    url,
    mints.length ? mints.join(", ") : "none configured",
  );

  const format = opts.format ?? "text";

  if (format === "json") {
    printJson({ instruction: text, node_url: url, name, description, mints });
  } else if (format === "openai") {
    printJson({ role: "system", content: text });
  } else {
    console.log(text);
  }
}
