"use client"

import * as React from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface ComboboxProps<T = string> {
  items: T[]
  value?: T
  onValueChange?: (value: T) => void
  placeholder?: string
  emptyText?: string
  itemToStringValue?: (item: T) => string
  itemToFontFamily?: (item: T) => string
  className?: string
  disabled?: boolean
}

export function Combobox<T = string>({
  items,
  value,
  onValueChange,
  placeholder = "Select item...",
  emptyText = "No items found.",
  itemToStringValue = (item) => String(item),
  itemToFontFamily,
  className,
  disabled,
}: ComboboxProps<T>) {
  const [open, setOpen] = React.useState(false)

  const displayValue = value ? itemToStringValue(value) : placeholder
  const selectedFontFamily = value && itemToFontFamily ? itemToFontFamily(value) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
          disabled={disabled}
          style={selectedFontFamily ? { fontFamily: selectedFontFamily } : undefined}
        >
          {displayValue}
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => {
                const itemValue = itemToStringValue(item)
                const isSelected = value === item
                const fontFamily = itemToFontFamily ? itemToFontFamily(item) : undefined
                return (
                  <CommandItem
                    key={itemValue}
                    value={itemValue}
                    onSelect={() => {
                      onValueChange?.(item)
                      setOpen(false)
                    }}
                    style={fontFamily ? { fontFamily } : undefined}
                  >
                    <CheckIcon
                      className={cn(
                        "mr-2 h-4 w-4",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {itemValue}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
