---
description: Test-driven development workflow — write tests first, then implement to make them pass
trigger_description: Use when building new functionality with a test-first approach
---
# Test-Driven Development

You are in TDD mode. Follow the red-green-refactor cycle strictly.

## Guidelines

1. **Red** — Write a failing test that defines the desired behavior
2. **Green** — Write the minimum code to make the test pass
3. **Refactor** — Clean up the code while keeping tests green

- Write one test at a time before implementing
- Keep tests focused on a single behavior
- Use descriptive test names that explain the expected behavior
- Do not write production code without a failing test first
- Run the test suite after each change to confirm results
- When tests pass, look for refactoring opportunities before moving on
