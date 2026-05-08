---
name: testing-code
description: Read test.md from the project root and execute the test cases defined there. Use when the user asks to run tests, verify functionality, or check that code works correctly.
---

# Testing

Read [test.md](../../../test.md) from the project root — it contains all test cases organized by module. Each case has an ID, steps, and expected result.

## Workflow

Copy this checklist and track progress:

```
Testing Progress:
- [ ] Read test.md and understand the test cases
- [ ] Run cases by module (start with basic/smoke tests)
- [ ] Verify each result matches the expected outcome
- [ ] Report: which passed, which failed, and why
```

## Approach

1. **Read test.md first** to see the full test specification
2. **Start with smoke tests** (basic round trips) before edge cases
3. **Run cases in order** — earlier tests verify assumptions later ones depend on
4. **Report results** per module with pass/fail counts
