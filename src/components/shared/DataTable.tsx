import { useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hammies/frontend/components/ui"
import { Input } from "@hammies/frontend/components/ui/input"
import { Button } from "@hammies/frontend/components/ui/button"
import { ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react"

interface DataTableProps {
  /** Column names */
  columns: string[]
  /** Row data — each row is an array of cell values matching the column order */
  rows: unknown[][]
  /** Enable search/filter input (default: true if > 5 rows) */
  searchable?: boolean
  /** Enable pagination (default: true if > 20 rows) */
  paginated?: boolean
  /** Rows per page (default: 20) */
  pageSize?: number
}

export function DataTable({
  columns,
  rows,
  searchable,
  paginated,
  pageSize = 20,
}: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState("")

  const shouldSearch = searchable ?? rows.length > 5
  const shouldPaginate = paginated ?? rows.length > pageSize

  // Build TanStack column definitions from string column names
  const columnDefs: ColumnDef<unknown[]>[] = columns.map((name, index) => ({
    id: `col-${index}`,
    accessorFn: (row: unknown[]) => row[index],
    header: ({ column }) => (
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground transition-colors -ml-2 px-2 py-1 rounded-md hover:bg-secondary"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        <span>{name}</span>
        <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
      </button>
    ),
    cell: ({ getValue }) => {
      const value = getValue()
      if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
      return String(value)
    },
  }))

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(shouldPaginate
      ? { getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize } } }
      : {}),
  })

  return (
    <div className="flex flex-col gap-2">
      {shouldSearch && (
        <div className="px-1">
          <Input
            placeholder="Filter..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="h-8 text-xs max-w-xs"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="whitespace-nowrap">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="text-xs">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-16 text-center text-xs text-muted-foreground">
                  No results
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {shouldPaginate && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            {table.getFilteredRowModel().rows.length} row{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="h-7 w-7 p-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="h-7 w-7 p-0"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
