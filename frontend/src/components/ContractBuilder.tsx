import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useContractStore } from '../stores/ContractStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAnalytics } from '../hooks/useAnalytics'
import { Editor } from '@monaco-editor/react'
import { 
  Button,
  Select,
  Slider,
  Switch,
  Tooltip,
  notification,
  Spin,
  Progress,
  Space,
  Tabs,
  Modal
} from 'antd'
import {
  PlayCircleOutlined,
  SaveOutlined,
  CodeOutlined,
  SecurityScanOutlined,
  SettingOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import { debounce } from 'lodash'
import { Contract, GenerationOptions } from '../types'
import { formatCode, validateSyntax } from '../utils/codeUtils'
import styles from './ContractBuilder.module.scss'

const { TabPane } = Tabs
const { Option } = Select

interface Props {
  initialContract?: Contract
  onSave?: (contract: Contract) => void
  readOnly?: boolean
}

export const ContractBuilder: React.FC<Props> = ({
  initialContract,
  onSave,
  readOnly = false
}) => {
  const [activeTab, setActiveTab] = useState('editor')
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const editorRef = useRef<any>(null)
  
  const {
    contract,
    setContract,
    generateContract,
    analyzeContract,
    compileContract,
    saveContract,
    loadTemplate
  } = useContractStore()

  const { trackEvent } = useAnalytics()
  
  const { 
    sendMessage,
    lastMessage,
    connectionStatus
  } = useWebSocket()

  const [options, setOptions] = useState<GenerationOptions>({
    security: 'high',
    optimization: 'medium',
    testing: true,
    autoFormat: true,
    liveAnalysis: true
  })

  // Initialize editor with contract
  useEffect(() => {
    if (initialContract) {
      setContract(initialContract)
    }
  }, [initialContract, setContract])

  // Handle WebSocket messages
  useEffect(() => {
    if (lastMessage?.type === 'generation_progress') {
      setProgress(lastMessage.payload.progress)
    }
  }, [lastMessage])

  // Debounced analysis
  const debouncedAnalysis = useCallback(
    debounce(async (code: string) => {
      if (options.liveAnalysis && code) {
        try {
          await analyzeContract(code)
        } catch (error) {
          console.error('Analysis failed:', error)
        }
      }
    }, 1000),
    [analyzeContract, options.liveAnalysis]
  )

  // Handle code changes
  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      if (!value) return

      setContract({ ...contract, code: value })
      debouncedAnalysis(value)

      if (options.autoFormat) {
        const formatted = formatCode(value)
        if (formatted !== value) {
          editorRef.current?.setValue(formatted)
        }
      }
    },
    [contract, setContract, debouncedAnalysis, options.autoFormat]
  )

  // Generate contract
  const handleGenerate = async () => {
    try {
      setIsGenerating(true)
      trackEvent('contract_generation_started', { options })

      const result = await generateContract(options)
      setContract(result)
      
      notification.success({
        message: 'Contract Generated',
        description: 'Your contract has been successfully generated.'
      })

      trackEvent('contract_generation_completed', {
        success: true,
        contractSize: result.code.length
      })

    } catch (error) {
      notification.error({
        message: 'Generation Failed',
        description: (error as Error).message
      })

      trackEvent('contract_generation_failed', {
        error: (error as Error).message
      })

    } finally {
      setIsGenerating(false)
      setProgress(0)
    }
  }

  // Save contract
  const handleSave = async () => {
    try {
      if (!validateSyntax(contract.code)) {
        throw new Error('Contract contains syntax errors')
      }

      await saveContract(contract)
      onSave?.(contract)

      notification.success({
        message: 'Contract Saved',
        description: 'Your contract has been saved successfully.'
      })

      trackEvent('contract_saved', {
        contractSize: contract.code.length
      })

    } catch (error) {
      notification.error({
        message: 'Save Failed',
        description: (error as Error).message
      })
    }
  }

  // Compile contract
  const handleCompile = async () => {
    try {
      const result = await compileContract(contract.code)
      
      notification.success({
        message: 'Compilation Successful',
        description: `Program size: ${result.programSize} bytes`
      })

      trackEvent('contract_compiled', {
        success: true,
        programSize: result.programSize
      })

    } catch (error) {
      notification.error({
        message: 'Compilation Failed',
        description: (error as Error).message
      })

      trackEvent('contract_compiled', {
        success: false,
        error: (error as Error).message
      })
    }
  }

  // Load template
  const handleTemplateLoad = async (templateId: string) => {
    try {
      const template = await loadTemplate(templateId)
      setContract(template)

      notification.success({
        message: 'Template Loaded',
        description: 'Template has been loaded successfully.'
      })

    } catch (error) {
      notification.error({
        message: 'Template Load Failed',
        description: (error as Error).message
      })
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Space>
          <Select
            defaultValue="default"
            style={{ width: 200 }}
            onChange={handleTemplateLoad}
            disabled={readOnly || isGenerating}
          >
            <Option value="default">Select Template</Option>
            <Option value="token">Token Contract</Option>
            <Option value="nft">NFT Contract</Option>
            <Option value="defi">DeFi Contract</Option>
            <Option value="game">Game Contract</Option>
          </Select>

          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleGenerate}
            loading={isGenerating}
            disabled={readOnly}
          >
            Generate
          </Button>

          <Button
            icon={<SaveOutlined />}
            onClick={handleSave}
            disabled={readOnly || isGenerating}
          >
            Save
          </Button>

          <Button
            icon={<CodeOutlined />}
            onClick={handleCompile}
            disabled={!contract.code || isGenerating}
          >
            Compile
          </Button>

          <Tooltip title="Settings">
            <Button
              icon={<SettingOutlined />}
              onClick={() => setShowSettings(true)}
            />
          </Tooltip>

          {connectionStatus === 'connected' ? (
            <Tooltip title="Connected to server">
              <span className={styles.statusConnected} />
            </Tooltip>
          ) : (
            <Tooltip title="Disconnected">
              <span className={styles.statusDisconnected} />
            </Tooltip>
          )}
        </Space>
      </div>

      {isGenerating && (
        <Progress
          percent={progress}
          status="active"
          strokeColor={{
            '0%': '#108ee9',
            '100%': '#87d068',
          }}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className={styles.tabs}
      >
        <TabPane tab="Editor" key="editor">
          <div className={styles.editor}>
            <Editor
              height="70vh"
              defaultLanguage="rust"
              value={contract.code}
              onChange={handleCodeChange}
              options={{
                readOnly,
                minimap: { enabled: true },
                fontSize: 14,
                formatOnPaste: options.autoFormat,
                formatOnType: options.autoFormat,
                scrollBeyondLastLine: false,
                renderWhitespace: 'selection',
                tabSize: 4,
                insertSpaces: true,
                wordWrap: 'on'
              }}
              onMount={(editor) => {
                editorRef.current = editor
              }}
              loading={<Spin size="large" />}
            />
          </div>
        </TabPane>

        <TabPane 
          tab={
            <span>
              <SecurityScanOutlined />
              Analysis
            </span>
          }
          key="analysis"
        >
          {contract.analysis && (
            <div className={styles.analysis}>
              {/* Analysis content */}
            </div>
          )}
        </TabPane>
      </Tabs>

      <Modal
        title="Settings"
        visible={showSettings}
        onCancel={() => setShowSettings(false)}
        footer={null}
      >
        <div className={styles.settings}>
          <div className={styles.setting}>
            <label>Security Level</label>
            <Select
              value={options.security}
              onChange={(value) => setOptions({ ...options, security: value })}
            >
              <Option value="high">High</Option>
              <Option value="medium">Medium</Option>
              <Option value="low">Low</Option>
            </Select>
          </div>

          <div className={styles.setting}>
            <label>Optimization Level</label>
            <Select
              value={options.optimization}
              onChange={(value) => setOptions({ ...options, optimization: value })}
            >
              <Option value="high">High</Option>
              <Option value="medium">Medium</Option>
              <Option value="low">Low</Option>
            </Select>
          </div>

          <div className={styles.setting}>
            <label>
              Include Tests
              <Tooltip title="Generate unit tests for the contract">
                <QuestionCircleOutlined className={styles.helpIcon} />
              </Tooltip>
            </label>
            <Switch
              checked={options.testing}
              onChange={(checked) => setOptions({ ...options, testing: checked })}
            />
          </div>

          <div className={styles.setting}>
            <label>
              Auto Format
              <Tooltip title="Automatically format code while typing">
                <QuestionCircleOutlined className={styles.helpIcon} />
              </Tooltip>
            </label>
            <Switch
              checked={options.autoFormat}
              onChange={(checked) => setOptions({ ...options, autoFormat: checked })}
            />
          </div>

          <div className={styles.setting}>
            <label>
              Live Analysis
              <Tooltip title="Analyze code in real-time">
                <QuestionCircleOutlined className={styles.helpIcon} />
              </Tooltip>
            </label>
            <Switch
              checked={options.liveAnalysis}
              onChange={(checked) => setOptions({ ...options, liveAnalysis: checked })}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default ContractBuilder
