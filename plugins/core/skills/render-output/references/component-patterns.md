# Component Patterns

Standard patterns for shadcn/ui components in React artifacts. Follow these exactly.

## Tabs

```jsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@hammies/frontend/components/ui'

<Tabs defaultValue="overview">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="details">Details</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">
    <div className="flex flex-col gap-3">Overview content</div>
  </TabsContent>
  <TabsContent value="details">
    <div className="flex flex-col gap-3">Details content</div>
  </TabsContent>
</Tabs>
```

## Card

```jsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@hammies/frontend/components/ui'

<Card>
  <CardHeader>
    <CardTitle>Revenue Summary</CardTitle>
    <CardDescription>Last 30 days</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="text-2xl font-bold">$12,450</div>
    <p className="text-xs text-muted-foreground">+15% from last month</p>
  </CardContent>
  <CardFooter>
    <Button variant="outline" size="sm">View Details</Button>
  </CardFooter>
</Card>
```

## Table

```jsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@hammies/frontend/components/ui'

<div className="border rounded-lg overflow-hidden">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Amount</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map((item) => (
        <TableRow key={item.id}>
          <TableCell className="font-medium">{item.name}</TableCell>
          <TableCell><Badge variant="outline">{item.status}</Badge></TableCell>
          <TableCell className="text-right">{item.amount}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</div>
```

## Form

```jsx
import { Input, Textarea, Label, Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@hammies/frontend/components/ui'

<div className="flex flex-col gap-4">
  <div className="flex flex-col gap-2">
    <Label>Recipient</Label>
    <Input placeholder="email@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
  </div>
  <div className="flex flex-col gap-2">
    <Label>Priority</Label>
    <Select value={priority} onValueChange={setPriority}>
      <SelectTrigger>
        <SelectValue placeholder="Select priority" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="high">High</SelectItem>
        <SelectItem value="medium">Medium</SelectItem>
        <SelectItem value="low">Low</SelectItem>
      </SelectContent>
    </Select>
  </div>
  <div className="flex flex-col gap-2">
    <Label>Message</Label>
    <Textarea placeholder="Type your message..." value={body} onChange={(e) => setBody(e.target.value)} />
  </div>
  <div className="flex justify-end gap-2">
    <Button variant="outline">Cancel</Button>
    <Button onClick={() => sendAction('submit', { to, priority, body })}>Send</Button>
  </div>
</div>
```

## Badge

```jsx
import { Badge } from '@hammies/frontend/components/ui'

<Badge variant="default">Active</Badge>
<Badge variant="secondary">Pending</Badge>
<Badge variant="outline">Draft</Badge>
<Badge variant="destructive">Failed</Badge>

{/* Custom colors */}
<Badge className="bg-chart-2/20 text-chart-2">Success</Badge>
<Badge className="bg-chart-4/20 text-chart-4">Warning</Badge>
```

## Accordion

```jsx
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@hammies/frontend/components/ui'

<Accordion type="single" collapsible>
  <AccordionItem value="section-1">
    <AccordionTrigger>Section 1</AccordionTrigger>
    <AccordionContent>
      <div className="flex flex-col gap-2">Content here</div>
    </AccordionContent>
  </AccordionItem>
</Accordion>
```

## Alert

```jsx
import { Alert, AlertTitle, AlertDescription } from '@hammies/frontend/components/ui'

<Alert>
  <AlertTitle>Heads up</AlertTitle>
  <AlertDescription>This action cannot be undone.</AlertDescription>
</Alert>

<Alert variant="destructive">
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>Failed to save changes.</AlertDescription>
</Alert>
```

## Avatar

```jsx
import { Avatar, AvatarImage, AvatarFallback } from '@hammies/frontend/components/ui'

<div className="flex items-center gap-2">
  <Avatar className="h-8 w-8">
    <AvatarImage src={user.avatar} />
    <AvatarFallback>{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
  </Avatar>
  <span className="text-sm font-medium">{user.name}</span>
</div>
```

## Skeleton (loading state)

```jsx
import { Skeleton } from '@hammies/frontend/components/ui'

<div className="flex flex-col gap-3">
  <Skeleton className="h-4 w-3/4" />
  <Skeleton className="h-4 w-1/2" />
  <Skeleton className="h-20 w-full" />
</div>
```

## Toggle Group

```jsx
import { ToggleGroup, ToggleGroupItem } from '@hammies/frontend/components/ui'

<ToggleGroup type="single" value={view} onValueChange={setView}>
  <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
  <ToggleGroupItem value="list">List</ToggleGroupItem>
</ToggleGroup>
```

## Common Compositions

### Stat Cards Row

```jsx
<div className="grid grid-cols-3 gap-3">
  {stats.map((s) => (
    <Card key={s.label}>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{s.label}</p>
        <p className="text-xl font-bold">{s.value}</p>
        <p className="text-xs text-muted-foreground">{s.change}</p>
      </CardContent>
    </Card>
  ))}
</div>
```

### Searchable List

```jsx
const [search, setSearch] = useState('')
const filtered = items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))

<div className="flex flex-col gap-3">
  <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
  <div className="flex flex-col">
    {filtered.map((item) => (
      <div key={item.id} className="flex items-center justify-between px-3 py-2.5 border-b hover:bg-secondary cursor-pointer"
           onClick={() => sendAction('select', { id: item.id })}>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{item.name}</span>
          <span className="text-xs text-muted-foreground">{item.description}</span>
        </div>
        <Badge variant="outline">{item.status}</Badge>
      </div>
    ))}
  </div>
</div>
```

### Approval Form with sendAction

```jsx
<Card>
  <CardHeader>
    <CardTitle>Approve Draft</CardTitle>
    <CardDescription>Review before sending</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="text-sm whitespace-pre-wrap">{draftContent}</div>
  </CardContent>
  <CardFooter className="flex justify-end gap-2">
    <Button variant="outline" onClick={() => sendAction('reject', { reason: 'needs revision' })}>
      Reject
    </Button>
    <Button onClick={() => sendAction('approve', { draftId })}>
      Approve & Send
    </Button>
  </CardFooter>
</Card>
```

### Dashboard with Tabs + Charts

```jsx
<Tabs defaultValue="overview">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">
    <div className="grid grid-cols-3 gap-3 mb-4">
      {/* Stat cards */}
    </div>
    {/* Use render_output type:"chart" for actual charts — React artifacts can't import Recharts */}
    <p className="text-xs text-muted-foreground">Charts rendered via separate render_output calls</p>
  </TabsContent>
  <TabsContent value="breakdown">
    {/* Table or detailed view */}
  </TabsContent>
</Tabs>
```
