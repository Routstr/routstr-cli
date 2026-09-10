#!/usr/bin/env bun

import { Command } from "commander";
import { setGlobalOptions } from "./client";
import { initCommand, showInitCommand } from "./commands/auth";
import { configGetCommand, configSetCommand, configShowCommand } from "./commands/config";
import { instructCommand } from "./commands/instruct";
import { modelsListCommand } from "./commands/models";
import {
  providerModelsListCommand,
  providerModelsShowCommand,
  providerModelsUpdateCommand,
} from "./commands/provider-models";
import {
  providersAddCommand,
  providersDisableCommand,
  providersEnableCommand,
  providersListCommand,
  providersRemoveCommand,
  providersShowCommand,
  providersTestCommand,
  providersUpdateCommand,
} from "./commands/providers";
import { schemaCommand } from "./commands/schema";
import { statusCommand } from "./commands/status";
import { getNodeUrl } from "./config";
import { startMonitor } from "./tui/app";

const program = new Command();

// Resolve node URL: --node flag > env var > ~/.routstr/config.json > default
const defaultNodeUrl = process.env.ROUTSTR_NODE_URL ?? getNodeUrl() ?? "http://localhost:8000";

program
  .name("routstr")
  .description(
    "CLI for interacting with a Routstr node — payment proxy for permissionless AI inference.",
  )
  .version("0.1.0")
  .option("-n, --node <url>", "Routstr node URL", defaultNodeUrl)
  .option("-o, --output <format>", "Output format: text or json", "text")
  .option("-v, --verbose", "Verbose output", false)
  .option("-q, --quiet", "Suppress non-essential output", false)
  .option("--no-input", "Disable interactive prompts (agent mode)", false)
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    setGlobalOptions({
      node: opts.node,
      output: opts.output,
      verbose: opts.verbose,
      quiet: opts.quiet,
      noInput: opts.noInput ?? !opts.input,
    });
  });

// init
program
  .command("init")
  .description("Save node URL and token to ~/.routstr/config.json")
  .option("-n, --node-url <url>", "Node URL to save")
  .option("-t, --token <token>", "Admin/API token to save")
  .option("-s, --show", "Show current config")
  .action((opts) => (opts.show ? showInitCommand() : initCommand(opts)));

// status
program
  .command("status")
  .description("Show node health, version, and status")
  .action(statusCommand);

// config
const configCmd = program.command("config").description("Manage node configuration");
configCmd.command("show").description("Show current node configuration").action(configShowCommand);
configCmd
  .command("get <key>")
  .description("Get a single configuration value")
  .action(configGetCommand);
configCmd
  .command("set <key> <value>")
  .description("Set a configuration value (requires admin token)")
  .option("-t, --admin-token <token>", "Admin session token")
  .action(configSetCommand);

// models
const modelsCmd = program.command("models").description("List available models and pricing");
modelsCmd
  .command("list")
  .description("List available models with pricing")
  .option("-p, --provider <name>", "Filter by provider")
  .action(modelsListCommand);

// providers
const providersCmd = program.command("providers").description("Manage upstream providers");
providersCmd
  .command("list")
  .description("List providers (use --admin-token for upstream providers)")
  .option("-t, --admin-token <token>", "Admin session token (lists upstream providers)")
  .action(providersListCommand);
providersCmd
  .command("add <name>")
  .description("Add a new upstream provider (requires admin token)")
  .option("--api-key <key>", "Provider API key")
  .option("--base-url <url>", "Provider base URL")
  .option("--slug <slug>", "Stable provider slug (auto-generated if omitted)")
  .option("-t, --admin-token <token>", "Admin session token")
  .action(providersAddCommand);
providersCmd
  .command("remove <provider>")
  .description("Remove an upstream provider by ID or slug (requires admin token)")
  .option("-t, --admin-token <token>", "Admin session token")
  .action(providersRemoveCommand);
providersCmd
  .command("test <provider>")
  .description("Health check a provider by ID or slug (requires admin token)")
  .option("-t, --admin-token <token>", "Admin session token")
  .action(providersTestCommand);
providersCmd
  .command("show <provider>")
  .description("Show full details for a provider by ID or slug (requires admin token)")
  .option("-t, --admin-token <token>", "Admin session token")
  .action(providersShowCommand);
providersCmd
  .command("update <provider>")
  .description("Update provider fields by ID or slug (requires admin token)")
  .option("-t, --admin-token <token>", "Admin session token")
  .option("--type <type>", "Provider type (openai, anthropic, azure, openrouter, custom, ...)")
  .option("--base-url <url>", "Upstream base URL")
  .option("--api-key <key>", "Upstream API key")
  .option("--api-version <version>", "API version (Azure OpenAI)")
  .option("--enabled <bool>", "Enable/disable provider (true|false)")
  .option("--fee <multiplier>", "Provider fee multiplier (e.g. 1.01 for 1%)")
  .option("--settings <json>", "Provider-specific settings as JSON")
  .option("--slug <slug>", "Set/rename the stable provider slug")
  .action(providersUpdateCommand);
