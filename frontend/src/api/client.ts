import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios'
import { notification } from 'antd'
import { logError } from '../utils/logger'

// Types
interface RetryConfig extends AxiosRequestConfig {
  retry?: number
  retryDelay?: number
  retryCondition?: (error: AxiosError) => boolean
}

interface ApiResponse<T = any> {
  data: T
  status: number
  headers: any
}

// Configuration
const DEFAULT_CONFIG = {
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  retry: 3,
  retryDelay: 1000,
  retryCondition: (error: AxiosError) => {
    return (
      axios.isAxiosError(error) &&
      error.response?.status !== 401 &&
      error.response?.status !== 403 &&
      error.response?.status !== 404 &&
      error.response?.status !== 422
    )
  }
}

class ApiClient {
  private client: AxiosInstance
  private refreshPromise: Promise<string> | null = null

  constructor(config: RetryConfig = DEFAULT_CONFIG) {
    this.client = axios.create(config)
    this.setupInterceptors()
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('auth_token')
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config as RetryConfig

        // Handle token refresh
        if (error.response?.status === 401 && !originalRequest._retry) {
          if (!this.refreshPromise) {
            this.refreshPromise = this.refreshToken()
          }

          try {
            const newToken = await this.refreshPromise
            originalRequest.headers.Authorization = `Bearer ${newToken}`
            originalRequest._retry = true
            return this.client(originalRequest)
          } catch (refreshError) {
            this.handleAuthError()
            return Promise.reject(refreshError)
          } finally {
            this.refreshPromise = null
          }
        }

        // Handle retries for failed requests
        if (
          originalRequest.retry &&
          originalRequest.retry > 0 &&
          originalRequest.retryCondition?.(error)
        ) {
          originalRequest.retry--
          await new Promise(resolve => 
            setTimeout(resolve, originalRequest.retryDelay)
          )
          return this.client(originalRequest)
        }

        return Promise.reject(error)
      }
    )
  }

  private async refreshToken(): Promise<string> {
    try {
      const refreshToken = localStorage.getItem('refresh_token')
      if (!refreshToken) {
        throw new Error('No refresh token available')
      }

      const response = await this.client.post('/auth/refresh', {
        refreshToken
      })

      const { token } = response.data
      localStorage.setItem('auth_token', token)
      return token

    } catch (error) {
      this.handleAuthError()
      throw error
    }
  }

  private handleAuthError(): void {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('refresh_token')
    window.location.href = '/login'
  }

  private handleError(error: AxiosError): never {
    if (error.response) {
      const status = error.response.status
      const data = error.response.data as any

      // Handle specific error cases
      switch (status) {
        case 400:
          notification.error({
            message: 'Invalid Request',
            description: data.message || 'Please check your input'
          })
          break
        case 404:
          notification.error({
            message: 'Not Found',
            description: data.message || 'The requested resource was not found'
          })
          break
        case 422:
          notification.error({
            message: 'Validation Error',
            description: data.message || 'Please check your input'
          })
          break
        case 429:
          notification.warning({
            message: 'Too Many Requests',
            description: 'Please wait before trying again'
          })
          break
        case 500:
          notification.error({
            message: 'Server Error',
            description: 'An unexpected error occurred'
          })
          break
        default:
          notification.error({
            message: 'Error',
            description: data.message || 'An unexpected error occurred'
          })
      }
    } else if (error.request) {
      notification.error({
        message: 'Network Error',
        description: 'Please check your internet connection'
      })
    }

    logError('API request failed', error)
    throw error
  }

  public async get<T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.get<T>(url, config)
      return response
    } catch (error) {
      return this.handleError(error as AxiosError)
    }
  }

  public async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.post<T>(url, data, config)
      return response
    } catch (error) {
      return this.handleError(error as AxiosError)
    }
  }

  public async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.put<T>(url, data, config)
      return response
    } catch (error) {
      return this.handleError(error as AxiosError)
    }
  }

  public async delete<T = any>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<ApiResponse<T>> {
    try {
      const response = await this.client.delete<T>(url, config)
      return response
    } catch (error) {
      return this.handleError(error as AxiosError)
    }
  }

  public async upload(
    url: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse> {
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await this.client.post(url, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = (progressEvent.loaded / progressEvent.total) * 100
            onProgress(Math.round(progress))
          }
        }
      })
      return response
    } catch (error) {
      return this.handleError(error as AxiosError)
    }
  }

  public setToken(token: string): void {
    localStorage.setItem('auth_token', token)
  }

  public clearToken(): void {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('refresh_token')
  }
}

export const apiClient = new ApiClient()
export default apiClient
