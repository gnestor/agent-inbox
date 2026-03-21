import { describe, it, expect } from "vitest"
import { transformArtifactCode, escapeForScript } from "../artifact-transform"

describe("transformArtifactCode", () => {
  it("returns empty code for empty input", () => {
    const result = transformArtifactCode("")
    expect(result.code).toBe("")
    expect(result.exportedName).toBeNull()
  })

  it("preserves React imports (resolved by import map)", () => {
    const source = `import { useState, useEffect } from 'react'
import React from 'react'
function App() { return <div>Hello</div> }`
    const result = transformArtifactCode(source)
    // React imports are kept — the import map resolves them
    expect(result.code).toContain("from 'react'")
    expect(result.code).toContain("createElement")
  })

  it("preserves react-dom imports", () => {
    const source = `import { createRoot } from 'react-dom/client'
function App() { return <div>Hello</div> }`
    const result = transformArtifactCode(source)
    expect(result.code).toContain("from 'react-dom/client'")
  })

  it("preserves @hammies/frontend imports", () => {
    const source = `import { Button, Card } from '@hammies/frontend/components/ui'
function App() { return <Button>Click</Button> }`
    const result = transformArtifactCode(source)
    expect(result.code).toContain("from '@hammies/frontend/components/ui'")
  })

  it("preserves @hammies/frontend/lib/utils imports", () => {
    const source = `import { cn } from '@hammies/frontend/lib/utils'
function App() { return <div className={cn("a", "b")}>Hello</div> }`
    const result = transformArtifactCode(source)
    expect(result.code).toContain("from '@hammies/frontend/lib/utils'")
  })

  it("strips unknown package imports", () => {
    const source = `import axios from 'axios'
import { something } from 'lodash'
function App() { return <div>Hello</div> }`
    const result = transformArtifactCode(source)
    expect(result.code).not.toContain("axios")
    expect(result.code).not.toContain("lodash")
  })

  it("strips side-effect imports", () => {
    const source = `import './styles.css'
function App() { return <div>Hello</div> }`
    const result = transformArtifactCode(source)
    expect(result.code).not.toContain("styles.css")
  })

  it("detects export default function", () => {
    const source = `export default function EmailEditor() { return <div>Editor</div> }`
    const result = transformArtifactCode(source)
    expect(result.exportedName).toBe("EmailEditor")
    expect(result.code).toContain("EmailEditor")
  })

  it("detects standalone export default Name", () => {
    const source = `function MyComponent() { return <div>Hi</div> }
export default MyComponent;`
    const result = transformArtifactCode(source)
    expect(result.exportedName).toBe("MyComponent")
  })

  it("transforms JSX to React.createElement", () => {
    const source = `function App() { return <div className="test"><span>Hello</span></div> }`
    const result = transformArtifactCode(source)
    expect(result.code).toContain("createElement")
    expect(result.code).not.toContain("<div")
    expect(result.code).not.toContain("<span")
  })

  it("uses sourceType module (supports import/export syntax)", () => {
    const source = `import { Button } from '@hammies/frontend/components/ui'
export default function App() { return <Button>Click</Button> }`
    const result = transformArtifactCode(source)
    // Should not throw — sourceType: "module" allows import/export
    expect(result.code).toContain("createElement")
    expect(result.exportedName).toBe("App")
  })

  it("fixes multiline regex literals (LLM bug)", () => {
    const source = `function App() {
  const text = "hello\\nworld".replace(/
/g, '<br>')
  return <div>{text}</div>
}`
    const result = transformArtifactCode(source)
    expect(result.code).toContain("createElement")
  })

  it("handles complex component with multiple features", () => {
    const source = `import { useState } from 'react'
import { Button, Card, CardContent } from '@hammies/frontend/components/ui'
import { cn } from '@hammies/frontend/lib/utils'

export default function Dashboard() {
  const [count, setCount] = useState(0)
  return (
    <Card className={cn("p-4")}>
      <CardContent>
        <p>Count: {count}</p>
        <Button onClick={() => setCount(c => c + 1)}>Increment</Button>
      </CardContent>
    </Card>
  )
}`
    const result = transformArtifactCode(source)
    expect(result.exportedName).toBe("Dashboard")
    expect(result.code).toContain("from 'react'")
    expect(result.code).toContain("from '@hammies/frontend/components/ui'")
    expect(result.code).toContain("from '@hammies/frontend/lib/utils'")
    expect(result.code).toContain("createElement")
  })
})

describe("escapeForScript", () => {
  it("escapes </script> tags", () => {
    expect(escapeForScript('var x = "</script>";')).toBe('var x = "<\\/script>";')
  })

  it("is case-insensitive", () => {
    const result = escapeForScript("</Script>")
    expect(result).not.toContain("</Script>")
    expect(result).toContain("<\\/script")
  })

  it("does not alter code without </script>", () => {
    const code = "var x = 1; function App() { return null; }"
    expect(escapeForScript(code)).toBe(code)
  })
})
