import create from 'zustand'
import { persist } from 'zustand/middleware'
import { apiClient } from '../api/client'
import { 
  Contract, 
  ContractTemplate, 
  GenerationOptions, 
  AnalysisResult, 
  CompilationResult 
} from '../types'
import { notification } from 'antd'
import { logError } from '../utils/logger'

interface ContractState {
  contract: Contract
  templates: ContractTemplate[]
  analysis: AnalysisResult | null
  isLoading: boolean
  error: Error | null
  lastSaved: Date | null
  undoStack: Contract[]
  redoStack: Contract[]

  // Actions
  setContract: (contract: Contract) => void
  generateContract: (options: GenerationOptions) => Promise<Contract>
  analyzeContract: (code: string) => Promise<AnalysisResult>
  compileContract: (code: string) => Promise<CompilationResult>
  saveContract: (contract: Contract) => Promise<void>
  loadTemplate: (templateId: string) => Promise<ContractTemplate>
  loadContract: (contractId: string) => Promise<void>
  updateContract: (updates: Partial<Contract>) => void
  undo: () => void
  redo: () => void
  reset: () => void

  // Template Management
  loadTemplates: () => Promise<void>
  saveTemplate: (template: ContractTemplate) => Promise<void>
  deleteTemplate: (templateId: string) => Promise<void>

  // Version Control
  createVersion: (message: string) => Promise<void>
  loadVersion: (versionId: string) => Promise<void>
  listVersions: () => Promise<any[]>
}

const MAX_UNDO_STEPS = 50
const AUTO_SAVE_INTERVAL = 30000 // 30 seconds

