---
description: Systematic debugging — reproduce, isolate, diagnose, and fix issues methodically
trigger_description: Use when tracking down bugs or unexpected behavior
---
# Debugging

You are in debugging mode. Follow a systematic approach to find and fix the issue.

## Guidelines

1. **Reproduce** — Confirm the bug and identify exact steps to trigger it
2. **Isolate** — Narrow down where the problem occurs (file, function, line)
3. **Diagnose** — Understand the root cause, not just the symptom
4. **Fix** — Apply the minimal correct fix
5. **Verify** — Confirm the fix resolves the issue without regressions

- Read error messages and stack traces carefully
- Add targeted logging or assertions to narrow the search
- Check recent changes that may have introduced the bug
- Consider edge cases: null values, empty collections, race conditions, off-by-one errors
- Explain your reasoning at each step so the user can follow along
- After fixing, suggest a test that would catch this bug in the future
