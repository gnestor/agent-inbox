// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useFileAttachments } from "../use-file-attachments"

function createFile(name: string, size: number, type = "application/octet-stream"): File {
  const buffer = new ArrayBuffer(size)
  return new File([buffer], name, { type })
}

describe("useFileAttachments", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("starts with empty state", () => {
    const { result } = renderHook(() => useFileAttachments())
    expect(result.current.files).toEqual([])
    expect(result.current.error).toBeNull()
    expect(result.current.isDragOver).toBe(false)
    expect(result.current.hasFiles).toBe(false)
  })

  it("adds files within size limit", () => {
    const { result } = renderHook(() => useFileAttachments())
    const file = createFile("test.txt", 1024)

    act(() => {
      result.current.addFiles([file])
    })

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].name).toBe("test.txt")
    expect(result.current.files[0].size).toBe(1024)
    expect(result.current.hasFiles).toBe(true)
  })

  it("rejects files over 10MB with error", () => {
    const { result } = renderHook(() => useFileAttachments())
    const bigFile = createFile("huge.zip", 11 * 1024 * 1024)

    act(() => {
      result.current.addFiles([bigFile])
    })

    expect(result.current.files).toHaveLength(0)
    expect(result.current.error).toContain("too large")
    expect(result.current.error).toContain("huge.zip")
  })

  it("creates preview URLs for supported image types", () => {
    const mockUrl = "blob:test-url"
    vi.spyOn(URL, "createObjectURL").mockReturnValue(mockUrl)

    const { result } = renderHook(() => useFileAttachments())
    const img = createFile("photo.png", 1024, "image/png")

    act(() => {
      result.current.addFiles([img])
    })

    expect(result.current.files[0].previewUrl).toBe(mockUrl)
  })

  it("does not create preview URLs for non-image types", () => {
    const { result } = renderHook(() => useFileAttachments())
    const file = createFile("doc.pdf", 1024, "application/pdf")

    act(() => {
      result.current.addFiles([file])
    })

    expect(result.current.files[0].previewUrl).toBeNull()
  })

  it("removes a file by id", () => {
    const { result } = renderHook(() => useFileAttachments())
    const file1 = createFile("a.txt", 100)
    const file2 = createFile("b.txt", 200)

    act(() => {
      result.current.addFiles([file1, file2])
    })

    expect(result.current.files).toHaveLength(2)
    const idToRemove = result.current.files[0].id

    act(() => {
      result.current.removeFile(idToRemove)
    })

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].name).toBe("b.txt")
  })

  it("clears all files", () => {
    const { result } = renderHook(() => useFileAttachments())
    const file = createFile("test.txt", 100)

    act(() => {
      result.current.addFiles([file])
    })

    expect(result.current.hasFiles).toBe(true)

    act(() => {
      result.current.clearAll()
    })

    expect(result.current.files).toHaveLength(0)
    expect(result.current.hasFiles).toBe(false)
  })

  it("clears error", () => {
    const { result } = renderHook(() => useFileAttachments())
    const bigFile = createFile("huge.zip", 11 * 1024 * 1024)

    act(() => {
      result.current.addFiles([bigFile])
    })

    expect(result.current.error).not.toBeNull()

    act(() => {
      result.current.clearError()
    })

    expect(result.current.error).toBeNull()
  })

  it("accepts mixed valid and oversized files", () => {
    const { result } = renderHook(() => useFileAttachments())
    const small = createFile("small.txt", 100)
    const big = createFile("big.zip", 11 * 1024 * 1024)

    act(() => {
      result.current.addFiles([small, big])
    })

    // Small file accepted, big file rejected with error
    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].name).toBe("small.txt")
    expect(result.current.error).toContain("big.zip")
  })

  it("supports image/jpeg, image/gif, image/webp previews", () => {
    const mockUrl = "blob:preview"
    vi.spyOn(URL, "createObjectURL").mockReturnValue(mockUrl)

    const { result } = renderHook(() => useFileAttachments())

    for (const type of ["image/jpeg", "image/gif", "image/webp"]) {
      act(() => {
        result.current.addFiles([createFile(`test.${type.split("/")[1]}`, 100, type)])
      })
    }

    expect(result.current.files).toHaveLength(3)
    for (const f of result.current.files) {
      expect(f.previewUrl).toBe(mockUrl)
    }
  })

  it("revokes object URLs when removing files", () => {
    const mockUrl = "blob:to-revoke"
    vi.spyOn(URL, "createObjectURL").mockReturnValue(mockUrl)
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL")

    const { result } = renderHook(() => useFileAttachments())
    const img = createFile("photo.png", 100, "image/png")

    act(() => {
      result.current.addFiles([img])
    })

    const id = result.current.files[0].id

    act(() => {
      result.current.removeFile(id)
    })

    expect(revokeSpy).toHaveBeenCalledWith(mockUrl)
  })
})
