
"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

type ComboboxOption = {
    value: string
    label: string
}

type ComboBoxProps = {
    options: ComboboxOption[]
    value?: string
    onSelect: (value: string) => void
    placeholder?: string
    searchPlaceholder?: string
    emptyState?: string
    disabled?: boolean
}

export function ComboBox({
    options,
    value,
    onSelect,
    placeholder = "Select an option",
    searchPlaceholder = "Search...",
    emptyState = "No options found.",
    disabled = false
}: ComboBoxProps) {
  const [open, setOpen] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState("")

  const filteredOptions = React.useMemo(() => {
    if (!searchValue) return options;
    return options.filter(option => 
      option.label.toLowerCase().includes(searchValue.toLowerCase())
    );
  }, [options, searchValue])

  const selectedLabel = options.find((option) => option.value === value)?.label

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          {value ? selectedLabel : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <div className="p-2">
          <Input 
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="h-9"
          />
        </div>
        <ScrollArea className="h-60">
            <div className="p-1">
            {filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                <Button
                    key={option.value}
                    variant="ghost"
                    className="w-full justify-start font-normal"
                    onClick={() => {
                        onSelect(option.value)
                        setOpen(false)
                    }}
                >
                    <Check
                    className={cn(
                        "mr-2 h-4 w-4",
                        value === option.value ? "opacity-100" : "opacity-0"
                    )}
                    />
                    {option.label}
                </Button>
                ))
            ) : (
                <p className="p-4 text-center text-sm text-muted-foreground">{emptyState}</p>
            )}
            </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

    