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

## Usage

### Async (default)

```typescript
import { Tomato } from "@npminstallpotato/redtomato";

const tomato = new Tomato();
const resp = await tomato.ask({ prompt: "What is the capital of France?" });
console.log(resp.content);
```

### Sync (blocking)

```typescript
import { Tomato } from "@npminstallpotato/redtomato";

const resp = new Tomato().ask({ prompt: "Hello", sync: true });
console.log(resp.content);
```

### Streaming

```typescript
import { Tomato } from "@npminstallpotato/redtomato";

for await (const chunk of new Tomato().ask({ prompt: "Tell me a story", stream: true })) {
  process.stdout.write(chunk);
}
```

### Multi-turn sessions

```typescript
import { Tomato } from "@npminstallpotato/redtomato";

const tomato = new Tomato();
const sid = crypto.randomUUID();
await tomato.ask({ prompt: "My favorite color is teal.", sessionId: sid });
const resp = await tomato.ask({ prompt: "What is my favorite color?", sessionId: sid, resume: true });
console.log(resp.content); // "teal"
```

### Configuration

Create a `Tomato` instance with default settings:

```typescript
const tomato = new Tomato(); // uses default model "sonnet", effort "max", etc.
```

Override defaults per-instance:

```typescript
const tomato = new Tomato({ model: "opus", effort: "high" });
```

Per-call options override instance config:

```typescript
const resp = await tomato.ask({ prompt: "Hello", model: "sonnet" }); // overrides instance model
```

### Available options

| Option | CLI flag | Description |
|--------|----------|-------------|
| `prompt` | — | The prompt to send (required) |
| `sync` | — | If true, blocks synchronously instead of returning a Promise |
| `stream` | — | If true, returns an async generator yielding text chunks |
| `sessionId` | — | UUID for session identity |
| `resume` | — | Resume an existing session (use with `sessionId`) |
| `model` | `--model` | Model name (sonnet, opus) |
| `effort` | `--effort` | Thinking effort: low, medium, high, xhigh, max |
| `permissionMode` | `--permission-mode` | Permission mode: auto, default, bypassPermissions |
| `maxBudgetUsd` | `--max-budget-usd` | Max API spend in USD |
| `projectDir` | — | Claude Code working directory (default: `model/`) |
| `signal` | — | AbortSignal for cancellation |

### Structured response

```typescript
interface ClaudeResponse {
  content: string;                    // Text response
  toolCalls: ToolUse[];               // Tools Claude used (Read, Bash, Edit, etc.)
  usage?: { inputTokens: number; outputTokens: number };
  exitCode: number;                   // Subprocess exit code
  sessionId: string;                  // Session UUID
}
```

## How it works

Under the hood, each call spawns `claude -p "prompt" --output-format stream-json` as a subprocess in the `model/` directory. Output is parsed from JSON-per-line stream events. This means Claude Code's full capabilities (file access, tools, MCP servers) are available while your local auth and settings are used automatically.

## Project structure

```
RedTomato/
├── src/
│   └── index.ts           # Wrapper — Tomato class + types
├── model/                 # Claude Code working directory
│   └── CLAUDE.md
├── .claude/
│   └── skills/
│       └── testing-code/
│           └── SKILL.md   # Testing skill
├── test.md                # Full test case specification
├── CLAUDE.md              # Project context for Claude Code
├── package.json
└── tsconfig.json
```
