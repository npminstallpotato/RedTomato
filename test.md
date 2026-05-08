# RedTomato — Test Specification

## Module: Config Loading (`loadConfig`)

### TC-CONFIG-1: Loads settings.json when it exists and is valid
- **Description:** `loadConfig()` returns a `WrapperConfig` parsed from `settings.json`.
- **Prerequisites:** A valid `settings.json` exists at the root with `{"defaultModel":"sonnet","defaultEffort":"medium"}`.
- **Steps:**
  1. Call `loadConfig(rootDir)`.
  2. Inspect the returned object.
- **Expected:** Returns `{ defaultModel: "sonnet", defaultEffort: "medium" }`.

### TC-CONFIG-2: Returns empty config when settings.json is missing
- **Description:** `loadConfig()` returns an empty object when no `settings.json` exists.
- **Prerequisites:** No `settings.json` in `rootDir`.
- **Steps:**
  1. Call `loadConfig(rootDir)`.
- **Expected:** Returns `{}`.

### TC-CONFIG-3: Returns empty config on invalid JSON
- **Description:** Malformed JSON in `settings.json` results in an empty config.
- **Prerequisites:** `settings.json` contains `{invalid json`.
- **Steps:**
  1. Call `loadConfig(rootDir)`.
- **Expected:** Returns `{}`, no crash.

### TC-CONFIG-4: Returns empty config when rootDir doesn't exist
- **Description:** Non-existent directory gracefully returns empty config.
- **Prerequisites:** `rootDir` points to a non-existent path.
- **Steps:**
  1. Call `loadConfig(nonExistentDir)`.
- **Expected:** Returns `{}`.

---

## Module: Binary Resolution (`findClaude`)

### TC-CLAUDE-1: Returns path when claude is on PATH
- **Description:** `findClaude()` returns the absolute path to the `claude` binary.
- **Prerequisites:** `claude` is installed and accessible via `which claude`.
- **Steps:**
  1. Call `findClaude()`.
- **Expected:** Returns a non-empty string ending in `/claude`.

### TC-CLAUDE-2: Throws when claude is not found
- **Description:** A clear error with install instructions is thrown when `claude` is unavailable.
- **Prerequisites:** `claude` is not on PATH (simulate by temporarily modifying PATH or mocking).
- **Steps:**
  1. Call `findClaude()`.
- **Expected:** Throws `Error` with message containing "Install it" and "https://claude.ai/code".

---

## Module: Directory Scaffolding (`ensureModelDir`)

### TC-SCAFFOLD-1: Creates directory if missing
- **Description:** A non-existent directory is created.
- **Prerequisites:** Target directory does not exist.
- **Steps:**
  1. Call `ensureModelDir(newDir)`.
  2. Check if the directory exists.
- **Expected:** Directory exists after the call.

### TC-SCAFFOLD-2: Writes default CLAUDE.md in new directory
- **Description:** A new directory gets a default `CLAUDE.md`.
- **Prerequisites:** Target directory is newly created.
- **Steps:**
  1. Call `ensureModelDir(newDir)`.
  2. Read `newDir/CLAUDE.md`.
- **Expected:** File exists and contains "Managed by RedTomato Claude wrapper."

### TC-SCAFFOLD-3: Does nothing if directory already exists
- **Description:** `ensureModelDir()` is a no-op when the directory already exists.
- **Prerequisites:** Directory exists.
- **Steps:**
  1. Call `ensureModelDir(existingDir)`.
- **Expected:** No changes to the directory or its contents.

### TC-SCAFFOLD-4: Does not overwrite existing CLAUDE.md
- **Description:** An existing `CLAUDE.md` with custom content is left unchanged.
- **Prerequisites:** Directory exists with a custom `CLAUDE.md`.
- **Steps:**
  1. Call `ensureModelDir(existingDir)`.
  2. Read `existingDir/CLAUDE.md`.
- **Expected:** File content matches the original custom content.

---

## Module: CLI Arg Building (`buildArgs`)

### TC-ARGS-1: Includes `-p <prompt>` and `--output-format stream-json`
- **Description:** Base invocation always includes prompt and output format.
- **Prerequisites:** None.
- **Steps:**
  1. Call `buildArgs("hello", { stream: false }, {}, {})`.
- **Expected:** Result includes `["-p", "hello", "--output-format", "stream-json"]`.

### TC-ARGS-2: Passes `--model` when specified
- **Description:** Model override appears in the arg list.
- **Prerequisites:** None.
- **Steps:**
  1. Call `buildArgs("hi", {}, { model: "opus" }, {})`.
