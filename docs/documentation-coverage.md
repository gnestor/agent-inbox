# Documentation Coverage

This doc defines how every project file is represented by docs.

## Context

The goal is not to paste every implementation detail into Markdown. The goal is for every file to have an obvious owning spec so agents and humans know which contract to read before editing and which doc to update when behavior changes.

Coverage is enforced by `npm run docs:coverage`, which reads the ownership map below and checks it against tracked files plus untracked non-ignored files.

## Spec

### Coverage Rules

- Every tracked or untracked non-ignored file must match at least one ownership rule in the coverage map.
- The owning doc should explain the domain contract at the right level of abstraction.
- If a file moves, add or update the ownership rule in the same change.
- If a new domain appears, create a new domain spec rather than hiding it under an unrelated doc.
- Generated, vendored, and runtime output should not be tracked. If such files become tracked, they still need an owner or an explicit cleanup decision.

### Ownership Map

The coverage checker parses the fenced block below. Each line is:

```text
owner-doc | project-file-or-glob
```

```docs-coverage
docs/architecture.md | .claude/**
docs/architecture.md | ARCHITECTURE.md
docs/architecture.md | openspec/**
docs/architecture.md | .env.example
docs/architecture.md | .gitattributes
docs/architecture.md | .gitignore
docs/architecture.md | .prettierrc
docs/architecture.md | CLAUDE.md
docs/architecture.md | TODO.md
docs/architecture.md | docs/**
docs/architecture.md | index.html
docs/architecture.md | src/App.tsx
docs/architecture.md | src/components/layout/**
docs/architecture.md | src/main.tsx
docs/api.md | server/db/**
docs/api.md | server/index.ts
docs/api.md | server/lib/auth.ts
docs/api.md | server/lib/csrf.ts
docs/api.md | server/lib/health.ts
docs/api.md | server/lib/logger.ts
docs/api.md | server/lib/rate-limit.ts
docs/api.md | server/lib/schemas.ts
docs/api.md | server/lib/__tests__/auth.test.ts
docs/api.md | server/lib/__tests__/csrf.test.ts
docs/api.md | server/lib/__tests__/health.test.ts
docs/api.md | server/lib/__tests__/logger.test.ts
docs/api.md | server/lib/__tests__/rate-limit.test.ts
docs/api.md | server/lib/__tests__/schemas.test.ts
docs/api.md | server/routes/**
docs/api.md | server/types/hono-env.ts
docs/api.md | src/api/**
docs/caching-architecture.md | src/lib/queryClient.ts
docs/ci-and-verification.md | package-lock.json
docs/ci-and-verification.md | package.json
docs/ci-and-verification.md | playwright.config.ts
docs/ci-and-verification.md | scripts/check-docs-coverage.ts
docs/ci-and-verification.md | scripts/archive-proposal.ts
docs/ci-and-verification.md | tests/e2e/**
docs/ci-and-verification.md | tsconfig.json
docs/ci-and-verification.md | tsconfig.node.json
docs/ci-and-verification.md | vite.config.ts
docs/ci-and-verification.md | vitest.config.ts
docs/context-system.md | scripts/body-extract-loop.sh
docs/context-system.md | scripts/consolidate-entity.sh
docs/context-system.md | scripts/curate-all.sh
docs/context-system.md | scripts/curate-loop.sh
docs/context-system.md | scripts/migrate-curation-sessions.ts
docs/context-system.md | scripts/migrate-sqlite-to-postgres.ts
docs/context-system.md | scripts/rerender-loop.sh
docs/context-system.md | scripts/setup-postgres.sh
docs/context-system.md | server/lib/body-extractor.ts
docs/context-system.md | server/lib/context-backfill-scheduler.ts
docs/context-system.md | server/lib/curation-session.ts
docs/context-system.md | server/lib/entity-curator.ts
docs/context-system.md | server/lib/entity-extractor.ts
docs/context-system.md | server/lib/entity-gate.ts
docs/context-system.md | server/lib/workspace-context.ts
docs/context-system.md | server/lib/__tests__/attached-context.test.ts
docs/context-system.md | server/lib/__tests__/entity-gate.test.ts
docs/custom-xml-and-rich-output.md | server/lib/artifact-tools.ts
docs/custom-xml-and-rich-output.md | server/lib/render-output-tool.ts
docs/custom-xml-and-rich-output.md | server/lib/__tests__/render-output-tool.test.ts
docs/custom-xml-and-rich-output.md | src/components/session/ArtifactFrame.tsx
docs/custom-xml-and-rich-output.md | src/components/session/CodeEditorPanel.tsx
docs/custom-xml-and-rich-output.md | src/components/session/OutputRenderer.tsx
docs/custom-xml-and-rich-output.md | src/components/session/__tests__/artifact-frame.test.tsx
docs/custom-xml-and-rich-output.md | src/components/session/__tests__/output-renderer.test.tsx
docs/custom-xml-and-rich-output.md | src/lib/artifact-transform.ts
docs/custom-xml-and-rich-output.md | src/lib/build-artifact-html.ts
docs/custom-xml-and-rich-output.md | src/lib/hast-html.ts
docs/custom-xml-and-rich-output.md | src/lib/lazy-rehype-highlight.ts
docs/custom-xml-and-rich-output.md | src/lib/__tests__/artifact-transform.test.ts
docs/custom-xml-and-rich-output.md | src/hooks/use-artifact-editor.ts
docs/email-cleaner.md | plugins/gmail/app/lib/email-sanitizer.ts
docs/email-cleaner.md | plugins/gmail/app/lib/email-to-markdown.ts
docs/email-cleaner.md | plugins/gmail/app/__tests__/email-sanitizer-live.test.ts
docs/email-cleaner.md | plugins/gmail/app/__tests__/email-sanitizer.test.ts
docs/email-cleaner.md | plugins/gmail/app/__tests__/email-to-markdown.test.ts
docs/email-cleaner.md | plugins/gmail/app/__tests__/fixtures/**
docs/engineering-governance.md | docs/engineering-governance.md
docs/integrations.md | server/lib/credential-proxy-ca.ts
docs/integrations.md | server/lib/credential-proxy.ts
docs/integrations.md | server/lib/credentials.ts
docs/integrations.md | server/lib/integrations.ts
docs/integrations.md | server/lib/vault.ts
docs/integrations.md | server/lib/__tests__/connections.test.ts
docs/integrations.md | server/lib/__tests__/credential-proxy-ca.test.ts
docs/integrations.md | server/lib/__tests__/credential-proxy-integration.test.ts
docs/integrations.md | server/lib/__tests__/credential-proxy.test.ts
docs/integrations.md | server/lib/__tests__/credentials.test.ts
docs/integrations.md | server/lib/__tests__/integrations.test.ts
docs/integrations.md | server/lib/__tests__/oauth-callback.test.ts
docs/integrations.md | server/lib/__tests__/vault.test.ts
docs/integrations.md | server/scripts/migrate-env-to-vault.ts
docs/integrations.md | src/components/settings/**
docs/integrations.md | src/hooks/use-connections.ts
docs/integrations.md | src/hooks/use-user.ts
docs/integrations.md | src/hooks/__tests__/use-connections.test.tsx
docs/integrations.md | src/hooks/__tests__/use-user.test.tsx
docs/plugin-system.md | plugins/**
docs/plugin-system.md | server/lib/panel-registry.ts
docs/plugin-system.md | server/lib/plugin-context.ts
docs/plugin-system.md | server/lib/plugin-loader.ts
docs/plugin-system.md | server/lib/plugin-watcher.ts
docs/plugin-system.md | server/lib/__tests__/panel-registry.test.ts
docs/plugin-system.md | server/lib/__tests__/plugin-loader.test.ts
docs/plugin-system.md | src/components/plugin/**
docs/plugin-system.md | src/hooks/use-plugin-mutations.ts
docs/plugin-system.md | src/hooks/use-plugins.ts
docs/plugin-system.md | src/hooks/__tests__/use-plugin-mutations.test.tsx
docs/plugin-system.md | src/hooks/__tests__/use-plugins.test.tsx
docs/plugin-system.md | src/lib/build-plugin-component-html.tsx
docs/plugin-system.md | src/lib/field-schema.ts
docs/plugin-system.md | src/lib/plugin-utils.ts
docs/plugin-system.md | src/lib/__tests__/field-schema.test.ts
docs/plugin-system.md | src/types/plugin.ts
docs/rendering-performance.md | src/components/session/__tests__/session-transcript-virtualizer.test.tsx
docs/rich-text-editor.md | src/components/shared/RichTextEditor.tsx
docs/rich-text-editor.md | src/components/shared/SlashCommandMenu.tsx
docs/rich-text-editor.md | src/components/shared/rich-text-editor.css
docs/session-architecture.md | server/lib/agent-proxy-preload.mjs
docs/session-architecture.md | server/lib/session-files.ts
docs/session-architecture.md | server/lib/session-instructions.ts
docs/session-architecture.md | server/lib/session-manager.ts
docs/session-architecture.md | server/lib/title-generator.ts
docs/session-architecture.md | server/lib/__tests__/broadcast-buffer.test.ts
docs/session-architecture.md | server/lib/__tests__/session-*.test.ts
docs/session-architecture.md | server/lib/__tests__/title-generator.test.ts
docs/session-architecture.md | src/components/session/**
docs/session-architecture.md | src/hooks/use-ask-user-form.ts
docs/session-architecture.md | src/hooks/use-file-attachments.ts
docs/session-architecture.md | src/hooks/use-iframe-auto-height.ts
docs/session-architecture.md | src/hooks/use-local-draft.ts
docs/session-architecture.md | src/hooks/use-session-*.ts
docs/session-architecture.md | src/hooks/use-sessions.ts
docs/session-architecture.md | src/hooks/use-transcript-scroll.ts
docs/session-architecture.md | src/hooks/use-ws-stream.tsx
docs/session-architecture.md | src/hooks/__tests__/use-ask-user-form.test.tsx
docs/session-architecture.md | src/hooks/__tests__/use-file-attachments.test.tsx
docs/session-architecture.md | src/hooks/__tests__/use-iframe-auto-height.test.tsx
docs/session-architecture.md | src/hooks/__tests__/use-local-draft.test.tsx
docs/session-architecture.md | src/hooks/__tests__/use-session-*.test.tsx
docs/session-architecture.md | src/hooks/__tests__/use-sessions.test.tsx
docs/session-architecture.md | src/hooks/__tests__/use-transcript-scroll.test.tsx
docs/session-architecture.md | src/hooks/__tests__/use-ws-stream.test.tsx
docs/session-architecture.md | src/lib/session-pipeline.ts
docs/session-architecture.md | src/lib/__tests__/session-pipeline.test.ts
docs/session-architecture.md | src/stores/**
docs/session-architecture.md | src/types/session-message.ts
docs/spatial-grid-navigation.md | src/components/navigation/**
docs/spatial-grid-navigation.md | src/hooks/use-navigation.ts
docs/spatial-grid-navigation.md | src/hooks/use-swipe.ts
docs/spatial-grid-navigation.md | src/hooks/__tests__/use-navigation.test.tsx
docs/spatial-grid-navigation.md | src/hooks/__tests__/use-swipe.test.tsx
docs/spatial-grid-navigation.md | src/lib/navigation-constants.ts
docs/spatial-grid-navigation.md | src/lib/navigation-storage.ts
docs/spatial-grid-navigation.md | src/lib/navigation-store.ts
docs/spatial-grid-navigation.md | src/lib/__tests__/navigation-storage.test.ts
docs/spatial-grid-navigation.md | src/types/navigation.ts
docs/spatial-grid-navigation.md | src/types/panels.ts
docs/theming.md | public/**
docs/theming.md | src/assets/**
docs/theming.md | src/index.css
docs/theming.md | src/vite-env.d.ts
docs/ui-components.md | src/components/shared/**
docs/ui-components.md | src/lib/formatters.ts
docs/ui-components.md | src/lib/iframe-theme.ts
docs/ui-components.md | src/lib/logger.ts
docs/ui-components.md | src/lib/__tests__/field-schema-rendering.test.tsx
docs/ui-components.md | src/lib/__tests__/formatters.test.ts
docs/ui-components.md | src/lib/__tests__/logger.test.ts
docs/ui-components.md | src/types/babel-standalone.d.ts
docs/ui-components.md | src/types/index.ts
docs/user-preferences.md | src/hooks/use-preferences.ts
docs/user-preferences.md | src/hooks/__tests__/use-preferences.test.tsx
docs/user-preferences.md | server/lib/__tests__/preferences.test.ts
docs/virtual-scrolling.md | src/components/session/SessionTranscript.tsx
docs/workspace.md | server/lib/workspace-scanner.ts
docs/workspace.md | server/lib/__tests__/workspace-scanner.test.ts
docs/workspace.md | src/components/workspace/**
docs/workspace.md | tests/e2e/fixtures/**
```

## History

| Date | Commit | Change |
|------|--------|--------|
| 2026-04-29 | `5e413d6` | Added documentation ownership map and coverage contract. |
