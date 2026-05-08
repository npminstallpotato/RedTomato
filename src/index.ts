import { spawn, spawnSync, execSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { createInterface } from "readline";

// ─── Types ─────────────────────────────────────────────────────

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeResponse {
  content: string;
  toolCalls: ToolUse[];
  usage?: { inputTokens: number; outputTokens: number };
  exitCode: number;
  sessionId: string;
}

export interface ClaudeArgs {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  permissionMode?: string;
  maxBudgetUsd?: number;
  /** Relative path from project root — defaults to "model" */
  projectDir?: string;
  sessionId?: string;
  /** Resume an existing session (uses --resume instead of --session-id) */
  resume?: boolean;
  signal?: AbortSignal;
}

interface WrapperConfig {
  defaultModel?: string;
  defaultEffort?: string;
  maxBudgetUsd?: number;
  permissionMode?: string;
  projectDir?: string;
}

// ─── Constants ──────────────────────────────────────────────────

const CONFIG_FILE = "settings.json";
const DEFAULT_PROJECT_DIR = "model";

// ─── Config ─────────────────────────────────────────────────────

function loadConfig(rootDir: string): WrapperConfig {
  try {
    return JSON.parse(readFileSync(join(rootDir, CONFIG_FILE), "utf-8"));
  } catch {
    return {};
  }
}

function findClaude(): string {
  try {
    return execSync("which claude", { encoding: "utf-8" }).trim();
  } catch {
    throw new Error(
      "claude CLI not found.\n" +
      "Install it: https://claude.ai/code\n" +
      "Or run: npx @anthropic-ai/claude-code install"
    );
  }
}

// ─── Model directory scaffolding ────────────────────────────────

function ensureModelDir(modelDir: string): void {
  if (existsSync(modelDir)) return;
  mkdirSync(modelDir, { recursive: true });
  const mdPath = join(modelDir, "CLAUDE.md");
  if (!existsSync(mdPath)) {
    writeFileSync(
      mdPath,
      `# ${modelDir.split("/").pop() || "model"}\n\nManaged by RedTomato Claude wrapper.\n`
    );
  }
}

// ─── CLI arg builder ────────────────────────────────────────────

function buildArgs(
  prompt: string,
  options: { stream?: boolean },
  args: ClaudeArgs,
  config: WrapperConfig,
): string[] {
  const cli: string[] = [];

  cli.push("-p", prompt, "--output-format", "stream-json");

  const model = args.model || config.defaultModel;
  if (model) cli.push("--model", model);

  const effort = args.effort || config.defaultEffort;
  if (effort) cli.push("--effort", effort);

  const perm = args.permissionMode || config.permissionMode;
  if (perm) cli.push("--permission-mode", perm);

  const budget = args.maxBudgetUsd ?? config.maxBudgetUsd;
  if (budget !== undefined) cli.push("--max-budget-usd", String(budget));

  if (args.sessionId) {
    if (args.resume) {
      cli.push("--resume", args.sessionId);
    } else {
      cli.push("--session-id", args.sessionId);
    }
  }

  // stream-json requires --verbose
  cli.push("--verbose");

  // For streaming, include partial messages so we get text deltas
  if (options.stream) {
    cli.push("--include-partial-messages");
  }

  return cli;
}

function getModelDir(rootDir: string, args: ClaudeArgs, config: WrapperConfig): string {
  return resolve(rootDir, args.projectDir || config.projectDir || DEFAULT_PROJECT_DIR);
}

// ─── Stream JSON parser ─────────────────────────────────────────

interface StreamState {
  content: string;
  toolCalls: ToolUse[];
  usage?: { inputTokens: number; outputTokens: number };
  /** Accumulated partial JSON for tool_use input (keyed by index) */
  toolInputBufs: Map<number, string>;
  toolMeta: Map<number, { name: string }>;
}

function processLine(line: string, state: StreamState): boolean /* stopped */ {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line);
  } catch {
    return false;
  }

  const type = obj.type as string | undefined;
  if (!type) return false;

  switch (type) {
    // ── Assistant message: capture tool_use blocks only (text comes from stream or result event) ──
    case "assistant": {
      const msg = obj.message as Record<string, unknown> | undefined;
      if (!msg) break;
      const blocks = msg.content as Array<Record<string, unknown>> | undefined;
      if (!blocks) break;
      for (const block of blocks) {
        if (block.type === "tool_use") {
          state.toolCalls.push({
            name: block.name as string ?? "unknown",
            input: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }
      break;
    }

    // ── Result event: authoritative final text + usage ──
    case "result": {
      if (typeof obj.result === "string") {
        state.content = obj.result;
      }
      const usage = obj.usage as Record<string, unknown> | undefined;
      if (usage) {
        // Try common paths: direct or nested under modelUsage
        const u = usage as { input_tokens?: number; output_tokens?: number };
        if (typeof u.input_tokens === "number" || typeof u.output_tokens === "number") {
          state.usage = {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
          };
        }
      }
      break;
    }

    // ── With --include-partial-messages: unwrapped stream events ──
    case "stream_event": {
      const ev = obj.event as Record<string, unknown> | undefined;
      if (!ev) break;
      handleStreamEvent(ev, state);
      break;
    }
  }

  return false;
}

function handleStreamEvent(ev: Record<string, unknown>, state: StreamState): void {
  const type = ev.type as string;
  switch (type) {
    case "content_block_delta": {
      const delta = ev.delta as Record<string, unknown> | undefined;
      if (!delta) break;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        state.content += delta.text;
      }
      if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const idx = (ev.index as number) ?? 0;
        const buf = state.toolInputBufs.get(idx) || "";
        state.toolInputBufs.set(idx, buf + delta.partial_json);
      }
      break;
    }

    case "content_block_start": {
      const block = ev.content_block as Record<string, unknown> | undefined;
      if (!block) break;
      const idx = (ev.index as number) ?? 0;
      if (block.type === "tool_use") {
        state.toolMeta.set(idx, { name: block.name as string ?? "unknown" });
        if (block.input) {
          state.toolCalls.push({
            name: block.name as string ?? "unknown",
            input: block.input as Record<string, unknown>,
          });
        }
      }
      if (block.type === "text" && typeof block.text === "string") {
        state.content += block.text;
      }
      break;
    }

    case "content_block_stop": {
      const idx = (ev.index as number) ?? 0;
      const buf = state.toolInputBufs.get(idx);
      if (buf) {
        const meta = state.toolMeta.get(idx);
        if (meta) {
          try {
            state.toolCalls.push({ name: meta.name, input: JSON.parse(buf) });
          } catch {
            state.toolCalls.push({ name: meta.name, input: { _partial: buf } });
          }
        }
        state.toolInputBufs.delete(idx);
        state.toolMeta.delete(idx);
      }
      break;
    }

    case "message_delta": {
      const usage = ev.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      if (usage) {
        state.usage = {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
        };
      }
      break;
    }
  }
}