- **Expected:** Result includes `--model opus`.

### TC-ARGS-3: Passes `--effort` when specified
- **Description:** Effort level appears in the arg list.
- **Steps:**
  1. Call `buildArgs("hi", {}, { effort: "high" }, {})`.
- **Expected:** Result includes `--effort high`.

### TC-ARGS-4: Passes `--permission-mode` when specified
- **Steps:**
  1. Call `buildArgs("hi", {}, { permissionMode: "bypassPermissions" }, {})`.
- **Expected:** Result includes `--permission-mode bypassPermissions`.

### TC-ARGS-5: Passes `--max-budget-usd` when specified
- **Steps:**
  1. Call `buildArgs("hi", {}, { maxBudgetUsd: 0.5 }, {})`.
- **Expected:** Result includes `--max-budget-usd 0.5`.

### TC-ARGS-6: Passes `--session-id` when specified
- **Steps:**
  1. Call `buildArgs("hi", {}, { sessionId: "abc-123" }, {})`.
- **Expected:** Result includes `--session-id abc-123`.

### TC-ARGS-7: Adds `--verbose` for stream-json
- **Description:** Stream-json output format requires `--verbose`.
- **Steps:**
  1. Call `buildArgs("hi", { stream: false }, {}, {})`.
- **Expected:** Result includes `--verbose`.

### TC-ARGS-8: Adds `--include-partial-messages` only when streaming
- **Description:** Streaming mode enables partial message events; non-streaming does not.
- **Steps:**
  1. Call `buildArgs("hi", { stream: true }, {}, {})`.
  2. Call `buildArgs("hi", { stream: false }, {}, {})`.
- **Expected:** Streaming result includes `--include-partial-messages`; non-streaming does not.

### TC-ARGS-9: Applies defaults from config when args not provided
- **Description:** Config values fill in for missing args.
- **Steps:**
  1. Call `buildArgs("hi", {}, {}, { defaultModel: "opus", defaultEffort: "high" })`.
- **Expected:** Result includes `--model opus` and `--effort high`.

### TC-ARGS-10: Prioritizes explicit args over config defaults
- **Description:** Explicit args take precedence over config values.
- **Steps:**
  1. Call `buildArgs("hi", {}, { model: "sonnet" }, { defaultModel: "opus" })`.
- **Expected:** Result includes `--model sonnet` (not `opus`).

---

## Module: Stream JSON Parsing

### TC-PARSE-1: Parses `assistant` event with text (skips text, captures tool_use)
- **Description:** The parser ignores text content in `assistant` events (text comes from `result` or stream events) but captures `tool_use` blocks.
- **Input:**
  ```json
  {"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}
  ```
- **Expected:** `state.content` is empty; `state.toolCalls` is empty.

### TC-PARSE-2: Parses `assistant` event with tool_use block
- **Input:**
  ```json
  {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"test.txt"}}]}}
  ```
- **Expected:** `state.toolCalls` contains `[{ name: "Read", input: { file_path: "test.txt" } }]`.

### TC-PARSE-3: Parses `result` event with final text and usage
- **Input:**
  ```json
  {"type":"result","result":"Hello.","usage":{"input_tokens":50,"output_tokens":10}}
  ```
- **Expected:** `state.content` is `"Hello."`; `state.usage` is `{ inputTokens: 50, outputTokens: 10 }`.

### TC-PARSE-4: Parses `content_block_delta` with text_delta
- **Input:**
  ```json
  {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}
  ```
- **Expected:** `state.content` is `"Hello"`.

### TC-PARSE-5: Parses `content_block_start` with tool_use
- **Input:**
  ```json
  {"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"Read","input":{"file_path":"test.txt"}}}}
  ```
- **Expected:** `state.toolCalls` contains `[{ name: "Read", input: { file_path: "test.txt" } }]`.

### TC-PARSE-6: Accumulates `input_json_delta` for partial tool input
- **Input (two lines):**
  ```json
  {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"file_"}}}
  {"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"path\": \"test.txt\"}"}}}
  ```
- **Steps:** Process both lines.
- **Expected:** `state.toolInputBufs.get(0)` is `'{"file_path": "test.txt"}'`.

### TC-PARSE-7: Finalizes tool_use input on `content_block_stop`
- **Prerequisites:** Tool input buffer has accumulated partial JSON.
- **Input:**
  ```json
  {"type":"stream_event","event":{"type":"content_block_stop","index":0}}
  ```
- **Expected:** `state.toolCalls` now includes a tool call with the parsed JSON input; buffers are cleared.

