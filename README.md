# RedTomato

A programmatic TypeScript wrapper around the [Claude Code](https://claude.ai/code) CLI. Call Claude Code via a class with sensible defaults.

## Features

- **One method** — `tomato.ask()` with options for sync, async, streaming, multi-turn
- Uses your local Claude Code auth and config — no separate API key needed
- Respects `CLAUDE.md` in the working directory
- Supports model, effort, permission mode, and budget overrides
- AbortSignal support for cancellation

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and authenticated (`claude` on PATH)
- Node.js 20+

## Installation

```bash
npm install @npminstallpotato/redtomato
```

## Quick start

```typescript
import { Tomato } from "@npminstallpotato/redtomato";

const tomato = new Tomato();
const resp = await tomato.ask({ prompt: "What is the capital of France?" });
console.log(resp.content);
```

## API Reference

### Exports

| Export | Description |
|--------|-------------|
| `Tomato` | Main class — instantiate with optional config, call `.ask()` |
| `TomatoConfig` | Constructor options interface |
| `ClaudeOptions` | Per-call options interface |
| `ClaudeResponse` | Return type for sync and async calls |
| `ToolUse` | Structured tool call metadata |

---

### `Tomato` class

#### Constructor

```typescript
const tomato = new Tomato();                         // all defaults
const tomato = new Tomato({ model: "opus" });         // partial override
const tomato = new Tomato({                           // full override
  model: "opus",
  effort: "low",
  permissionMode: "bypassPermissions",
  maxBudgetUsd: 1.0,
  projectDir: "custom",
});
```

##### `TomatoConfig`

```typescript
interface TomatoConfig {
  model?: string;                                    // default: "sonnet"
  effort?: "low" | "medium" | "high" | "xhigh" | "max"; // default: "max"
  permissionMode?: string;                           // default: "auto"
  maxBudgetUsd?: number;                             // default: undefined
  projectDir?: string;                               // default: "model"
}
```

---

### `ask()` method

Three overloads dispatched by options:

| Mode | Return type | Use case |
|------|-------------|----------|
| `sync: true` | `ClaudeResponse` | Blocking, script-friendly |
| `stream: true` | `AsyncGenerator<string, ClaudeResponse>` | Real-time output |
| default (async) | `Promise<ClaudeResponse>` | Non-blocking, most common |

#### Async (default)

```typescript
const resp = await tomato.ask({ prompt: "What is the capital of France?" });
console.log(resp.content);
```

#### Sync (blocking)

```typescript
const resp = tomato.ask({ prompt: "Hello", sync: true });
console.log(resp.content);
```

#### Streaming

```typescript
for await (const chunk of tomato.ask({ prompt: "Tell me a story", stream: true })) {
  process.stdout.write(chunk);
}
```

---

### `ClaudeOptions`

```typescript
interface ClaudeOptions {
  prompt: string;                                    // (required) The prompt to send
  sync?: boolean;                                    // block instead of returning Promise
  stream?: boolean;                                  // return async generator yielding text chunks
  sessionId?: string;                                // UUID for session identity (auto-resumes on reuse)
  model?: string;                                    // --model (sonnet, opus)
  effort?: "low" | "medium" | "high" | "xhigh" | "max"; // --effort
  permissionMode?: string;                           // --permission-mode (auto, default, bypassPermissions)
  maxBudgetUsd?: number;                             // --max-budget-usd
  projectDir?: string;                               // Claude Code working directory (default: "model")
  signal?: AbortSignal;                              // AbortSignal for cancellation
}
```

Per-call options override instance-level config:

```typescript
const tomato = new Tomato({ model: "opus" });
const resp = await tomato.ask({ prompt: "Hello", model: "sonnet" }); // uses sonnet for this call
```

---

### `ClaudeResponse`

```typescript
interface ClaudeResponse {
  content: string;                    // Text response
  toolCalls: ToolUse[];               // Tools Claude used (Read, Bash, Edit, etc.)
  usage?: { inputTokens: number; outputTokens: number };
  exitCode: number;                   // Subprocess exit code
  sessionId: string;                  // Session UUID
}
```

### `ToolUse`

```typescript
interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}
```

---

### Multi-turn sessions

Pass a `sessionId` on the first call. Pass the same `sessionId` on subsequent calls — the library automatically resumes the session (tries `--resume` first, falls back to `--session-id` if the session doesn't exist).

```typescript
const tomato = new Tomato();
const sid = crypto.randomUUID();

await tomato.ask({ prompt: "My favorite color is teal.", sessionId: sid });
const resp = await tomato.ask({ prompt: "What is my favorite color?", sessionId: sid });
console.log(resp.content); // "teal"
```

Works across separate `Tomato` instances and handles session expiry naturally.

---

### Cancellation

Use `AbortSignal` to cancel in-flight requests:

```typescript
const controller = new AbortController();
const promise = tomato.ask({ prompt: "Tell me a long story", signal: controller.signal });
controller.abort(); // kills subprocess (SIGTERM → SIGKILL after 2s)
```

Or with a timeout:

```typescript
const resp = await tomato.ask({
  prompt: "Quick response only",
  signal: AbortSignal.timeout(10_000),
});
```

---

### How it works

Each call spawns `claude -p "prompt" --output-format stream-json` as a subprocess in the `model/` directory. Output is parsed from JSON-per-line stream events. Claude Code's full capabilities (file access, tools, MCP servers) are available, and your local auth and settings are used automatically.