function createState(): StreamState {
  return { content: "", toolCalls: [], toolInputBufs: new Map(), toolMeta: new Map() };
}

// ─── Parsers for output formats ─────────────────────────────────

function parseOutput(stdout: string, state: StreamState): void {
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (t) processLine(t, state);
  }
}

/** Parse stream-json output and return text + final events. */
function parseStreamOutput(stdout: string): StreamState {
  const state = createState();
  parseOutput(stdout, state);
  return state;
}

// ─── Run (async, returns full response) ─────────────────────────

export async function claude(
  prompt: string,
  args: ClaudeArgs = {},
): Promise<ClaudeResponse> {
  const rootDir = resolve(process.cwd());
  const config = loadConfig(rootDir);
  const modelDir = getModelDir(rootDir, args, config);
  const sessionId = args.sessionId || randomUUID();

  ensureModelDir(modelDir);

  const claudeBin = findClaude();
  const cliArgs = buildArgs(prompt, {}, args, config);

  return new Promise((resolvePromise, reject) => {
    const proc = spawn(claudeBin, cliArgs, {
      cwd: modelDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const state = createState();
    let stderr = "";

    proc.stdout!.on("data", (data: Buffer) => {
      const text = data.toString("utf-8");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (t) processLine(t, state);
      }
    });

    proc.stderr!.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    const cleanup = () => {
      if (args.signal) args.signal.removeEventListener("abort", abortHandler);
    };

    const abortHandler = () => {
      proc.kill("SIGTERM");
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 2000);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (args.signal) {
      args.signal.addEventListener("abort", abortHandler, { once: true });
    }

    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });

    proc.on("close", (exitCode) => {
      cleanup();

      if (exitCode !== 0 && !state.content) {
        const msg = stderr.trim() || `exit code ${exitCode}`;
        reject(new Error(`claude failed: ${msg}`));
        return;
      }

      resolvePromise({
        content: state.content,
        toolCalls: state.toolCalls,
        usage: state.usage,
        exitCode: exitCode ?? -1,
        sessionId,
      });
    });
  });
}

