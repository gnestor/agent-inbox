import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  getSessionFilesDir,
  saveSessionFile,
  getSessionFilePath,
  listSessionFiles,
  buildFileManifest,
} from "../session-files.js"

describe("session-files", () => {
  let ws: string

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "session-files-"))
  })

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true })
  })

  describe("path layout", () => {
    it("Scenario: Sessions root is `${workspacePath}/sessions/` — per-session dirs are <root>/<id>/{input,output}", () => {
      const dir = getSessionFilesDir(ws, "abc123", "output")
      expect(dir).toBe(join(ws, "sessions", "abc123", "output"))
      const inputDir = getSessionFilesDir(ws, "abc123", "input")
      expect(inputDir).toBe(join(ws, "sessions", "abc123", "input"))
    })

    it("Scenario: Sessions root is `${workspacePath}/sessions/` — empty workspace path falls back to process CWD", () => {
      const dir = getSessionFilesDir("", "abc123", "input")
      expect(dir).toBe(join(process.cwd(), "sessions", "abc123", "input"))
      // Clean up the dir created under CWD
      rmSync(join(process.cwd(), "sessions", "abc123"), { recursive: true, force: true })
    })

    it('Scenario: Subfolder is exactly `"input" | "output"` — defaults to input and is created recursively on first access', () => {
      const dir = getSessionFilesDir(ws, "sess1")
      expect(dir).toBe(join(ws, "sessions", "sess1", "input"))
      expect(existsSync(dir)).toBe(true)
    })
  })

  describe("validation and sanitisation", () => {
    it("Scenario: Session IDs must match `^[a-zA-Z0-9_-]+$` — rejects path traversal and metacharacters", () => {
      expect(() => getSessionFilesDir(ws, "../../etc")).toThrow("Invalid session ID: ../../etc")
      expect(() => getSessionFilesDir(ws, "a/b")).toThrow(/Invalid session ID/)
      expect(() => getSessionFilesDir(ws, "has space")).toThrow(/Invalid session ID/)
      expect(() => getSessionFilesDir(ws, "dot.id")).toThrow(/Invalid session ID/)
      // valid passes
      expect(() => getSessionFilesDir(ws, "abc_123-XYZ")).not.toThrow()
    })

    it("Scenario: Filenames are coerced to a safe alphabet — disallowed chars become underscores and that name is written + returned", () => {
      const meta = saveSessionFile(ws, "sess1", "my report(v2)!.txt", Buffer.from("hi"))
      expect(meta.name).toBe("my report_v2__.txt")
      expect(existsSync(join(ws, "sessions", "sess1", "input", "my report_v2__.txt"))).toBe(true)
    })
  })

  describe("save / look-up / list", () => {
    it("Scenario: `saveSessionFile` writes to `input/` and returns metadata — defaults mimeType to application/octet-stream", () => {
      const meta = saveSessionFile(ws, "sess1", "data.bin", Buffer.from("abcde"))
      expect(meta).toEqual({
        name: "data.bin",
        path: join(ws, "sessions", "sess1", "input", "data.bin"),
        size: 5,
        mimeType: "application/octet-stream",
      })
      const withMime = saveSessionFile(ws, "sess1", "p.png", Buffer.from("x"), "image/png")
      expect(withMime.mimeType).toBe("image/png")
    })

    it("Scenario: `getSessionFilePath` searches `input/` then `output/` — returns first existing path or null", () => {
      // file only in output/
      const outDir = getSessionFilesDir(ws, "sess1", "output")
      writeFileSync(join(outDir, "agent.txt"), "out")
      expect(getSessionFilePath(ws, "sess1", "agent.txt")).toBe(join(outDir, "agent.txt"))

      // file in input/ wins over output/ search order
      const inDir = getSessionFilesDir(ws, "sess1", "input")
      writeFileSync(join(inDir, "agent.txt"), "in")
      expect(getSessionFilePath(ws, "sess1", "agent.txt")).toBe(join(inDir, "agent.txt"))

      // missing -> null
      expect(getSessionFilePath(ws, "sess1", "nope.txt")).toBeNull()
    })

    it("Scenario: `listSessionFiles` enumerates both folders, tolerating missing dirs — skips missing subfolders and unstat-able entries", () => {
      // no dirs yet -> empty, no throw
      expect(listSessionFiles(ws, "sess1")).toEqual([])

      const inDir = getSessionFilesDir(ws, "sess1", "input")
      writeFileSync(join(inDir, "a.txt"), "aa")
      // output dir missing entirely -> skipped, no error
      const listed = listSessionFiles(ws, "sess1")
      expect(listed).toEqual([{ name: "a.txt", size: 2, subfolder: "input" }])

      // broken symlink fails statSync and is silently skipped
      const outDir = getSessionFilesDir(ws, "sess1", "output")
      symlinkSync(join(ws, "does-not-exist"), join(outDir, "broken-link"))
      const listed2 = listSessionFiles(ws, "sess1")
      expect(listed2.find((f) => f.name === "broken-link")).toBeUndefined()
      expect(listed2.find((f) => f.name === "a.txt")).toBeDefined()
    })
  })

  describe("file manifest", () => {
    it("Scenario: Empty manifest when no files exist — returns empty string", () => {
      expect(buildFileManifest(ws, "sess1")).toBe("")
    })

    it("Scenario: Bullet list with subfolder and byte size — input files before output files", () => {
      mkdirSync(join(ws, "sessions", "sess1", "input"), { recursive: true })
      mkdirSync(join(ws, "sessions", "sess1", "output"), { recursive: true })
      writeFileSync(join(ws, "sessions", "sess1", "input", "name1"), "x".repeat(1234))
      writeFileSync(join(ws, "sessions", "sess1", "output", "name2"), "y".repeat(5678))
      const manifest = buildFileManifest(ws, "sess1")
      expect(manifest).toBe(
        "\nSession files:\n- name1 (input/, 1234 bytes)\n- name2 (output/, 5678 bytes)\n",
      )
    })
  })
})
