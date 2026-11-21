"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export type ComboboxOption = {
  value: string
  label: string
  disabled?: boolean
}

type ComboboxProps = {
  options: ComboboxOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  id?: string
  className?: string
  contentClassName?: string
  "aria-invalid"?: boolean
  "aria-label"?: string
}

// Figma 02 Combobox `4:117`: a Select-look field (40 high, radius/lg, chevron-down)
// that opens a searchable list. Open = 2px ring border; list = popover fill,
// radius/xl, elevation/2, 4px padding, 32px radius/sm items.
function Combobox({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  disabled,
  id,
  className,
  contentClassName,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const value = valueProp ?? uncontrolled
  const selected = options.find((option) => option.value === value)

  function select(next: string) {
    if (valueProp === undefined) setUncontrolled(next)
    onValueChange?.(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          disabled={disabled}
          data-slot="combobox-trigger"
          className={cn(
            "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm text-foreground transition-[border-color,box-shadow] outline-none focus-visible:border-primary focus-visible:shadow-focus-ring aria-invalid:border-destructive data-[state=open]:border-ring data-[state=open]:shadow-[inset_0_0_0_1px_var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        data-slot="combobox-content"
        className={cn(
          "w-(--radix-popover-trigger-width) rounded-xl border-border p-0 shadow-elevation-2",
          contentClassName
        )}
      >
        <Command className="rounded-xl">
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="p-1">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup className="p-0">
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  disabled={option.disabled}
                  onSelect={() => select(option.value)}
                  className="h-8 py-1"
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.value === value ? <CheckIcon className="size-4" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { Combobox }