### TC-PARSE-8: Extracts usage from `message_delta`
- **Input:**
  ```json
  {"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":50,"output_tokens":10}}}
  ```
- **Expected:** `state.usage` is `{ inputTokens: 50, outputTokens: 10 }`.

### TC-PARSE-9: Handles malformed JSON gracefully
- **Input:** `not JSON` or `{"broken"`
- **Expected:** No crash; state is unchanged.

### TC-PARSE-10: Handles unknown event types gracefully
- **Input:**
  ```json
  {"type":"ping"}
  {"type":"unknown_event","data":"xyz"}
  ```
- **Expected:** No crash; state is unchanged.

### TC-PARSE-11: Handles empty content in `result` event
- **Input:**
  ```json
  {"type":"result","result":"","usage":{}}
  ```
- **Expected:** `state.content` is `""`.

### TC-PARSE-12: Multiple events in sequence accumulate correctly
- **Input:** A sequence of `content_block_delta`, `content_block_stop`, `message_delta`, `result` events.
- **Expected:** Final state has concatenated content, usage, and tool calls.

---

## Module: `claude()` async function

### TC-CLAUDE-ASYNC-1: Returns `ClaudeResponse` with content
- **Description:** A basic prompt returns a response with non-empty text.
- **Prerequisites:** `claude` CLI is installed and authenticated.
- **Steps:**
  1. `await claude("Reply with one word: Hello")`.
- **Expected:** `response.content` is a non-empty string. `response.exitCode` is 0. `response.sessionId` is a valid UUID.

### TC-CLAUDE-ASYNC-2: Captures tool calls from response
- **Description:** When Claude uses tools, they appear in the response.
- **Steps:**
  1. `await claude("What files are in the current directory?")`.
- **Expected:** `response.toolCalls` is an array (may be empty). Each tool call has `name` and `input`.

### TC-CLAUDE-ASYNC-3: Throws on missing claude binary
- **Description:** A clear error is thrown when the CLI is unavailable.
- **Prerequisites:** Temporarily hide `claude` from PATH.
- **Steps:**
  1. `await claude("hi")`.
- **Expected:** Throws `Error` with message about installing Claude Code.

### TC-CLAUDE-ASYNC-4: Creates model directory if missing
- **Description:** The `model/` directory is auto-created on first call.
- **Prerequisites:** `model/` does not exist.
- **Steps:**
  1. `await claude("hello")`.
- **Expected:** `model/` directory exists with a `CLAUDE.md` inside.

### TC-CLAUDE-ASYNC-5: AbortSignal cancels the process
- **Description:** Aborting mid-request kills the subprocess and rejects.
- **Steps:**
  1. Create `AbortController`, call `claude("tell me a long story", { signal: controller.signal })`.
  2. Immediately call `controller.abort()`.
- **Expected:** Promise rejects with `AbortError`.

### TC-CLAUDE-ASYNC-6: Uses provided sessionId
- **Description:** When a sessionId is passed, it appears in the response.
- **Steps:**
  1. `await claude("hi", { sessionId: "my-test-session" })`.
- **Expected:** `response.sessionId` is `"my-test-session"`.

### TC-CLAUDE-ASYNC-7: Generates sessionId if not provided
- **Description:** A UUID is auto-generated when no sessionId is given.
- **Steps:**
  1. `await claude("hi")`.
- **Expected:** `response.sessionId` is a valid UUID v4 string.

### TC-CLAUDE-ASYNC-8: Model override is respected
- **Steps:**
  1. `await claude("hi", { model: "sonnet" })`.
- **Expected:** Returns a successful response (model is passed to CLI).

### TC-CLAUDE-ASYNC-9: Stderr output is surfaced on error
- **Description:** When the subprocess fails, stderr is included in the error.
- **Prerequisites:** Force a failure (e.g., invalid permission mode).
- **Steps:**
  1. `await claude("hi", { permissionMode: "invalid-mode" })`.
- **Expected:** Error message includes stderr content from the CLI.

---

## Module: `claudeStream()` async generator

### TC-STREAM-1: Yields text chunks incrementally
- **Description:** The generator yields strings before the process exits.
- **Steps:**
  1. Collect chunks from `claudeStream("Count to 5")`.
- **Expected:** At least one chunk is yielded. First chunk arrives before the last chunk.

### TC-STREAM-2: All chunks concatenate to the full response
- **Description:** The concatenation of all yielded chunks equals the final content.
- **Steps:**
  1. Collect all yielded strings and the final returned `ClaudeResponse`.
