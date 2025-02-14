import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Combines class names using clsx and tailwind-merge
 * Ensures proper merging of Tailwind CSS classes while handling conditional classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a wallet address for display
 * @param address - The full wallet address
 * @param startChars - Number of characters to show at start
 * @param endChars - Number of characters to show at end
 */
export function formatAddress(address: string, startChars = 4, endChars = 4): string {
  if (!address) return ""
  if (address.length <= startChars + endChars) return address
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`
}

/**
 * Formats a number as SOL with appropriate decimals
 * @param lamports - Number in lamports
 * @param decimals - Number of decimal places to show
 */
export function formatSOL(lamports: number, decimals = 4): string {
  const sol = lamports / 1e9
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(sol)
}

/**
 * Debounces a function
 * @param fn - Function to debounce
 * @param ms - Debounce delay in milliseconds
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms = 300
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>
  return function (this: any, ...args: Parameters<T>) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn.apply(this, args), ms)
  }
}

/**
 * Creates a type-safe event emitter
 * @param events - Array of valid event names
 */
export function createTypedEventEmitter<T extends string>() {
  type Listener = (...args: any[]) => void
  const listeners = new Map<T, Set<Listener>>()

  return {
    on(event: T, fn: Listener) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set())
      }
      listeners.get(event)!.add(fn)
      return () => this.off(event, fn)
    },

    off(event: T, fn: Listener) {
      listeners.get(event)?.delete(fn)
    },

    emit(event: T, ...args: any[]) {
      listeners.get(event)?.forEach(fn => fn(...args))
    },

    clear() {
      listeners.clear()
    }
  }
}

/**
 * Validates a transaction signature
 * @param signature - Transaction signature to validate
 */
export function isValidSignature(signature: string): boolean {
  return /^[A-Za-z0-9]{87,88}$/.test(signature)
}

/**
 * Deep clones an object
 * @param obj - Object to clone
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj
  if (obj instanceof Date) return new Date(obj) as any
  if (obj instanceof Array) return obj.map(item => deepClone(item)) as any
  if (obj instanceof Object) {
    const copy = { ...obj }
    Object.keys(copy).forEach(
      key => (copy[key] = deepClone(obj[key]))
    )
    return copy as T
  }
  throw new Error(`Unable to copy obj! Its type isn't supported.`)
}

/**
 * Checks if WebAssembly is supported in the current environment
 */
export async function checkWasmSupport(): Promise<boolean> {
  try {
    if (typeof WebAssembly === "object") {
      const module = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]))
      if (module instanceof WebAssembly.Module) {
        const instance = new WebAssembly.Instance(module)
        return instance instanceof WebAssembly.Instance
      }
    }
  } catch {}
  return false
}

/**
 * Retries an async function with exponential backoff
 * @param fn - Function to retry
 * @param maxAttempts - Maximum number of attempts
 * @param baseDelay - Base delay between attempts in ms
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (attempt === maxAttempts) break
      await new Promise(resolve => 
        setTimeout(resolve, baseDelay * Math.pow(2, attempt - 1))
      )
    }
  }

  throw lastError!
}
