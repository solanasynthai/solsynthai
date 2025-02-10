import React from 'react';

interface NetworkSelectorProps {
  value: string;
  onChange: (network: string) => void;
  disabled?: boolean;
}

export const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  value,
  onChange,
  disabled = false
}) => {
  const networks = [
    { id: 'devnet', name: 'Devnet', description: 'For testing and development' },
    { id: 'testnet', name: 'Testnet', description: 'For final testing' },
    { id: 'mainnet', name: 'Mainnet', description: 'Production network' }
  ];

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-700">
        Select Network
      </label>
      <div className="grid gap-4">
        {networks.map((network) => (
          <label
            key={network.id}
            className={`
              relative flex cursor-pointer rounded-lg border p-4
              ${value === network.id ? 'border-primary bg-primary-50' : 'border-gray-200'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}
            `}
          >
            <input
              type="radio"
              name="network"
              value={network.id}
              checked={value === network.id}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              className="sr-only"
            />
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center">
                <div className="text-sm">
                  <p className="font-medium text-gray-900">
                    {network.name}
                  </p>
                  <p className="text-gray-500">
                    {network.description}
                  </p>
                </div>
              </div>
              {value === network.id && (
                <div className="shrink-0 text-primary">
                  <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
};
