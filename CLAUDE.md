# RedTomato

Programmatic TypeScript wrapper around the Claude Code CLI. Provides `claude()`, `claudeStream()`, `claudeSync()`, and `ClaudeSession` for using Claude Code via function calls instead of the TUI.

---

## Tech Stack

| Category | Choice |
|----------|--------|
| Language | TypeScript 5.9 |
| Runtime  | Node.js 20+ |
| Package manager | npm |
| Testing  | See `test.md` (spec), skill `/testing-code` |
| Dev tools | tsx (TypeScript execution), tsc (type-checking) |

---

## Development Commands

```bash
# Install dependencies
npm install

# Run the wrapper (CLI mode)
npx tsx src/index.ts "your prompt"

# Run with streaming
npx tsx src/index.ts "your prompt" --stream

# Run tests (see test.md for full test spec)
npx tsx src/index.ts "Reply with exactly: OK"       # smoke test
npx tsx src/index.ts "Count to 3" --stream           # stream test

# Type-check
npx tsc --noEmit

# Build
npm run build
```

---

## Architecture

### Key files

| File | Purpose |
|------|---------|
| `src/index.ts` | Single source file — exports `claude`, `claudeStream`, `claudeSync`, `ClaudeSession`, types |
| `settings.json` | Default config (model, effort, permission mode, project dir) |
| `test.md` | Complete test case specification |
| `model/` | CWD for spawned `claude` subprocesses |

### How it works

Each function call spawns `claude -p "prompt" --output-format stream-json` via `child_process`. The subprocess runs with CWD set to `model/`, which means:
- Claude Code auto-loads `model/CLAUDE.md` for project context
- It uses the local machine's auth, settings, MCP servers
- All tools (Read, Edit, Bash, etc.) are available

Output is parsed from JSON-per-line stream events into structured `ClaudeResponse` objects.

### Stream parsing

Handles three event types from `stream-json` output:
- **`assistant`** — captures `tool_use` blocks from content
- **`result`** — authoritative final text + token usage
- **`stream_event`** — incremental text deltas (`--include-partial-messages`), tool input accumulation

### Multi-turn sessions

`ClaudeSession` generates a UUID and uses `--session-id` for the first message (creates session) and `--resume` for subsequent messages (continues conversation).

---

## Code Rules

### General Style
- No runtime dependencies — only Node.js built-ins (`child_process`, `crypto`, `fs`, `path`, `readline`)
- Single source file, clean exports
- Prefer readability over cleverness

### Naming Conventions
- **Variables/functions:** `camelCase`
- **Classes/types/interfaces:** `PascalCase`
- **Files:** Match the primary export name

### Error Handling
- Subprocess errors capture stderr for context
- Missing `claude` binary gives clear install instructions
- AbortSignal kills subprocess with SIGTERM → SIGKILL fallback
- Malformed stream JSON is silently skipped, never crashes

### Testing
- See `test.md` for all test cases organized by module
- Run via `/testing-code` skill

### Import Rules
- Standard library → internal modules (no third-party runtime imports)

### Commit Conventions
- Conventional commits: `type(scope): message` (one line only)
- Types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `perf`

---

## Project Structure

```
RedTomato/
├── src/
│   └── index.ts           # Wrapper — all public API + CLI entry
├── model/
│   └── CLAUDE.md           # Claude Code working directory context
├── .claude/
│   └── skills/
│       └── testing-code/
│           └── SKILL.md    # Testing skill
├── settings.json           # Default config
├── CLAUDE.md               # This file
├── README.md
├── test.md                 # Test specification
├── package.json
└── tsconfig.json
```

---

## Configuration

`settings.json` at project root:

```json
{
  "defaultModel": "sonnet",
  "defaultEffort": "max",
  "permissionMode": "auto",
  "projectDir": "model"
}
```

All fields are optional — values passed to `claude()` / `claudeSync()` / `claudeStream()` override config defaults.
