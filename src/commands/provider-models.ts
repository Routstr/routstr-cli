import {
  authHeaders,
  fetchJson,
  nodeUrl,
  printError,
  printInfo,
  printSuccess,
  printTable,
  render,
  resolveToken,
} from "../client";
import type { Pricing } from "../types";

interface AdminModel {
  id: string;
  name: string;
  description: string;
  created: number;
  context_length: number;
  architecture: Record<string, unknown>;
  pricing: Record<string, unknown>;
  per_request_limits: Record<string, unknown> | null;
  top_provider: Record<string, unknown> | null;
  upstream_provider_id: number | null;
  canonical_slug: string | null;
  alias_ids: string[] | null;
  enabled: boolean;
  forwarded_model_id: string | null;
  sats_pricing?: Record<string, unknown> | null;
}

function parseBool(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  throw new Error(`Invalid boolean: ${value} (use true/false)`);
}

interface ProviderModelsResponse {
  provider: { id: number; slug?: string | null; provider_type: string; base_url: string };
  db_models: AdminModel[];
  remote_models: AdminModel[];
}

interface ListOptions {
  adminToken?: string;
  source?: "all" | "db" | "remote";
}

export async function providerModelsListCommand(
  providerId: string,
  opts: ListOptions,
): Promise<void> {
  const token = resolveToken(opts.adminToken);
  const headers = authHeaders(token);

  const data = await fetchJson<ProviderModelsResponse>(
    `/admin/api/upstream-providers/${encodeURIComponent(providerId)}/models`,
    { headers },
  );
  if (!data) process.exit(1);

  const source = opts.source ?? "all";

  render(data, (d) => {
    const dbItems = source === "remote" ? [] : (d.db_models ?? []);
    const remoteItems = source === "db" ? [] : (d.remote_models ?? []);

    const rows: string[][] = [];
    for (const m of dbItems) {
      rows.push([
        m.id,
        "db",
        m.enabled ? "yes" : "no",
        String(m.forwarded_model_id ?? m.id),
        m.name ?? "",
      ]);
    }
    for (const m of remoteItems) {
      rows.push([m.id, "remote", "—", "—", m.name ?? ""]);
    }

    const providerLabel = d.provider.slug ?? `#${d.provider.id}`;

    if (!rows.length) {
      printInfo(`No models for provider ${providerLabel} (source=${source}).`);
      return;
    }

    printTable(
      `Models for provider ${providerLabel} — ${d.provider.provider_type} (${rows.length})`,
      ["ID", "Source", "Enabled", "Forwarded ID", "Name"],
      rows,
    );
    printInfo(
      `db=${d.db_models?.length ?? 0}, remote-only=${d.remote_models?.length ?? 0}. Use 'providers models update <pid> <id>' to edit DB models.`,
    );
  });
}

export async function providerModelsShowCommand(
  providerId: string,
  modelId: string,
  opts: { adminToken?: string },
): Promise<void> {
  const token = resolveToken(opts.adminToken);
  const headers = authHeaders(token);

  const data = await fetchJson<AdminModel>(
    `/admin/api/upstream-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(
      modelId,
    )}`,
    { headers },
  );
  if (!data) process.exit(1);

  render(data, (m) => {
    printInfo(`\x1b[1mModel ${m.id}\x1b[0m (provider #${m.upstream_provider_id})`);
    printInfo(`  Name:               ${m.name}`);
    printInfo(`  Enabled:            ${m.enabled ? "yes" : "no"}`);
    printInfo(`  Forwarded model ID: ${m.forwarded_model_id ?? m.id}`);
    printInfo(`  Context length:     ${m.context_length}`);
    if (m.canonical_slug) printInfo(`  Canonical slug:     ${m.canonical_slug}`);
    if (m.alias_ids?.length) printInfo(`  Aliases:            ${m.alias_ids.join(", ")}`);

    const pricing = m.pricing ?? {};
    const priceKeys = Object.keys(pricing);
    if (priceKeys.length) {
      printInfo("  Pricing (USD/token):");
      for (const [k, v] of Object.entries(pricing)) {
        printInfo(`    ${k.padEnd(20)} ${v}`);
      }
    }
    const satsPricing = m.sats_pricing ?? {};
    if (Object.keys(satsPricing).length) {
      printInfo("  Pricing (sats/token, derived):");
      for (const [k, v] of Object.entries(satsPricing)) {
        printInfo(`    ${k.padEnd(20)} ${v}`);
      }
    }
  });
}

type PriceUnit = "per-token" | "per-1m";

interface UpdateModelOptions {
  adminToken?: string;
  forwardedModelId?: string;
  enabled?: string;
  name?: string;
  description?: string;
  // USD pricing fields (per token by default; see --price-unit)
  prompt?: string;
  completion?: string;
  request?: string;
  image?: string;
  webSearch?: string;
  internalReasoning?: string;
  inputCacheRead?: string;
  inputCacheWrite?: string;
  maxPromptCost?: string;
  maxCompletionCost?: string;
  maxCost?: string;
  // Advanced: raw JSON pricing object, merged over the current pricing
  pricing?: string;
  priceUnit?: string;
}

