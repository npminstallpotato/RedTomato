import { spawn, spawnSync, execSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
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

export interface ClaudeOptions {
  prompt: string;
  sync?: boolean;
  stream?: boolean;
  sessionId?: string;
  /** Resume an existing session (uses --resume instead of --session-id) */
  resume?: boolean;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  permissionMode?: string;
  maxBudgetUsd?: number;
  /** Relative path from project root — defaults to "model" */
  projectDir?: string;
  signal?: AbortSignal;
}

export interface TomatoConfig {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  permissionMode?: string;
  maxBudgetUsd?: number;
  /** Relative path from project root — defaults to "model" */
  projectDir?: string;
}

// ─── Defaults ──────────────────────────────────────────────────

const TOMATO_DEFAULTS = {
  model: "sonnet",
  effort: "max",
  permissionMode: "auto",
  projectDir: "model",
} as const;

// ─── Utilities ─────────────────────────────────────────────────

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

// ─── Tomato class ──────────────────────────────────────────────

export class Tomato {
  private config: {
    model: string;
    effort: string;
    permissionMode: string;
    maxBudgetUsd?: number;
    projectDir: string;
  };

  constructor(config?: TomatoConfig) {
    this.config = {
      model: config?.model ?? TOMATO_DEFAULTS.model,
      effort: config?.effort ?? TOMATO_DEFAULTS.effort,
      permissionMode: config?.permissionMode ?? TOMATO_DEFAULTS.permissionMode,
      maxBudgetUsd: config?.maxBudgetUsd,
      projectDir: config?.projectDir ?? TOMATO_DEFAULTS.projectDir,
    };
  }

  // ─── Public API (3 overloads) ─────────────────────────────

  ask(opts: ClaudeOptions & { sync: true }): ClaudeResponse;
  ask(opts: ClaudeOptions & { stream: true }): AsyncGenerator<string, ClaudeResponse | void>;
  ask(opts: ClaudeOptions): Promise<ClaudeResponse>;
  ask(opts: ClaudeOptions): any {
    const effectiveSessionId = opts.sessionId || randomUUID();
    const effectiveOpts: ClaudeOptions = { ...opts, sessionId: effectiveSessionId };

    if (opts.sync) return this.runSync(effectiveOpts);
    if (opts.stream) return this.runStream(effectiveOpts);
    return this.runAsync(effectiveOpts);
  }

  // ─── CLI arg builder ──────────────────────────────────────

  private buildArgs(opts: ClaudeOptions): string[] {
    const cli: string[] = [];

    cli.push("-p", opts.prompt, "--output-format", "stream-json");

    const model = opts.model || this.config.model;
    if (model) cli.push("--model", model);

    const effort = opts.effort || this.config.effort;
    if (effort) cli.push("--effort", effort);

    const perm = opts.permissionMode || this.config.permissionMode;
    if (perm) cli.push("--permission-mode", perm);

    const budget = opts.maxBudgetUsd ?? this.config.maxBudgetUsd;
    if (budget !== undefined) cli.push("--max-budget-usd", String(budget));

    if (opts.sessionId) {
      cli.push(opts.resume ? "--resume" : "--session-id", opts.sessionId);
    }

    // stream-json requires --verbose
    cli.push("--verbose");

    // For streaming, include partial messages so we get text deltas
    if (opts.stream) {
      cli.push("--include-partial-messages");
    }

    return cli;
  }

  private getModelDir(rootDir: string, opts: ClaudeOptions): string {
    return resolve(rootDir, opts.projectDir || this.config.projectDir);
  }

  private prepareExecution(opts: ClaudeOptions) {
    const rootDir = resolve(process.cwd());
    const modelDir = this.getModelDir(rootDir, opts);
    const claudeBin = findClaude();
    const cliArgs = this.buildArgs(opts);
    return { modelDir, claudeBin, cliArgs };
  }

  // ─── Run functions ────────────────────────────────────────

  private runAsync(opts: ClaudeOptions): Promise<ClaudeResponse> {
    const { modelDir, claudeBin, cliArgs } = this.prepareExecution(opts);
    const sessionId = opts.sessionId || randomUUID();

    ensureModelDir(modelDir);

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
        if (opts.signal) opts.signal.removeEventListener("abort", abortHandler);
      };

      const abortHandler = () => {
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 2000);
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };

      if (opts.signal) {
        opts.signal.addEventListener("abort", abortHandler, { once: true });
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

  private runSync(opts: ClaudeOptions): ClaudeResponse {
    const { modelDir, claudeBin, cliArgs } = this.prepareExecution(opts);
    const sessionId = opts.sessionId || randomUUID();

    ensureModelDir(modelDir);

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

  private async *runStream(opts: ClaudeOptions): AsyncGenerator<string, ClaudeResponse | void, void> {
    const { modelDir, claudeBin, cliArgs } = this.prepareExecution(opts);
    const sessionId = opts.sessionId || randomUUID();

    ensureModelDir(modelDir);

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
      if (opts.signal) opts.signal.removeEventListener("abort", abortHandler);
    };

    const abortHandler = () => {
      proc.kill("SIGTERM");
      setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 2000);
    };

    if (opts.signal) {
      opts.signal.addEventListener("abort", abortHandler, { once: true });
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

      if (opts.signal?.aborted) {
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
}
