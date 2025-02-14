import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Activity, Code, Download, Upload } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  description: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    positive: boolean;
  };
}

interface Contract {
  id: string;
  name: string;
  template: string;
  status: 'draft' | 'compiled' | 'deployed';
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, description, icon, trend }) => (
  <Card>
    <CardContent className="p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-semibold">{value}</span>
            {trend && (
              <span className={`text-sm ${trend.positive ? 'text-green-500' : 'text-red-500'}`}>
                {trend.positive ? '↑' : '↓'} {Math.abs(trend.value)}%
              </span>
            )}
          </div>
        </div>
        <div className="p-2 bg-primary/10 rounded-full">
          {icon}
        </div>
      </div>
      <p className="mt-4 text-sm text-gray-600">{description}</p>
    </CardContent>
  </Card>
);

interface DashboardProps {
  contracts: Contract[];
  isWalletConnected: boolean;
  onNewContract: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ 
  contracts, 
  isWalletConnected,
  onNewContract 
}) => {
  const [activityData, setActivityData] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({
    totalContracts: 0,
    activeContracts: 0,
    deployments: 0,
    successRate: 0
  });

  useEffect(() => {
    if (!isWalletConnected) {
      return;
    }

    // Simulate fetching metrics and activity data
    const fetchDashboardData = async () => {
      // In production, this would be an API call
      const mockActivityData = Array.from({ length: 7 }, (_, i) => ({
        date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toLocaleDateString(),
        deployments: Math.floor(Math.random() * 10),
        compilations: Math.floor(Math.random() * 15),
        validations: Math.floor(Math.random() * 20)
      })).reverse();

      setActivityData(mockActivityData);
      setMetrics({
        totalContracts: contracts.length,
        activeContracts: contracts.filter(c => c.status === 'deployed').length,
        deployments: contracts.reduce((acc, c) => acc + (c.status === 'deployed' ? 1 : 0), 0),
        successRate: Math.round((contracts.filter(c => c.status === 'deployed').length / Math.max(contracts.length, 1)) * 100)
      });
    };

    fetchDashboardData();
  }, [isWalletConnected, contracts]);

  if (!isWalletConnected) {
    return (
      <div className="p-6">
        <Alert>
          <AlertTitle>Connect Wallet</AlertTitle>
          <AlertDescription>
            Please connect your wallet to view your dashboard and contract analytics.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <button
          onClick={onNewContract}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary"
        >
          New Contract
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Contracts"
          value={metrics.totalContracts}
          description="Total number of contracts created"
          icon={<Code className="h-6 w-6 text-primary" />}
          trend={{ value: 12, positive: true }}
        />
        <MetricCard
          title="Active Contracts"
          value={metrics.activeContracts}
          description="Contracts currently deployed"
          icon={<Activity className="h-6 w-6 text-primary" />}
          trend={{ value: 8, positive: true }}
        />
        <MetricCard
          title="Total Deployments"
          value={metrics.deployments}
          description="Successful contract deployments"
          icon={<Upload className="h-6 w-6 text-primary" />}
          trend={{ value: 5, positive: true }}
        />
        <MetricCard
          title="Success Rate"
          value={`${metrics.successRate}%`}
          description="Deployment success rate"
          icon={<Download className="h-6 w-6 text-primary" />}
          trend={{ value: 2, positive: true }}
        />
      </div>

      <Card className="p-6">
        <CardHeader className="px-0 pt-0">
          <CardTitle>Activity Overview</CardTitle>
        </CardHeader>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={activityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="date" 
                stroke="#6b7280"
                fontSize={12}
                tickLine={false}
              />
              <YAxis 
                stroke="#6b7280"
                fontSize={12}
                tickLine={false}
              />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="deployments" 
                stroke="#8b5cf6" 
                strokeWidth={2}
                dot={{ strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="compilations" 
                stroke="#06b6d4" 
                strokeWidth={2}
                dot={{ strokeWidth: 2 }}
              />
              <Line 
                type="monotone" 
                dataKey="validations" 
                stroke="#10b981" 
                strokeWidth={2}
                dot={{ strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Contracts</CardTitle>
          </CardHeader>
          <CardContent>
            {contracts.slice(0, 5).map((contract, i) => (
              <div 
                key={contract.id}
                className={`flex items-center justify-between py-4 ${
                  i !== 0 ? 'border-t' : ''
                }`}
              >
                <div>
                  <p className="font-medium">{contract.name}</p>
                  <p className="text-sm text-gray-500">{contract.template}</p>
                </div>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  contract.status === 'deployed' 
                    ? 'bg-green-100 text-green-800'
                    : contract.status === 'compiled'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {contract.status}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resource Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">Storage</span>
                  <span className="text-sm text-gray-500">65%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full" style={{ width: '65%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">Compute Units</span>
                  <span className="text-sm text-gray-500">40%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full" style={{ width: '40%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">API Calls</span>
                  <span className="text-sm text-gray-500">85%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full" style={{ width: '85%' }} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
