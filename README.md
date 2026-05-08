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

## Documentation

Full API reference including sync, streaming, multi-turn sessions, configuration, and cancellation: [DOC.md](./DOC.md).
