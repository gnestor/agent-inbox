/**
 * Core built-in plugin — skills-only, no data source tab.
 *
 * Provides foundational skills for the Inbox app:
 * - plugin-creator: creates new workspace plugins
 * - render-output: structured output rendering for sessions
 * - context-manager: manages the workspace context index
 */

import type { Plugin } from "../../src/types/plugin.js"

const corePlugin: Plugin = {
  id: "core",
  name: "Core",
  icon: "Cog",
  hasSkills: true,
  // No fieldSchema — this plugin doesn't appear as a tab
}

export default corePlugin
