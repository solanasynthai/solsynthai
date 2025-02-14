import React from 'react';
import { Alert as AlertBase, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

interface AlertProps {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  title?: string;
  children: React.ReactNode;
  className?: string;
}

const iconMap = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
};

export const Alert: React.FC<AlertProps> = ({
  variant = 'default',
  title,
  children,
  className = ''
}) => {
  const Icon = iconMap[variant];

  return (
    <AlertBase variant={variant === 'info' ? 'default' : variant} className={className}>
      <Icon className="h-4 w-4" />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </AlertBase>
  );
};
