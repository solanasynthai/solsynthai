import React from 'react';

interface Template {
  id: string;
  name: string;
  description: string;
  complexity: 'Basic' | 'Intermediate' | 'Advanced';
}

interface TemplateSelectorProps {
  selectedTemplate: string;
  onSelect: (templateId: string) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  selectedTemplate,
  onSelect
}) => {
  const templates: Template[] = [
    {
      id: 'token',
      name: 'Token Contract',
      description: 'Basic SPL token with mint and burn capabilities',
      complexity: 'Basic'
    },
    {
      id: 'nft',
      name: 'NFT Collection',
      description: 'NFT collection with metadata and minting limits',
      complexity: 'Intermediate'
    },
    {
      id: 'defi',
      name: 'DeFi Protocol',
      description: 'Simple DeFi protocol with staking and rewards',
      complexity: 'Advanced'
    }
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-gray-900">
        Select Template
      </h3>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <div
            key={template.id}
            className={`
              cursor-pointer rounded-lg border p-4 transition-all
              ${selectedTemplate === template.id 
                ? 'border-primary ring-2 ring-primary ring-opacity-50' 
                : 'border-gray-200 hover:border-gray-300'
              }
            `}
            onClick={() => onSelect(template.id)}
          >
            <h4 className="font-medium text-gray-900">{template.name}</h4>
            <p className="mt-1 text-sm text-gray-500">{template.description}</p>
            <div className="mt-2">
              <span className={`
                inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
                ${template.complexity === 'Basic' ? 'bg-green-100 text-green-800' : ''}
                ${template.complexity === 'Intermediate