- **Expected:** `chunks.join("")` equals `response.content` (excluding trailing newline).

### TC-STREAM-3: Returns `ClaudeResponse` after stream completes
- **Steps:**
  1. Use `for await...of` to iterate.
  2. Capture the return value via a variable.
- **Expected:** The return value (after the loop) is a `ClaudeResponse` with `content`, `exitCode`, `sessionId`.

### TC-STREAM-4: AbortSignal stops the stream
- **Description:** Aborting terminates the generator early.
- **Steps:**
  1. Create `AbortController`, iterate over `claudeStream("long story", { signal: controller.signal })`.
  2. Abort after the first chunk.
- **Expected:** Loop exits early. No more chunks after abort.

### TC-STREAM-5: Throws on subprocess failure
- **Description:** If the subprocess fails and no content was produced, an error is thrown.
- **Steps:**
  1. Iterate over `claudeStream("hi", { permissionMode: "invalid-mode" })`.
- **Expected:** An error is thrown (or caught by the for-await loop).

---

## Module: `claudeSync()` synchronous function

### TC-SYNC-1: Returns `ClaudeResponse` with content
- **Steps:**
  1. `claudeSync("Reply with one word: Test")`.
- **Expected:** `.content` is non-empty. `.exitCode` is 0.

### TC-SYNC-2: Returns usage data when available
- **Steps:**
  1. `claudeSync("hi")`.
- **Expected:** `.usage` is an object with `inputTokens` and `outputTokens`.

### TC-SYNC-3: Returns toolCalls when present
- **Steps:**
  1. `claudeSync("List files")`.
- **Expected:** `.toolCalls` is an array.

### TC-SYNC-4: Throws on non-zero exit with no content
- **Description:** When both the exit code is non-zero and content is empty, an error is thrown.
- **Prerequisites:** Force a CLI failure.
- **Steps:**
  1. `claudeSync("hi", { permissionMode: "invalid" })`.
- **Expected:** Throws `Error`.

### TC-SYNC-5: Uses config defaults from settings.json
- **Description:** Defaults from `settings.json` apply when args are omitted.
- **Prerequisites:** `settings.json` has `defaultModel` set.
- **Steps:**
  1. Call `claudeSync("hi")`.
- **Expected:** A `--model` flag matching the config default is used (verify via logging or response).

---

## Module: `ClaudeSession` multi-turn

### TC-SESSION-1: Generates a sessionId on construction
- **Steps:**
  1. `new ClaudeSession()`.
- **Expected:** `session.sessionId` is a valid UUID v4 string.

### TC-SESSION-2: `message()` returns `ClaudeResponse`
- **Steps:**
  1. `const r = await session.message("Say hello")`.
- **Expected:** `r` is a `ClaudeResponse` with non-empty `content`.

### TC-SESSION-3: Subsequent messages continue the conversation (same sessionId)
- **Description:** A second message in the same session uses the same sessionId, thus the conversation context is preserved.
- **Steps:**
  1. `await session.message("My favorite color is blue.")`.
  2. `const r = await session.message("What is my favorite color? Reply in one word.")`.
- **Expected:** `r.content` includes `"blue"` or `"Blue"`.

### TC-SESSION-4: `messageStream()` yields text chunks
- **Steps:**
  1. Collect chunks from `session.messageStream("Count to 3")`.
- **Expected:** Chunks are yielded incrementally; final concatenation equals the complete text.

### TC-SESSION-5: Accepts defaultArgs passed to constructor
- **Steps:**
  1. `new ClaudeSession(".", { model: "sonnet", effort: "low" })`.
  2. `await session.message("hi")`.
- **Expected:** Model and effort overrides are applied.

### TC-SESSION-6: Per-call args override constructor defaults
- **Steps:**
  1. `new ClaudeSession(".", { model: "opus" })`.
  2. `await session.message("hi", { model: "sonnet" })`.
- **Expected:** The per-call `model: "sonnet"` overrides the constructor default.

### TC-SESSION-7: `rootDir` is resolved and used for config and model directory
- **Steps:**
  1. `new ClaudeSession("/tmp")`.
- **Expected:** No crash. Config loaded from `/tmp/settings.json` if it exists.

---

## Module: CLI entry point

### TC-CLI-1: Prints usage and exits 1 when no prompt given
- **Steps:**
  1. Run `npx tsx src/index.ts` (no args).
- **Expected:** Stdout (or stderr) contains usage text. Exit code is 1.

### TC-CLI-2: Reads positional arg as prompt
- **Steps:**
  1. Run `npx tsx src/index.ts "Hello world"`.
