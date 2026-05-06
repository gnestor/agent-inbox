# Engineering Governance

This doc defines how changes should be proposed, implemented, reviewed, and verified in this repo.

## Context

Agentic development is fast but can create regressions when the agent lacks stable project boundaries. The repo should therefore prefer written contracts, explicit ownership, and repeatable verification over informal conventions.

## Spec

### Spec-First Workflow

1. Identify the owning domain spec in `docs/documentation-coverage.md`.
2. Update that spec before implementation when behavior, architecture, data shape, UI flow, public API, or operational expectations change.
3. Include both:
   - **Context**: human-friendly explanation, tradeoffs, and why the domain exists.
   - **Spec**: normative contracts, invariants, wire formats, state machines, and test expectations.
4. Add a **History** entry with the date and current commit reference. If the change is not committed yet, use the current base commit and update it after commit.
5. Implement the smallest code change that satisfies the spec.
6. Update or add tests according to [`ci-and-verification.md`](ci-and-verification.md).

Text-only typo fixes can skip spec approval, but they still need to keep docs coverage passing.

### Code Organization Rules

- Keep server routes thin. Routes validate input, call domain libs, and serialize responses.
- Keep domain logic in `server/lib/`, `src/lib/`, `src/stores/`, or feature hooks instead of embedding it in UI components.
- Keep React components render-focused. Components can call controller callbacks, but should not know transport details.
- Prefer pure reducers/state machines for ordering-sensitive state, especially session streaming and recovery.
- Do not add a new shared abstraction unless at least two call sites need the same contract or the abstraction matches an established local pattern.
- Keep plugin-specific code inside `plugins/{id}/` unless the behavior is part of the shared plugin platform.
- Keep credential access on the server side. Browser code should interact with connection status and typed API routes, not secrets.

### Agent Change Safety

Agents working in this repo must:

- Read the owning spec before editing a domain.
- Update docs and tests in the same change as implementation.
- Avoid unrelated refactors.
- Preserve unidirectional dataflow: server/API/WS -> actions -> canonical state -> selectors/controllers -> components.
- Treat browser verification as part of completion for any visible UI change.
- Run `npm run docs:coverage` before completion once this gate is enabled in CI.

### Review Standard

Reviews should prioritize:

- Broken invariants against the owning spec.
- State duplication or bidirectional dataflow.
- Missing validation at API/plugin/session boundaries.
- Async races, reconnect gaps, and optimistic UI rollback failures.
- Missing browser verification for visible UI changes.
- Missing tests or tests that assert implementation details instead of behavior.

## History

| Date | Commit | Change |
|------|--------|--------|
| 2026-04-29 | `5e413d6` | Added spec-first workflow and agent-safe engineering rules. |
