import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useContract } from '../../contexts/ContractContext';
import { useAIGeneration } from '../../hooks/useAIGeneration';
import { AIPromptInput } from '../generation/AIPromptInput';
import { TemplateSelector } from '../generation/TemplateSelector';
import { CodeEditor } from '../editor/CodeEditor';
import { EditorToolbar } from '../editor/EditorToolbar';
import { ContractPreview } from '../editor/ContractPreview';
import { Button } from '../common/Button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useCompilation } from '../../hooks/useCompilation';
import { Storage } from '../../utils/storage';
import { v4 as uuidv4 } from 'uuid';

const ContractGenerator: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { addContract, updateContract } = useContract();
  const { generateCode, generating } = useAIGeneration();
  const { compile, compiling } = useCompilation();

  const [activeTab, setActiveTab] = useState('template');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [contractName, setContractName] = useState('');
  const [contractId, setContractId] = useState('');
  const [compiledCode, setCompiledCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Restore in-progress work from storage
    const savedState = Storage.get('contract_generator_state');
    if (savedState) {
      setSelectedTemplate(savedState.template || '');
      setGeneratedCode(savedState.code || '');
      setContractName(savedState.name || '');
      setContractId(savedState.id || '');
    }
  }, []);

  const saveState = () => {
    Storage.set('contract_generator_state', {
      template: selectedTemplate,
      code: generatedCode,
      name: contractName,
      id: contractId
    });
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    setActiveTab('generate');
  };

  const handleGenerate = async (prompt: string) => {
    setError(null);
    try {
      const code = await generateCode(prompt, selectedTemplate);
      setGeneratedCode(code);
      if (!contractId) {
        setContractId(uuidv4());
      }
      saveState();
      setActiveTab('edit');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code generation failed');
      toast({
        variant: 'destructive',
        title: 'Generation Error',
        description: err instanceof Error ? err.message : 'Failed to generate code'
      });
    }
  };

  const handleCodeChange = (code: string) => {
    setGeneratedCode(code);
    saveState();
  };

  const handleCompile = async () => {
    setError(null);
    try {
      const compiled = await compile(generatedCode);
      setCompiledCode(compiled);
      
      if (contractId) {
        updateContract(contractId, {
          name: contractName || 'Untitled Contract',
          code: generatedCode,
          compiledCode: compiled,
          template: selectedTemplate,
          status: 'compiled'
        });
      } else {
        const newId = uuidv4();
        setContractId(newId);
        addContract({
          id: newId,
          name: contractName || 'Untitled Contract',
          code: generatedCode,
          compiledCode: compiled,
          template: selectedTemplate,
          status: 'compiled'
        });
      }

      toast({
        title: 'Compilation Successful',
        description: 'Your contract has been compiled successfully.'
      });

      navigate(`/deploy/${contractId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compilation failed');
      toast({
        variant: 'destructive',
        title: 'Compilation Error',
        description: err instanceof Error ? err.message : 'Failed to compile code'
      });
    }
  };

  const handleSave = () => {
    if (!contractName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please provide a name for your contract'
      });
      return;
    }

    if (contractId) {
      updateContract(contractId, {
        name: contractName,
        code: generatedCode,
        template: selectedTemplate,
        status: 'draft'
      });
    } else {
      const newId = uuidv4();
      setContractId(newId);
      addContract({
        id: newId,
        name: contractName,
        code: generatedCode,
        template: selectedTemplate,
        status: 'draft'
      });
    }

    saveState();
    toast({
      title: 'Contract Saved',
      description: 'Your contract has been saved successfully.'
    });
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Contract Generator</h1>
        <p className="text-gray-600">Create your Solana smart contract using AI or templates</p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="template">Select Template</TabsTrigger>
          <TabsTrigger value="generate" disabled={!selectedTemplate}>Generate</TabsTrigger>
          <TabsTrigger value="edit" disabled={!generatedCode}>Edit</TabsTrigger>
        </TabsList>

        <TabsContent value="template">
          <Card className="p-6">
            <TemplateSelector
              selectedTemplate={selectedTemplate}
              onSelect={handleTemplateSelect}
            />
          </Card>
        </TabsContent>

        <TabsContent value="generate">
          <Card className="p-6">
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Contract Name
              </label>
              <input
                type="text"
                value={contractName}
                onChange={(e) => setContractName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Enter contract name"
              />
            </div>
            <AIPromptInput
              onGenerate={handleGenerate}
              onError={setError}
            />
          </Card>
        </TabsContent>

        <TabsContent value="edit">
          <Card className="p-6">
            <EditorToolbar
              onSave={handleSave}
              onCompile={handleCompile}
              onDeploy={() => navigate(`/deploy/${contractId}`)}
              canDeploy={!!compiledCode}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <div className="space-y-4">
                <CodeEditor
                  initialValue={generatedCode}
                  onChange={handleCodeChange}
                  language="rust"
                />
              </div>
              <div className="space-y-4">
                <ContractPreview contractId={contractId} />
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex justify-between">
        <Button
          variant="secondary"
          onClick={() => navigate('/')}
        >
          Cancel
        </Button>
        <div className="space-x-4">
          <Button
            variant="secondary"
            onClick={handleSave}
            disabled={!generatedCode || !contractName}
          >
            Save Draft
          </Button>
          <Button
            variant="primary"
            onClick={handleCompile}
            loading={compiling}
            disabled={!generatedCode || !contractName}
          >
            Compile & Deploy
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ContractGenerator;