- **Expected:** Response content is printed to stdout.

### TC-CLI-3: Reads `--prompt` flag
- **Steps:**
  1. Run `npx tsx src/index.ts --prompt "Hello"`.
- **Expected:** Response is printed.

### TC-CLI-4: Reads `-p` flag
- **Steps:**
  1. Run `npx tsx src/index.ts -p "Hello"`.
- **Expected:** Response is printed.

### TC-CLI-5: `--model` flag is respected
- **Steps:**
  1. Run `npx tsx src/index.ts "hi" --model sonnet`.
- **Expected:** Response is printed (model override works).

### TC-CLI-6: `--effort` flag is respected
- **Steps:**
  1. Run `npx tsx src/index.ts "hi" --effort low`.
- **Expected:** Response is printed.

### TC-CLI-7: `--stream` flag enables streaming output
- **Steps:**
  1. Run `npx tsx src/index.ts "Count to 3" --stream`.
- **Expected:** Output appears incrementally (not all at once at the end).

### TC-CLI-8: `--max-budget-usd` flag is respected
- **Steps:**
  1. Run `npx tsx src/index.ts "hi" --max-budget-usd 0.01`.
- **Expected:** Response is printed (budget constraint is applied).

### TC-CLI-9: `--permission-mode` flag is respected
- **Steps:**
  1. Run `npx tsx src/index.ts "hi" --permission-mode auto`.
- **Expected:** Response is printed.

---

## Module: Error Handling

### TC-ERR-1: Empty prompt
- **Description:** Sending an empty or whitespace-only prompt.
- **Steps:**
  1. `await claude("")` or `await claude("   ")`.
- **Expected:** CLI may return an error or empty response — the wrapper should not crash.

### TC-ERR-2: Very long prompt
- **Description:** A prompt exceeding typical length (e.g., 10,000+ characters).
- **Steps:**
  1. `await claude("A".repeat(10000))`.
- **Expected:** Response is returned (no truncation or crash).

### TC-ERR-3: Special characters in prompt
- **Description:** Prompt containing special shell characters.
- **Steps:**
  1. `await claude("echo $HOME && `whoami` && \"quotes\"")`.
- **Expected:** Prompt is sent literally (no shell injection). Response is returned.

### TC-ERR-4: Process killed externally
- **Description:** The subprocess is killed by an external signal.
- **Steps:**
  1. Write a wrapper that spawns `claude`, then kills the child process via PID.
- **Expected:** The promise/generator rejects or returns an error with a non-zero exit code.

### TC-ERR-5: Invalid effort value
- **Steps:**
  1. `await claude("hi", { effort: "extreme" as any })`.
- **Expected:** The CLI may error or ignore the invalid value, but the wrapper does not crash.

### TC-ERR-6: No internet / API unreachable
- **Steps:**
  1. Disconnect network, call `await claude("hi")`.
- **Expected:** Error is thrown with relevant message from the CLI.

---

## Integration Tests (End-to-End)

These tests require the `claude` CLI to be installed and authenticated.

### TC-INT-1: Basic sync round trip
- **Description:** Full end-to-end test of the sync API.
- **Steps:**
  1. `claudeSync("Reply with exactly: OK")`.
- **Expected:** `.content` contains `"OK"`. `.exitCode` is 0.

### TC-INT-2: Basic async round trip
- **Steps:**
  1. `await claude("Reply with exactly: OK")`.
- **Expected:** `.content` contains `"OK"`. `.exitCode` is 0.

### TC-INT-3: Streaming round trip
- **Steps:**
  1. Collect all chunks from `claudeStream("Reply with exactly: OK")`.
- **Expected:** Concatenated chunks contain `"OK"`. The generator's return value has `exitCode: 0`.

### TC-INT-4: Multi-turn session
- **Steps:**
  1. `session.message("My favorite color is orange.")`.
  2. `session.message("What is my favorite color? Reply in one word.")`.
- **Expected:** Second response is `"orange"` or `"Orange"`.

### TC-INT-5: Config from settings.json applies
- **Prerequisites:** `settings.json` has `defaultModel` set.
- **Steps:**
  1. Call `claudeSync("hi")`.
- **Expected:** Response is returned (model from config used).

### TC-INT-6: Multiple parallel calls
- **Description:** Two `claude()` calls run concurrently.
- **Steps:**
  1. `const [a, b] = await Promise.all([claude("A"), claude("B")])`.
- **Expected:** Both return valid `ClaudeResponse` objects.
