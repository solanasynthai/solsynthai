import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const cardVariants = cva(
  "rounded-xl border bg-card text-card-foreground shadow transition-all duration-200",
  {
    variants: {
      variant: {
        default: "border-border",
        destructive: "border-destructive/50 bg-destructive/10",
        success: "border-success/50 bg-success/10",
        warning: "border-warning/50 bg-warning/10",
        info: "border-info/50 bg-info/10",
        ghost: "border-transparent bg-background/50 shadow-none backdrop-blur",
        elevated: "border-none shadow-lg hover:shadow-xl",
        gradient: "border-none bg-gradient-to-br from-primary/10 to-secondary/10",
      },
      hover: {
        true: "hover:border-primary/50 hover:shadow-md",
        false: "",
      },
      clickable: {
        true: "cursor-pointer active:scale-[0.99] transition-transform",
        false: "",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
      size: {
        sm: "p-4",
        default: "p-6",
        lg: "p-8",
      },
    },
    defaultVariants: {
      variant: "default",
      hover: false,
      clickable: false,
      fullWidth: false,
      size: "default",
    },
  }
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  asChild?: boolean
  loading?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, hover, clickable, fullWidth, size, loading, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        cardVariants({ variant, hover, clickable, fullWidth, size }),
        loading && "animate-pulse",
        className
      )}
      {...props}
    />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    actions?: React.ReactNode
  }
>(({ className, actions, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 pb-4", className)}
    {...props}
  >
    <div className="flex items-center justify-between">
      <div className="flex-1">{props.children}</div>
      {actions && (
        <div className="flex items-center space-x-2">{actions}</div>
      )}
    </div>
  </div>
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement> & { as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" }
>(({ className, as: Comp = "h3", ...props }, ref) => (
  <Comp
    ref={ref}
    className={cn(
      "font-semibold leading-none tracking-tight",
      {
        "text-2xl": Comp === "h1",
        "text-xl": Comp === "h2",
        "text-lg": Comp === "h3",
        "text-base": Comp === "h4" || Comp === "h5" || Comp === "h6",
      },
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div 
    ref={ref} 
    className={cn("pt-0", className)} 
    {...props} 
  />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    actions?: React.ReactNode
    divider?: boolean
  }
>(({ className, actions, divider = true, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center pt-4",
      divider && "border-t",
      className
    )}
    {...props}
  >
    <div className="flex-1">{props.children}</div>
    {actions && (
      <div className="flex items-center space-x-2">{actions}</div>
    )}
  </div>
))
CardFooter.displayName = "CardFooter"

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
}
