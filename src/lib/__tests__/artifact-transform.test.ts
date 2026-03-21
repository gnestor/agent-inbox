import { describe, it, expect } from "vitest"
import { transformArtifactCode } from "../artifact-transform"

describe("transformArtifactCode", () => {
  it("returns empty code for empty input", () => {
    const result = transformArtifactCode("")
    expect(result.code).toBe("")
    expect(result.exportedName).toBeNull()
  })

  it("strips React imports", () => {
    const source = `import { useState, useEffect } from 'react'
import React from 'react'
function App() { return <div>Hello</div> }`
    const result = transformArtifactCode(source)
    expect(result.code).not.toContain("from 'react'")
    expect(result.code).toContain("React.createElement")
  })

  it("strips react-dom imports", () => {
    const source = `import { createRoot } from 'react-dom/client'
function App() { return <div>Hello</div> }`
    const result = transformArtifactCode(source)
    expect(result.code).not.toContain("from 'react-dom")
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
    expect(result.code).toContain("function EmailEditor")
    expect(result.code).not.toContain("export default")
  })

  it("detects standalone export default Name", () => {
    const source = `function MyComponent() { return <div>Hi</div> }
export default MyComponent;`
    const result = transformArtifactCode(source)
    expect(result.exportedName).toBe("MyComponent")
    expect(result.code).not.toContain("export default")
  })

  it("strips export keyword from named exports", () => {
    const source = `export function helper() { return 42 }
export const FOO = 'bar'
function App() { return <div>{helper()} {FOO}</div> }`
    const result = transformArtifactCode(source)
    expect(result.code).not.toMatch(/^export\s/m)
    expect(result.code).toContain("function helper")
    expect(result.code).toContain("FOO")
  })

  it("prepends React hooks preamble", () => {
    const source = `function App() { const [x, setX] = useState(0); return <div>{x}</div> }`
    const result = transformArtifactCode(source)
    expect(result.code).toContain("useState")
    expect(result.code).toContain("useEffect")
    expect(result.code).toContain("useRef")
    expect(result.code).toContain("createContext")
  })

  it("transforms JSX to React.createElement", () => {
    const source = `function App() { return <div className="test"><span>Hello</span></div> }`
    const result = transformArtifactCode(source)
    expect(result.code).toContain("React.createElement")
    expect(result.code).not.toContain("<div")
    expect(result.code).not.toContain("<span")
  })

  it("fixes multiline regex literals (LLM bug)", () => {
    const source = `function App() {
  const text = "hello\\nworld".replace(/
/g, '<br>')
  return <div>{text}</div>
}`
    const result = transformArtifactCode(source)
    // Should not throw — the /\n/g fix prevents Babel parse errors
    expect(result.code).toContain("React.createElement")
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
    expect(result.code).not.toContain("from 'react'")
    expect(result.code).toContain("from '@hammies/frontend/components/ui'")
    expect(result.code).toContain("from '@hammies/frontend/lib/utils'")
    expect(result.code).toContain("React.createElement")
    expect(result.code).toContain("function Dashboard")
  })
})
