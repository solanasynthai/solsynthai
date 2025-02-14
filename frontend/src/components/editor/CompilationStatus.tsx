import React, { useMemo } from 'react';
import { Check, AlertTriangle, X, Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '../common/Button';

interface CompilationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

interface CompilationStatusProps {
  status: 'idle' | 'compiling' | 'success' | 'error';
  errors?: CompilationError[];
  warnings?: CompilationError[];
  onErrorClick?: (line: number, column: number) => void;
  onClear?: () => void;
}

const CompilationStatus: React.FC<CompilationStatusProps> = ({
  status,
  errors = [],
  warnings = [],
  onErrorClick,
  onClear
}) => {
  const statusIcon = useMemo(() => {
    switch (status) {
      case 'compiling':
        return <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />;
      case 'success':
        return <Check className="h-5 w-5 text-green-500" />;
      case 'error':
        return <X className="h-5 w-5 text-red-500" />;
      default:
        return null;
    }
  }, [status]);

  const statusText = useMemo(() => {
    switch (status) {
      case 'compiling':
        return 'Compiling...';
      case 'success':
        return 'Compilation successful';
      case 'error':
        return 'Compilation failed';
      default:
        return 'Ready to compile';
    }
  }, [status]);

  const statusColor = useMemo(() => {
    switch (status) {
      case 'compiling':
        return 'text-yellow-500';
      case 'success':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  }, [status]);

  const renderIssue = (issue: CompilationError, type: 'error' | 'warning') => {
    const isError = type === 'error';
    return (
      <div
        key={`${issue.line}-${issue.column}-${issue.message}`}
        className={`flex items-start space-x-2 p-2 rounded ${
          isError ? 'bg-red-50' : 'bg-yellow-50'
        } mb-2 cursor-pointer hover:bg-opacity-75 transition-colors`}
        onClick={() => onErrorClick?.(issue.line, issue.column)}
      >
        {isError ? (
          <X className="h-5 w-5 text-red-500 mt-0.5" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5" />
        )}
        <div className="flex-1">
          <div className={`font-medium ${isError ? 'text-red-700' : 'text-yellow-700'}`}>
            Line {issue.line}, Column {issue.column}
          </div>
          <div className={isError ? 'text-red-600' : 'text-yellow-600'}>
            {issue.message}
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (status === 'idle') {
      return (
        <div className="text-center py-4 text-gray-500">
          No compilation results yet
        </div>
      );
    }

    if (status === 'compiling') {
      return (
        <div className="text-center py-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-gray-600">Compiling your contract...</p>
        </div>
      );
    }

    if (status === 'success' && !errors.length && !warnings.length) {
      return (
        <Alert className="bg-green-50 border-green-200">
          <Check className="h-4 w-4 text-green-500" />
          <AlertTitle>Compilation Successful</AlertTitle>
          <AlertDescription>
            Your contract has been compiled successfully with no issues.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <ScrollArea className="h-[400px] pr-4">
        {errors.length > 0 && (
          <div className="mb-4">
            <h3 className="text-red-700 font-medium mb-2">
              Errors ({errors.length})
            </h3>
            {errors.map(error => renderIssue(error, 'error'))}
          </div>
        )}
        
        {warnings.length > 0 && (
          <div>
            <h3 className="text-yellow-700 font-medium mb-2">
              Warnings ({warnings.length})
            </h3>
            {warnings.map(warning => renderIssue(warning, 'warning'))}
          </div>
        )}
      </ScrollArea>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            {statusIcon}
            <span className={statusColor}>{statusText}</span>
          </CardTitle>
          {(errors.length > 0 || warnings.length > 0) && (
            <CardDescription>
              {errors.length} error{errors.length !== 1 ? 's' : ''}, {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
            </CardDescription>
          )}
        </div>
        {status !== 'idle' && status !== 'compiling' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
          >
            Clear
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {renderContent()}
      </CardContent>
    </Card>
  );
};

export default CompilationStatus;
