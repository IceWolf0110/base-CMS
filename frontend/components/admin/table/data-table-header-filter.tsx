import { Input } from "@/components/admin/input"
import { useIsMobile } from "@/hooks/use-mobile"

type DataTableHeaderFilterProps = {
  value: string
  onChange: (value: string) => void
}

export function DataTableHeaderFilter({
  value,
  onChange,
}: DataTableHeaderFilterProps) {
  const isMobile = useIsMobile()
  
  return (
    <Input
      aria-label="Search headers"
      className="w-2/3 lg:w-1/4"
      placeholder="Search headers..."
      value={value}
      size={isMobile ? "sm" : "default"}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
