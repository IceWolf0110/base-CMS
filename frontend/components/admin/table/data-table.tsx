"use client"

import * as React from "react"
import {
  FlexRender,
  useTable,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type SortingState,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { columns } from "./data-table-columns"
import { DataTableHeaderFilter } from "./data-table-header-filter"
import { DataTablePagination } from "./data-table-pagination"
import { DataTableToolbar } from "./data-table-toolbar"
import { features, type DataTableItem } from "./data-table-schema"

export function DataTable({ data }: { data: DataTableItem[] }) {
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({})

  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])

  const [sorting, setSorting] = React.useState<SortingState>([])

  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })

  const table = useTable({
    features,
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
  })

  const columnOptions = table
    .getAllColumns()
    .filter(
      (column) =>
        typeof column.accessorFn !== "undefined" && column.getCanHide()
    )
    .map((column) => ({
      id: column.id,
      visible: column.getIsVisible(),
      onVisibilityChange: (visible: boolean) =>
        column.toggleVisibility(visible),
    }))

  const headerFilter =
    (table.getColumn("header")?.getFilterValue() as string) ?? ""

  function handleHeaderFilterChange(value: string) {
    table.getColumn("header")?.setFilterValue(value)
    table.setPageIndex(0)
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap justify-between items-center gap-2 px-4 lg:px-6">
        <DataTableHeaderFilter
          value={headerFilter}
          onChange={handleHeaderFilterChange}
        />

        <DataTableToolbar columns={columnOptions} />
      </div>

      <div className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder ? null : (
                        <FlexRender header={header} />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>

            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={table.getVisibleLeafColumns().length}
                    className="h-24 text-center"
                  >
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <DataTablePagination
          totalRows={table.getFilteredRowModel().rows.length}
          pageIndex={table.state.pagination.pageIndex}
          pageCount={table.getPageCount()}
          pageSize={table.state.pagination.pageSize}
          canPreviousPage={table.getCanPreviousPage()}
          canNextPage={table.getCanNextPage()}
          onPageSizeChange={(pageSize) => table.setPageSize(pageSize)}
          onFirstPage={() => table.setPageIndex(0)}
          onPreviousPage={() => table.previousPage()}
          onNextPage={() => table.nextPage()}
          onLastPage={() => table.setPageIndex(table.getPageCount() - 1)}
        />
      </div>
    </div>
  )
}