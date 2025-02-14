import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { customAlphabet } from 'nanoid';
import { toast } from "sonner";

// Tailwind CSS class merging utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Generate unique IDs for components
export const generateId = customAlphabet(
  '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  16
);

// Format currency values
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Format SOL amounts
export function formatSOL(lamports: number): string {
  return `${(lamports / 1e9).toFixed(9)} SOL`;
}

// Format wallet address
export function formatAddress(address: string, length: number = 4): string {
  if (!address) return '';
  return `${address.slice(0, length)}...${address.slice(-length)}`;
}

// Debounce function
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Async sleep utility
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Parse error messages
export function parseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred';
}

// Handle async operations with loading state
export async function withLoading<T>(
  operation: () => Promise<T>,
  loadingMessage: string = 'Processing...',
  successMessage?: string
): Promise<T | undefined> {
  const toastId = toast.loading(loadingMessage);
  
  try {
    const result = await operation();
    if (successMessage) {
      toast.success(successMessage, { id: toastId });
    } else {
      toast.dismiss(toastId);
    }
    return result;
  } catch (error) {
    toast.error(parseError(error), { id: toastId });
    return undefined;
  }
}

// Validate form input
export function validateInput<T>(
  value: T,
  validators: ((value: T) => string | undefined)[]
): string | undefined {
  for (const validator of validators) {
    const error = validator(value);
    if (error) return error;
  }
}

// Local storage wrapper
export const storage = {
  get: <T>(key: string, defaultValue?: T): T | undefined => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },
  
  set: <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Error saving to localStorage:`, error);
    }
  },
  
  remove: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Error removing from localStorage:`, error);
    }
  }
};

// Theme management
export const theme = {
  get: () => storage.get<'light' | 'dark'>('theme', 'light'),
  set: (theme: 'light' | 'dark') => {
    storage.set('theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
};

// Copy to clipboard
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
    return true;
  } catch (error) {
    console.error('Failed to copy:', error);
    toast.error('Failed to copy to clipboard');
    return false;
  }
}

// Download file
export function downloadFile(content: string, filename: string, type: string = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Date formatting
export function formatDate(date: Date | string, locale: string = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(date));
}

// Retry operation with exponential backoff
export async function retry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let attempt = 0;
  let lastError: Error;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      attempt++;
      
      if (attempt === maxAttempts) break;
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError!;
}
