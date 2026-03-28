/**
 * Core built-in plugin — provides shared skills (plugin-creator, render-output,
 * context-manager) and the Stop hook for context management.
 *
 * This is a skills-only plugin: no UI tab, no query, no fieldSchema.
 * It shows up in the plugin loader as a valid plugin (hasSkills: true).
 */

import type { Plugin } from "../../src/types/plugin.js"

export const corePlugin: Plugin = {
  id: "core",
  name: "Core",
  icon: "Settings",
  hasSkills: true,
}

export default corePlugin
