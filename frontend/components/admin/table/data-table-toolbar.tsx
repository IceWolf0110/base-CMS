"use client"

import { ChevronDownIcon, Columns3Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsMobile } from "@/hooks/use-mobile"

export type DataTableColumnOption = {
  id: string
  visible: boolean
  onVisibilityChange: (visible: boolean) => void
}

type DataTableToolbarProps = {
  columns: DataTableColumnOption[]
}

export function DataTableToolbar({ columns }: DataTableToolbarProps) {
  const isMobile = useIsMobile()

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size={isMobile ? "sm" : "default"} />
          }
        >
          <Columns3Icon data-icon="inline-start" />
          Columns
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              className="capitalize"
              checked={column.visible}
              onCheckedChange={(value) => column.onVisibilityChange(!!value)}
            >
              {column.id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
