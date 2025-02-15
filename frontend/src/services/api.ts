import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { Storage } from '../utils/storage';
import { ErrorWithCode } from '../utils/errors';
import { Contract, ContractStatus, DeploymentStatus } from '../types';

export class ApiService {
  private static instance: ApiService;
  private api: AxiosInstance;
  private retryDelay = 1000;
  private maxRetries = 3;

  private constructor() {
    this.api = axios.create({
      baseURL: import.meta.env.VITE_API_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  public static getInstance(): ApiService {
    if (!ApiService.instance) {
      ApiService.instance = new ApiService();
    }
    return ApiService.instance;
  }

  private setupInterceptors(): void {
    // Request interceptor
    this.api.interceptors.request.use(
      (config) => {
        const token = Storage.get('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    this.api.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };
        
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            await this.refreshToken();
            return this.api(originalRequest);
          } catch (refreshError) {
            Storage.remove('auth_token');
            window.location.href = '/login';
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(this.handleError(error));
      }
    );
  }

  // Authentication
  public async login(publicKey: string, signature: string): Promise<void> {
    const { data } = await this.api.post('/auth/login', { publicKey, signature });
    Storage.set('auth_token', data.token);
  }

  public async refreshToken(): Promise<void> {
    const { data } = await this.api.post('/auth/refresh');
    Storage.set('auth_token', data.token);
  }

  public async logout(): Promise<void> {
    await this.api.post('/auth/logout');
    Storage.remove('auth_token');
  }

  // Contracts
  public async getContracts(filters?: {
    status?: ContractStatus[];
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ contracts: Contract[]; total: number }> {
    const { data } = await this.api.get('/contracts', { params: filters });
    return data;
  }

  public async getContract(id: string): Promise<Contract> {
    const { data } = await this.api.get(`/contracts/${id}`);
    return data;
  }

  public async createContract(contract: Partial<Contract>): Promise<Contract> {
    const { data } = await this.api.post('/contracts', contract);
    return data;
  }

  public async updateContract(id: string, updates: Partial<Contract>): Promise<Contract> {
    const { data } = await this.api.put(`/contracts/${id}`, updates);
    return data;
  }

  public async deleteContract(id: string): Promise<void> {
    await this.api.delete(`/contracts/${id}`);
  }

  public async compileContract(id: string, options?: {
    optimize?: boolean;
    target?: string;
  }): Promise<{ success: boolean; bytecode?: string; error?: string }> {
    const { data } = await this.api.post(`/contracts/${id}/compile`, options);
    return data;
  }

  // Deployments
  public async createDeployment(contractId: string, options: {
    network: string;
    programId: string;
    metadata?: Record<string, any>;
  }): Promise<{ id: string; status: DeploymentStatus }> {
    const { data } = await this.api.post('/deployments', {
      contractId,
      ...options
    });
    return data;
  }

  public async getDeployment(id: string): Promise<{
    id: string;
    status: DeploymentStatus;
    error?: string;
    txHash?: string;
  }> {
    const { data } = await this.api.get(`/deployments/${id}`);
    return data;
  }

  // Analytics
  public async getContractAnalytics(contractId: string, params: {
    startDate: string;
    endDate: string;
    metrics: string[];
  }): Promise<any> {
    const { data } = await this.api.get(`/analytics/contracts/${contractId}`, {
      params
    });
    return data;
  }

  public async getSystemMetrics(params: {
    timeframe: '1h' | '24h' | '7d' | '30d';
  }): Promise<any> {
    const { data } = await this.api.get('/analytics/system', { params });
    return data;
  }

  // Organizations
  public async getOrganizations(): Promise<any[]> {
    const { data } = await this.api.get('/organizations');
    return data;
  }

  public async getOrganization(id: string): Promise<any> {
    const { data } = await this.api.get(`/organizations/${id}`);
    return data;
  }

  // User Profile
  public async getCurrentUser(): Promise<any> {
    const { data } = await this.api.get('/users/me');
    return data;
  }

  public async updateProfile(updates: {
    username?: string;
    email?: string;
    avatar?: File;
  }): Promise<any> {
    const formData = new FormData();
    Object.entries(updates).forEach(([key, value]) => {
      if (value) formData.append(key, value);
    });

    const { data } = await this.api.put('/users/me', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return data;
  }

  // Utility Methods
  private async retryRequest(
    request: () => Promise<any>,
    retries = 0
  ): Promise<any> {
    try {
      return await request();
    } catch (error) {
      if (retries < this.maxRetries && this.isRetryableError(error)) {
        await new Promise(resolve => 
          setTimeout(resolve, this.retryDelay * Math.pow(2, retries))
        );
        return this.retryRequest(request, retries + 1);
      }
      throw error;
    }
  }

  private isRetryableError(error: any): boolean {
    return (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      (error.response && [500, 502, 503, 504].includes(error.response.status))
    );
  }

  private handleError(error: AxiosError): ErrorWithCode {
    if (error.response) {
      const { status, data } = error.response;
      return new ErrorWithCode(
        (data as any)?.message || 'An error occurred',
        (data as any)?.code || String(status)
      );
    }

    if (error.request) {
      return new ErrorWithCode(
        'Network error occurred',
        'NETWORK_ERROR'
      );
    }

    return new ErrorWithCode(
      error.message || 'Unknown error occurred',
      'UNKNOWN_ERROR'
    );
  }

  // Websocket Connection
  public connectWebSocket(): WebSocket {
    const ws = new WebSocket(import.meta.env.VITE_WS_URL);
    
    ws.onopen = () => {
      const token = Storage.get('auth_token');
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    return ws;
  }
}

export const api = ApiService.getInstance();
