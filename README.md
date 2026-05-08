# RedTomato

A programmatic TypeScript wrapper around the [Claude Code](https://claude.ai/code) CLI. Call Claude Code via functions instead of the TUI.

## Features

- **`claude()`** — async prompt → structured response with content, tool calls, usage
- **`claudeSync()`** — synchronous (blocking) variant
- **`claudeStream()`** — async generator yielding incremental text chunks
- **`ClaudeSession`** — multi-turn conversations with automatic session management
- Uses your local Claude Code auth and config — no separate API key needed
- Respects `CLAUDE.md` in the working directory
- Supports model, effort, permission mode, and budget overrides
- AbortSignal support for cancellation

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and authenticated (`claude` on PATH)
- Node.js 20+

## Installation

```bash
npm install
```

## Usage

### CLI

```bash
# Single prompt
npx tsx src/index.ts "Your prompt here"

# With options
npx tsx src/index.ts "Write a poem" --model opus --effort max

# Streaming output
npx tsx src/index.ts "Count to 10" --stream
```

### Programmatic API

```typescript
import { claude, claudeSync, claudeStream, ClaudeSession } from "redtomato-claude-wrapper";

// Async
const resp = await claude("What is the capital of France?");
console.log(resp.content);

// Sync (blocking)
const resp = claudeSync("Hello");
console.log(resp.content);

// Streaming
for await (const chunk of claudeStream("Tell me a story")) {
  process.stdout.write(chunk);
}
```

### Multi-turn sessions

```typescript
const session = new ClaudeSession();
await session.message("My favorite color is teal.");
const resp = await session.message("What is my favorite color?");
// resp.content remembers context from previous messages
```

### Configuration via `settings.json`

```json
{
  "defaultModel": "sonnet",
  "defaultEffort": "max",
  "permissionMode": "auto",
  "projectDir": "model"
}
```

Values passed directly to `claude()` override config file defaults.

### Available options

| Option | CLI flag | Description |
|--------|----------|-------------|
| `model` | `--model` | Model name (sonnet, opus) |
| `effort` | `--effort` | Thinking effort: low, medium, high, xhigh, max |
| `permissionMode` | `--permission-mode` | Permission mode: auto, default, bypassPermissions |
| `maxBudgetUsd` | `--max-budget-usd` | Max API spend in USD |
| `sessionId` | — | UUID for session identity |
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
│   └── index.ts           # Wrapper — all exports + CLI entry
├── model/                 # Claude Code working directory
│   └── CLAUDE.md
├── .claude/
│   └── skills/
│       └── testing-code/
│           └── SKILL.md   # Testing skill
├── test.md                # Full test case specification
├── settings.json          # Wrapper configuration
├── CLAUDE.md              # Project context for Claude Code
├── package.json
└── tsconfig.json
```
