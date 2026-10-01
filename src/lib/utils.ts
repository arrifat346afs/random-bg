import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware class joiner (shadcn/ui standard). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
