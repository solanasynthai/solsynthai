import React from 'react';
import { Button } from '../common/Button';
import { useCompilation } from '../../hooks/useCompilation';
import { useDeployment } from '../../hooks/useDeployment';

interface EditorToolbarProps {
  onSave: () => void;
  onCompile: () => void;
  onDeploy: () => void;
  canDeploy: boolean;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  onSave,
  onCompile,
  onDeploy,
  canDeploy
}) => {
  const { compiling } = useCompilation();
  const { deploying } = useDeployment();

  return (
    <div className="border-b bg-white px-4 py-2 flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={onSave}
        >
          Save
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onCompile}
          loading={compiling}
        >
          Compile
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onDeploy}
          disabled={!canDeploy}
          loading={deploying}
        >
          Deploy
        </Button>
      </div>
      <div className="flex items-center space-x-2">
        <select className="border rounded px-2 py-1 text-sm">
          <option value="rust">Rust</option>
          <option value="typescript">TypeScript</option>
        </select>
        <Button
          variant="secondary"
          size="sm"
        >
          Settings
        </Button>
      </div>
    </div>
  );
};
