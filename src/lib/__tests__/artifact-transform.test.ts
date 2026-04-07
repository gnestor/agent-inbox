import { describe, it, expect } from "vitest"
import { transformArtifactCode, escapeForScript } from "../artifact-transform"

describe("transformArtifactCode", () => {
  it("returns empty code for empty input", async () => {
    const result = await transformArtifactCode("")
    expect(result.code).toBe("")
    expect(result.exportedName).toBeNull()
  })

  it("preserves React imports (resolved by import map)", async () => {
    const source = `import { useState, useEffect } from 'react'
import React from 'react'
function App() { return <div>Hello</div> }`
    const result = await transformArtifactCode(source)
    // React imports are kept — the import map resolves them
    expect(result.code).toContain("from 'react'")
    expect(result.code).toContain("createElement")
  })

  it("preserves react-dom imports", async () => {
    const source = `import { createRoot } from 'react-dom/client'
function App() { return <div>Hello</div> }`
    const result = await transformArtifactCode(source)
    expect(result.code).toContain("from 'react-dom/client'")
  })

  it("preserves @hammies/frontend imports", async () => {
    const source = `import { Button, Card } from '@hammies/frontend/components/ui'
function App() { return <Button>Click</Button> }`
    const result = await transformArtifactCode(source)
    expect(result.code).toContain("from '@hammies/frontend/components/ui'")
  })

  it("preserves @hammies/frontend/lib/utils imports", async () => {
    const source = `import { cn } from '@hammies/frontend/lib/utils'
function App() { return <div className={cn("a", "b")}>Hello</div> }`
    const result = await transformArtifactCode(source)
    expect(result.code).toContain("from '@hammies/frontend/lib/utils'")
  })

  it("strips unknown package imports but preserves allowed ones", async () => {
    const source = `import axios from 'axios'
import { something } from 'lodash'
import { LineChart } from 'recharts'
function App() { return <div>Hello</div> }`
    const result = await transformArtifactCode(source)
    expect(result.code).not.toContain("axios")
    // lodash and recharts are allowed imports (in the import map)
    expect(result.code).toContain("lodash")
    expect(result.code).toContain("recharts")
  })

  it("auto-injects React import when hooks are used without import", async () => {
    const source = `function App() {
  const [count, setCount] = useState(0)
  useEffect(() => {}, [])
  return <div>{count}</div>
}`
    const result = await transformArtifactCode(source)
    // Should inject import for used hooks
    expect(result.code).toContain("from 'react'")
    expect(result.code).toContain("useState")
    expect(result.code).toContain("useEffect")
    expect(result.code).toContain("createElement")
  })

  it("auto-injects React default import even with no hooks", async () => {
    const source = `function App() { return <div>Hello</div> }`
    const result = await transformArtifactCode(source)
    // Needs React for createElement calls
    expect(result.code).toContain("from 'react'")
  })

  it("does not double-inject if React import already exists", async () => {
    const source = `import { useState } from 'react'
function App() { const [x] = useState(0); return <div>{x}</div> }`
    const result = await transformArtifactCode(source)
    // Should have exactly one import from react
    const matches = result.code.match(/from 'react'/g)
    expect(matches?.length).toBe(1)
  })

  it("auto-injects component imports when used without import", async () => {
    const source = `function App() {
  return <Card><CardContent><Input placeholder="Name" /><Button>Submit</Button></CardContent></Card>
}`
    const result = await transformArtifactCode(source)
    expect(result.code).toContain("from '@hammies/frontend/components/ui'")
    expect(result.code).toContain("Card")
    expect(result.code).toContain("CardContent")
    expect(result.code).toContain("Input")
    expect(result.code).toContain("Button")
  })

  it("auto-injects cn import when used without import", async () => {
    const source = `function App() { return <div className={cn("a", "b")}>Hi</div> }`
    const result = await transformArtifactCode(source)
    expect(result.code).toContain("from '@hammies/frontend/lib/utils'")
  })

  it("does not double-inject component imports", async () => {
    const source = `import { Button } from '@hammies/frontend/components/ui'
function App() { return <Button>Click</Button> }`
    const result = await transformArtifactCode(source)
    const matches = result.code.match(/@hammies\/frontend\/components\/ui/g)
    expect(matches?.length).toBe(1)
  })

  it("merges missing components into existing import", async () => {
    const source = `import { Button } from '@hammies/frontend/components/ui'
function App() { return <Card><Button>Click</Button><Input /></Card> }`
    const result = await transformArtifactCode(source)
    // Should have one import with Button, Card, and Input
    const matches = result.code.match(/@hammies\/frontend\/components\/ui/g)
    expect(matches?.length).toBe(1)
    expect(result.code).toContain("Card")
    expect(result.code).toContain("Input")
  })

  it("strips side-effect imports", async () => {
    const source = `import './styles.css'
function App() { return <div>Hello</div> }`
    const result = await transformArtifactCode(source)
    expect(result.code).not.toContain("styles.css")
  })

  it("detects export default function", async () => {
    const source = `export default function EmailEditor() { return <div>Editor</div> }`
    const result = await transformArtifactCode(source)
    expect(result.exportedName).toBe("EmailEditor")
    expect(result.code).toContain("EmailEditor")
  })

  it("detects standalone export default Name", async () => {
    const source = `function MyComponent() { return <div>Hi</div> }
export default MyComponent;`
    const result = await transformArtifactCode(source)
    expect(result.exportedName).toBe("MyComponent")
  })

  it("transforms JSX to React.createElement", async () => {
    const source = `function App() { return <div className="test"><span>Hello</span></div> }`
    const result = await transformArtifactCode(source)
    expect(result.code).toContain("createElement")
    expect(result.code).not.toContain("<div")
    expect(result.code).not.toContain("<span")
  })

  it("uses sourceType module (supports import/export syntax)", async () => {
    const source = `import { Button } from '@hammies/frontend/components/ui'
export default function App() { return <Button>Click</Button> }`
    const result = await transformArtifactCode(source)
    // Should not throw — sourceType: "module" allows import/export
    expect(result.code).toContain("createElement")
    expect(result.exportedName).toBe("App")
  })

  it("fixes multiline regex literals (LLM bug)", async () => {
    const source = `function App() {
  const text = "hello\\nworld".replace(/
/g, '<br>')
  return <div>{text}</div>
}`
    const result = await transformArtifactCode(source)
    expect(result.code).toContain("createElement")
  })

  it("handles complex component with multiple features", async () => {
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
    const result = await transformArtifactCode(source)
    expect(result.exportedName).toBe("Dashboard")
    expect(result.code).toContain("from 'react'")
    expect(result.code).toContain("from '@hammies/frontend/components/ui'")
    expect(result.code).toContain("from '@hammies/frontend/lib/utils'")
    expect(result.code).toContain("createElement")
  })
})

  it("consolidates multiple @hammies/frontend barrel imports without duplicates", async () => {
    const source = `import { Button, Badge, Input, Textarea, Label } from '@hammies/frontend/components/ui'
import { Input } from '@hammies/frontend/components/ui'
import { Textarea } from '@hammies/frontend/components/ui'

export default function App() { return <div><Button>Go</Button><Input /><Badge>x</Badge></div> }`
    const result = await transformArtifactCode(source)
    const imports = result.code.match(/from '@hammies\/frontend\/components\/ui'/g)
    expect(imports).toHaveLength(1)
    expect(result.code).toContain("createElement")
  })

  it("consolidates per-component path imports into a single barrel import", async () => {
    const source = `import { Button } from '@hammies/frontend/components/ui/button'
import { Badge } from '@hammies/frontend/components/ui/badge'
import { Input } from '@hammies/frontend/components/ui/input'
import { Textarea } from '@hammies/frontend/components/ui/textarea'

export default function App() { return <div><Button>Go</Button><Input /><Badge>x</Badge></div> }`
    const result = await transformArtifactCode(source)
    // All per-component imports consolidated into one barrel import
    const imports = result.code.match(/from '@hammies\/frontend\/components\/ui'/g)
    expect(imports).toHaveLength(1)
    expect(result.code).not.toMatch(/\/ui\/button/)
    expect(result.code).not.toMatch(/\/ui\/badge/)
    expect(result.code).toContain("Button")
    expect(result.code).toContain("Badge")
    expect(result.code).toContain("Input")
    expect(result.code).toContain("Textarea")
    expect(result.code).toContain("createElement")
  })

  it("does not auto-import components that are locally declared", async () => {
    const source = `function Card({ children }) { return <div className="card">{children}</div> }
function App() { return <Card><Button>Go</Button></Card> }
export default App`
    const result = await transformArtifactCode(source)
    // Button should be auto-imported, but Card should NOT (it's locally defined)
    expect(result.code).toContain("Button")
    expect(result.code).toContain("from '@hammies/frontend/components/ui'")
    // The import should not include Card
    const importMatch = result.code.match(/import \{([^}]*)\} from '@hammies\/frontend\/components\/ui'/)
    expect(importMatch).toBeTruthy()
    expect(importMatch![1]).not.toContain("Card")
  })

  it("strips destructuring from undefined globals and auto-imports instead", async () => {
    const source = `const { Card, CardHeader, CardTitle, CardContent, Badge, Table } = Components;
function App() { return <Card><CardContent><Badge>x</Badge></CardContent></Card> }
export default App`
    const result = await transformArtifactCode(source)
    // The destructuring line should be stripped
    expect(result.code).not.toContain("Components")
    // Components should be auto-imported instead
    const importMatch = result.code.match(/import \{([^}]*)\} from '@hammies\/frontend\/components\/ui'/)
    expect(importMatch).toBeTruthy()
    expect(importMatch![1]).toContain("Card")
    expect(importMatch![1]).toContain("Badge")
    // Should compile without errors
    expect(result.code).toContain("createElement")
  })

  it("wraps bare top-level return in a default App component", async () => {
    const source = `const items = [{ name: 'A' }, { name: 'B' }];

return (
  <div>
    {items.map((item, i) => <span key={i}>{item.name}</span>)}
  </div>
);`
    const result = await transformArtifactCode(source)
    expect(result.exportedName).toBe("App")
    expect(result.code).toContain("createElement")
    // Should not have "return outside of function" error
    expect(result.code).not.toContain("error")
  })

describe("escapeForScript", () => {
  it("escapes </script> tags", async () => {
    expect(escapeForScript('var x = "</script>";')).toBe('var x = "<\\/script>";')
  })

  it("is case-insensitive", async () => {
    const result = escapeForScript("</Script>")
    expect(result).not.toContain("</Script>")
    expect(result).toContain("<\\/script")
  })

  it("does not alter code without </script>", async () => {
    const code = "var x = 1; function App() { return null; }"
    expect(escapeForScript(code)).toBe(code)
  })
})