const PRICING_FIELDS: Array<{ option: keyof UpdateModelOptions; key: keyof Pricing }> = [
  { option: "prompt", key: "prompt" },
  { option: "completion", key: "completion" },
  { option: "request", key: "request" },
  { option: "image", key: "image" },
  { option: "webSearch", key: "web_search" },
  { option: "internalReasoning", key: "internal_reasoning" },
  { option: "inputCacheRead", key: "input_cache_read" },
  { option: "inputCacheWrite", key: "input_cache_write" },
  { option: "maxPromptCost", key: "max_prompt_cost" },
  { option: "maxCompletionCost", key: "max_completion_cost" },
  { option: "maxCost", key: "max_cost" },
];

const PRICE_UNITS: PriceUnit[] = ["per-token", "per-1m"];

function parsePrice(raw: string, key: string, unit: PriceUnit): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    printError(`Invalid --${key.replace(/_/g, "-")}: ${raw} (must be a non-negative number)`);
    process.exit(1);
  }
  return unit === "per-1m" ? value / 1_000_000 : value;
}

function buildPricing(
  current: Record<string, unknown>,
  opts: UpdateModelOptions,
): Record<string, unknown> {
  let pricing: Record<string, unknown> = { ...current };

  if (opts.pricing !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(opts.pricing);
    } catch (e: unknown) {
      printError(`Invalid --pricing JSON: ${String(e)}`);
      process.exit(1);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      printError("Invalid --pricing: must be a JSON object of pricing fields.");
      process.exit(1);
    }
    pricing = { ...pricing, ...(parsed as Record<string, unknown>) };
  }

  const unit = (opts.priceUnit ?? "per-token") as PriceUnit;
  if (!PRICE_UNITS.includes(unit)) {
    printError(`Invalid --price-unit: ${opts.priceUnit} (use per-token or per-1m)`);
    process.exit(1);
  }

  for (const { option, key } of PRICING_FIELDS) {
    const raw = opts[option] as string | undefined;
    if (raw !== undefined) pricing[key] = parsePrice(raw, key, unit);
  }

  return pricing;
}

export async function providerModelsUpdateCommand(
  providerId: string,
  modelId: string,
  opts: UpdateModelOptions,
): Promise<void> {
  const hasPricingField =
    opts.pricing !== undefined || PRICING_FIELDS.some(({ option }) => opts[option] !== undefined);
  const hasField =
    opts.forwardedModelId !== undefined ||
    opts.enabled !== undefined ||
    opts.name !== undefined ||
    opts.description !== undefined ||
    hasPricingField;
  if (!hasField) {
    printError(
      "No fields to update. Pass one of: --forwarded-model-id, --enabled, --name, --description, --pricing <json>, or a price flag (--prompt, --completion, --request, --image, --web-search, --internal-reasoning, --input-cache-read, --input-cache-write, --max-prompt-cost, --max-completion-cost, --max-cost).",
    );
    process.exit(1);
  }

  const token = resolveToken(opts.adminToken);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(token),
  };

  const current = await fetchJson<AdminModel>(
    `/admin/api/upstream-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(
      modelId,
    )}`,
    { headers: authHeaders(token) },
  );
  if (!current) process.exit(1);

  const merged = {
    id: current.id,
    name: opts.name ?? current.name,
    description: opts.description ?? current.description,
    created: current.created,
    context_length: current.context_length,
    architecture: current.architecture,
    pricing: buildPricing(current.pricing ?? {}, opts),
    per_request_limits: current.per_request_limits,
    top_provider: current.top_provider,
    upstream_provider_id: current.upstream_provider_id,
    canonical_slug: current.canonical_slug,
    alias_ids: current.alias_ids,
    enabled: opts.enabled !== undefined ? parseBoolOrExit(opts.enabled) : current.enabled,
    forwarded_model_id:
      opts.forwardedModelId !== undefined
        ? opts.forwardedModelId || current.id
        : (current.forwarded_model_id ?? current.id),
  };

  const url = `${nodeUrl()}/admin/api/upstream-providers/${encodeURIComponent(providerId)}/models`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(merged),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const text = await resp.text();
      printError(`${resp.status}: ${text}`);
      process.exit(1);
    }
    const data = await resp.json();
    render(data, () => printSuccess(`Model "${modelId}" updated.`));
  } catch (e: unknown) {
    printError(String(e));
    process.exit(1);
  }
}

function parseBoolOrExit(value: string): boolean {
  try {
    return parseBool(value);
  } catch (e: unknown) {
    printError(String(e));
    process.exit(1);
  }
}