// ─── Run (streaming) ────────────────────────────────────────────

export async function* claudeStream(
  prompt: string,
  args: ClaudeArgs = {},
): AsyncGenerator<string, ClaudeResponse | void, unknown> {
  const rootDir = resolve(process.cwd());
  const config = loadConfig(rootDir);
  const modelDir = getModelDir(rootDir, args, config);
  const sessionId = args.sessionId || randomUUID();

  ensureModelDir(modelDir);

  const claudeBin = findClaude();
  const cliArgs = buildArgs(prompt, { stream: true }, args, config);

  const proc = spawn(claudeBin, cliArgs, {
    cwd: modelDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const state = createState();
  let stderr = "";

  proc.stderr!.on("data", (data: Buffer) => {
    stderr += data.toString("utf-8");
  });

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  const cleanup = () => {
    if (args.signal) args.signal.removeEventListener("abort", abortHandler);
  };

  const abortHandler = () => {
    proc.kill("SIGTERM");
    setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 2000);
  };

  if (args.signal) {
    args.signal.addEventListener("abort", abortHandler, { once: true });
  }

  let lastLen = 0;

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;

    processLine(line, state);

    // Yield incremental text
    if (state.content.length > lastLen) {
      yield state.content.slice(lastLen);
      lastLen = state.content.length;
    }

    if (args.signal?.aborted) {
      proc.kill("SIGTERM");
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 2000);
      return;
    }
  }

  const exitCode = await new Promise<number>((res) => proc.on("close", res));
  cleanup();

  if (exitCode !== 0 && !state.content) {
    throw new Error(`claude failed: ${stderr.trim() || `exit code ${exitCode}`}`);
  }

  return {
    content: state.content,
    toolCalls: state.toolCalls,
    usage: state.usage,
    exitCode,
    sessionId,
  };
}

// ─── Run (sync, blocking) ───────────────────────────────────────

export function claudeSync(
  prompt: string,
  args: ClaudeArgs = {},
): ClaudeResponse {
  const rootDir = resolve(process.cwd());
  const config = loadConfig(rootDir);
  const modelDir = getModelDir(rootDir, args, config);
  const sessionId = args.sessionId || randomUUID();

  ensureModelDir(modelDir);

  const claudeBin = findClaude();
  const cliArgs = buildArgs(prompt, {}, args, config);

  const result = spawnSync(claudeBin, cliArgs, {
    cwd: modelDir,
    encoding: "utf-8",
  });

  const state = parseStreamOutput(result.stdout || "");

  if ((result.status ?? 1) !== 0 && !state.content) {
    throw new Error(`claude failed: ${(result.stderr || "").trim() || `exit code ${result.status}`}`);
  }

  return {
    content: state.content,
    toolCalls: state.toolCalls,
    usage: state.usage,
    exitCode: result.status ?? -1,
    sessionId,
  };
}

// ─── Session (multi-turn) ──────────────────────────────────────

export class ClaudeSession {
  public readonly sessionId: string;
  private rootDir: string;
  private config: WrapperConfig;
  private defaultArgs: ClaudeArgs;
  private started: boolean = false;

  constructor(rootDir: string = process.cwd(), defaultArgs: ClaudeArgs = {}) {
    this.sessionId = randomUUID();
    this.rootDir = resolve(rootDir);
    this.config = loadConfig(this.rootDir);
    this.defaultArgs = defaultArgs;

    ensureModelDir(getModelDir(this.rootDir, this.defaultArgs, this.config));
  }

  /** Send a message within this session (continues conversation). */
  async message(prompt: string, args: ClaudeArgs = {}): Promise<ClaudeResponse> {
    const merged: ClaudeArgs = {
      ...this.defaultArgs,
      ...args,
      sessionId: this.sessionId,
      resume: this.started ? true : undefined,
    };
    this.started = true;
    return claude(prompt, merged);
  }

  /** Send a message and stream the response within this session. */
  messageStream(
    prompt: string,
    args: ClaudeArgs = {},
  ): AsyncGenerator<string, ClaudeResponse | void, unknown> {
    const merged: ClaudeArgs = {
      ...this.defaultArgs,
      ...args,
      sessionId: this.sessionId,
      resume: this.started ? true : undefined,
    };
    this.started = true;
    return claudeStream(prompt, merged);
  }
}
