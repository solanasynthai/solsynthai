import React from 'react';
import { useContract } from '../../contexts/ContractContext';

interface ContractPreviewProps {
  contractId: string;
}

export const ContractPreview: React.FC<ContractPreviewProps> = ({ contractId }) => {
  const { contracts } = useContract();
  const contract = contracts.find(c => c.id === contractId);

  if (!contract) {
    return (
      <div className="p-4 bg-gray-100 rounded-lg">
        <p className="text-gray-500">Contract not found</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 border-b">
        <h3 className="font-medium">{contract.name}</h3>
        <p className="text-sm text-gray-500">Status: {contract.status}</p>
      </div>
      <div className="p-4">
        <pre className="bg-gray-50 p-4 rounded overflow-x-auto">
          <code>{contract.code}</code>
        </pre>
      </div>
    </div>
  );
};