providersCmd
  .command("enable <provider>")
  .description("Enable a provider by ID or slug (requires admin token)")
  .option("-t, --admin-token <token>", "Admin session token")
  .action(providersEnableCommand);
providersCmd
  .command("disable <provider>")
  .description("Disable a provider by ID or slug (requires admin token)")
  .option("-t, --admin-token <token>", "Admin session token")
  .action(providersDisableCommand);

// providers models (per-model edits scoped under a provider)
const providerModelsCmd = providersCmd
  .command("models")
  .description("Manage models attached to a provider");
providerModelsCmd
  .command("list <provider>")
  .description(
    "List models for a provider ID or slug — DB + remote upstream models (requires admin token)",
  )
  .option("-t, --admin-token <token>", "Admin session token")
  .option("--source <source>", "Filter: all | db | remote", "all")
  .action(providerModelsListCommand);
providerModelsCmd
  .command("show <provider> <modelId>")
  .description("Show full details for a model by provider ID or slug (requires admin token)")
  .option("-t, --admin-token <token>", "Admin session token")
  .action(providerModelsShowCommand);
providerModelsCmd
  .command("update <provider> <modelId>")
  .description(
    "Update a single model's mutable fields by provider ID or slug (requires admin token)",
  )
  .option("-t, --admin-token <token>", "Admin session token")
  .option(
    "--forwarded-model-id <id>",
    "Model ID forwarded upstream (defaults to model id when empty)",
  )
  .option("--enabled <bool>", "Enable/disable model (true|false)")
  .option("--name <name>", "Display name")
  .option("--description <text>", "Description")
  .option("--price-unit <unit>", "Interpret price flags as USD per-token or per-1m", "per-token")
  .option("--prompt <usd>", "Prompt (input) price (USD, per --price-unit)")
  .option("--completion <usd>", "Completion (output) price (USD, per --price-unit)")
  .option("--request <usd>", "Per-request price (USD)")
  .option("--image <usd>", "Image price (USD)")
  .option("--web-search <usd>", "Web search price (USD)")
  .option("--internal-reasoning <usd>", "Internal reasoning price (USD)")
  .option("--input-cache-read <usd>", "Input cache read price (USD, per --price-unit)")
  .option("--input-cache-write <usd>", "Input cache write price (USD, per --price-unit)")
  .option("--max-prompt-cost <usd>", "Max prompt cost cap (USD)")
  .option("--max-completion-cost <usd>", "Max completion cost cap (USD)")
  .option("--max-cost <usd>", "Max total cost cap (USD)")
  .option("--pricing <json>", "Raw pricing JSON object, merged over current pricing")
  .action(providerModelsUpdateCommand);

// wallet — DISABLED for now (balance/send/receive need cashu/sk API key wiring; not ready)
// const walletCmd = program.command("wallet").description("Wallet and balance operations");
// walletCmd
//   .command("balance")
//   .description("Show wallet balance")
//   .option("-k, --key <apiKey>", "API key (Bearer token)")
//   .action(walletBalanceCommand);
// walletCmd
//   .command("send <amount>")
//   .description("Withdraw sats from node wallet as Cashu token (requires admin token)")
//   .option("-m, --mint <url>", "Mint URL to withdraw from")
//   .option("-t, --admin-token <token>", "Admin session token")
//   .action(walletSendCommand);
// walletCmd
//   .command("receive")
//   .description("Show receive info (supported Cashu mints)")
//   .action(walletReceiveCommand);

// instruct
program
  .command("instruct")
  .description("Print agent instructions for interacting with this node")
  .option("-f, --format <format>", "Format: text, json, openai", "text")
  .action(instructCommand);

// schema
program
  .command("schema")
  .description("Dump CLI structure as JSON for agent discovery")
  .action(() => schemaCommand(program));

// serve — DISABLED for now
// program
//   .command("serve")
//   .description("Start the Routstr node server")
//   .option("-h, --host <host>", "Bind host", "0.0.0.0")
//   .option("-p, --port <port>", "Bind port", "8000")
//   .option("-w, --workers <count>", "Number of workers", "1")
//   .option("--reload", "Enable auto-reload (dev mode)", false)
//   .action(serveCommand);

// monitor
program
  .command("monitor")
  .description("Launch the live monitor TUI dashboard")
  .option("-r, --refresh <seconds>", "Refresh interval in seconds", "2")
  .action(async (opts) => {
    const globalOpts = program.opts();
    await startMonitor(globalOpts.node, Number.parseFloat(opts.refresh));
  });

program.parse();