export const useContractStore = create<ContractState>(
  persist(
    (set, get) => ({
      // Initial state
      contract: {
        id: '',
        name: '',
        code: '',
        created: new Date(),
        updated: new Date(),
        author: '',
        version: '1.0.0',
        analysis: null
      },
      templates: [],
      analysis: null,
      isLoading: false,
      error: null,
      lastSaved: null,
      undoStack: [],
      redoStack: [],

      // Contract actions
      setContract: (contract: Contract) => {
        const { undoStack } = get()
        set({
          contract,
          undoStack: [
            get().contract,
            ...undoStack.slice(0, MAX_UNDO_STEPS - 1)
          ],
          redoStack: []
        })
      },

      generateContract: async (options: GenerationOptions) => {
        set({ isLoading: true, error: null })
        
        try {
          const response = await apiClient.post('/contracts/generate', {
            options
          })

          const contract = response.data
          set({ 
            contract,
            lastSaved: new Date(),
            isLoading: false
          })

          return contract

        } catch (error) {
          set({ 
            error: error as Error,
            isLoading: false
          })
          throw error
        }
      },

      analyzeContract: async (code: string) => {
        try {
          const response = await apiClient.post('/contracts/analyze', {
            code
          })

          const analysis = response.data
          set({ analysis })

          // Update contract with analysis results
          const contract = get().contract
          set({
            contract: {
              ...contract,
              analysis
            }
          })

          return analysis

        } catch (error) {
          logError('Contract analysis failed', error as Error)
          throw error
        }
      },

      compileContract: async (code: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await apiClient.post('/contracts/compile', {
            code
          })

          const result = response.data
          set({ isLoading: false })
          return result

        } catch (error) {
          set({ 
            error: error as Error,
            isLoading: false
          })
          throw error
        }
      },

      saveContract: async (contract: Contract) => {
        try {
          const response = await apiClient.put(
            `/contracts/${contract.id}`,
            contract
          )

          set({
            contract: response.data,
            lastSaved: new Date()
          })

        } catch (error) {
          logError('Contract save failed', error as Error)
          throw error
        }
      },

      loadTemplate: async (templateId: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await apiClient.get(
            `/templates/${templateId}`
          )

          const template = response.data
          set({ isLoading: false })
          return template

        } catch (error) {
          set({ 
            error: error as Error,
            isLoading: false
          })
          throw error
        }
      },

      loadContract: async (contractId: string) => {
        set({ isLoading: true, error: null })

        try {
          const response = await apiClient.get(
            `/contracts/${contractId}`
          )

          set({
            contract: response.data,
            isLoading: false,
            lastSaved: new Date()
          })

        } catch (error) {
          set({ 
            error: error as Error,
            isLoading: false
          })
          throw error
        }
      },

      updateContract: (updates: Partial<Contract>) => {
        const contract = get().contract
        const updatedContract = {
          ...contract,
          ...updates,
          updated: new Date()
        }

        set({
          contract: updatedContract,
          undoStack: [
            contract,
            ...get().undoStack.slice(0, MAX_UNDO_STEPS - 1)
          ],
          redoStack: []
        })
      },

      undo: () => {
        const { undoStack, redoStack, contract } = get()
        if (undoStack.length === 0) return

        const previousContract = undoStack[0]
        const newUndoStack = undoStack.slice(1)

        set({
          contract: previousContract,
          undoStack: newUndoStack,
          redoStack: [contract, ...redoStack]
        })
      },

      redo: () => {
        const { redoStack, undoStack, contract } = get()
        if (redoStack.length === 0) return

        const nextContract = redoStack[0]
        const newRedoStack = redoStack.slice(1)

        set({
          contract: nextContract,
          redoStack: newRedoStack,
          undoStack: [contract, ...undoStack]
        })
      },

      reset: () => {
        set({
          contract: {
            id: '',
            name: '',
            code: '',
            created: new Date(),
            updated: new Date(),
            author: '',
            version: '1.0.0',
            analysis: null
          },
          analysis: null,
          undoStack: [],
          redoStack: [],
          lastSaved: null,
          error: null
        })
      },

      // Template Management
      loadTemplates: async () => {
        try {
          const response = await apiClient.get('/templates')
          set({ templates: response.data })
        } catch (error) {
          logError('Template loading failed', error as Error)
          throw error
        }
      },

      saveTemplate: async (template: ContractTemplate) => {
        try {
          const response = await apiClient.post('/templates', template)
          set({
            templates: [...get().templates, response.data]
          })
        } catch (error) {
          logError('Template save failed', error as Error)
          throw error
        }
      },

      deleteTemplate: async (templateId: string) => {
        try {
          await apiClient.delete(`/templates/${templateId}`)
          set({
            templates: get().templates.filter(t => t.id !== templateId)
          })
        } catch (error) {
          logError('Template deletion failed', error as Error)
          throw error
        }
      },

      // Version Control
      createVersion: async (message: string) => {
        const { contract } = get()
        try {
          await apiClient.post(`/contracts/${contract.id}/versions`, {
            message,
            code: contract.code
          })
        } catch (error) {
          logError('Version creation failed', error as Error)
          throw error
        }
      },

      loadVersion: async (versionId: string) => {
        const { contract } = get()
        try {
          const response = await apiClient.get(
            `/contracts/${contract.id}/versions/${versionId}`
          )
          set({ contract: response.data })
        } catch (error) {
          logError('Version loading failed', error as Error)
          throw error
        }
      },

      listVersions: async () => {
        const { contract } = get()
        try {
          const response = await apiClient.get(
            `/contracts/${contract.id}/versions`
          )
          return response.data
        } catch (error) {
          logError('Version listing failed', error as Error)
          throw error
        }
      }
    }),
    {
      name: 'contract-store',
      getStorage: () => localStorage,
      partialize: (state) => ({
        contract: state.contract,
        templates: state.templates
      })
    }
  )
)

// Auto-save functionality
let autoSaveTimeout: NodeJS.Timeout

useContractStore.subscribe((state) => {
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout)
  }

  if (state.contract.id && state.contract.code) {
    autoSaveTimeout = setTimeout(() => {
      useContractStore.getState().saveContract(state.contract)
        .catch((error) => {
          notification.error({
            message: 'Auto-save failed',
            description: error.message
          })
        })
    }, AUTO_SAVE_INTERVAL)
  }
})

export default useContractStore
