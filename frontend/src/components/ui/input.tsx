import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Eye, EyeOff, X } from "lucide-react"

const inputVariants = cva(
  "flex w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-input",
        error: "border-destructive focus-visible:ring-destructive",
        success: "border-success focus-visible:ring-success",
        warning: "border-warning focus-visible:ring-warning",
      },
      size: {
        default: "h-10",
        sm: "h-8 px-2 text-xs",
        lg: "h-12 px-4 text-base",
      },
      width: {
        default: "w-full",
        auto: "w-auto",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      width: "default",
    },
  }
)

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  icon?: React.ReactNode
  iconPosition?: "left" | "right"
  clearable?: boolean
  onClear?: () => void
  loading?: boolean
  error?: string
  type?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ 
    className,
    variant,
    size,
    width,
    type = "text",
    icon,
    iconPosition = "left",
    clearable = false,
    onClear,
    loading = false,
    error,
    disabled,
    value,
    onChange,
    ...props 
  }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false)
    const isPassword = type === "password"
    const inputType = isPassword ? (showPassword ? "text" : "password") : type

    const handleClear = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (onChange) {
        const event = {
          target: { value: "" }
        } as React.ChangeEvent<HTMLInputElement>
        onChange(event)
      }
      onClear?.()
    }

    return (
      <div className="relative w-full">
        <div className="relative">
          <input
            type={inputType}
            className={cn(
              inputVariants({ variant: error ? "error" : variant, size, width }),
              icon && iconPosition === "left" && "pl-10",
              (clearable || isPassword) && "pr-10",
              loading && "pr-10",
              className
            )}
            ref={ref}
            disabled={disabled || loading}
            value={value}
            onChange={onChange}
            {...props}
          />
          
          {icon && (
            <span 
              className={cn(
                "absolute inset-y-0 flex items-center text-muted-foreground",
                iconPosition === "left" ? "left-3" : "right-3"
              )}
            >
              {icon}
            </span>
          )}

          {loading && (
            <div className="absolute inset-y-0 right-3 flex items-center">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground" />
            </div>
          )}

          {!loading && clearable && value && (
            <button
              onClick={handleClear}
              className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {!loading && isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {error && (
          <p className="mt-1 text-xs text-destructive">{error}</p>
        )}
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input, inputVariants }
