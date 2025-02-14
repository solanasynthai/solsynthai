import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../../contexts/WalletContext';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Storage } from '../../utils/storage';

interface ThemeSettings {
  darkMode: boolean;
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
}

interface NetworkSettings {
  defaultNetwork: string;
  rpcEndpoint: string;
  wsEndpoint: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
}

interface NotificationSettings {
  deploymentNotifications: boolean;
  compilationNotifications: boolean;
  errorNotifications: boolean;
  emailNotifications: boolean;
  email?: string;
}

const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { connected, disconnect } = useWallet();
  
  // Theme Settings
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>({
    darkMode: false,
    fontSize: 'medium',
    compactMode: false,
  });

  // Network Settings
  const [networkSettings, setNetworkSettings] = useState<NetworkSettings>({
    defaultNetwork: 'devnet',
    rpcEndpoint: 'https://api.devnet.solana.com',
    wsEndpoint: 'wss://api.devnet.solana.com',
    commitment: 'confirmed',
  });

  // Notification Settings
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    deploymentNotifications: true,
    compilationNotifications: true,
    errorNotifications: true,
    emailNotifications: false,
  });

  // Load settings from storage on mount
  useEffect(() => {
    const loadedThemeSettings = Storage.get('theme_settings');
    const loadedNetworkSettings = Storage.get('network_settings');
    const loadedNotificationSettings = Storage.get('notification_settings');

    if (loadedThemeSettings) setThemeSettings(loadedThemeSettings);
    if (loadedNetworkSettings) setNetworkSettings(loadedNetworkSettings);
    if (loadedNotificationSettings) setNotificationSettings(loadedNotificationSettings);
  }, []);

  // Save settings handlers
  const saveThemeSettings = () => {
    Storage.set('theme_settings', themeSettings);
    toast({
      title: 'Theme Settings Saved',
      description: 'Your theme preferences have been updated.',
    });
  };

  const saveNetworkSettings = () => {
    Storage.set('network_settings', networkSettings);
    toast({
      title: 'Network Settings Saved',
      description: 'Your network configuration has been updated.',
    });
  };

  const saveNotificationSettings = () => {
    if (notificationSettings.emailNotifications && !notificationSettings.email) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please provide an email address for notifications.',
      });
      return;
    }
    
    Storage.set('notification_settings', notificationSettings);
    toast({
      title: 'Notification Settings Saved',
      description: 'Your notification preferences have been updated.',
    });
  };

  const handleLogout = async () => {
    try {
      await disconnect();
      navigate('/');
      toast({
        title: 'Logged Out',
        description: 'You have been successfully logged out.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Logout Failed',
        description: 'Failed to log out. Please try again.',
      });
    }
  };

  const clearAllData = () => {
    if (window.confirm('Are you sure you want to clear all data? This cannot be undone.')) {
      Storage.clear();
      toast({
        title: 'Data Cleared',
        description: 'All application data has been cleared.',
      });
      navigate('/');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-gray-600">Manage your application preferences and configuration</p>
      </div>

      <Tabs defaultValue="theme" className="space-y-6">
        <TabsList>
          <TabsTrigger value="theme">Theme</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="theme">
          <Card>
            <CardHeader>
              <CardTitle>Theme Settings</CardTitle>
              <CardDescription>Customize the application appearance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Dark Mode</p>
                  <p className="text-sm text-gray-500">Enable dark color scheme</p>
                </div>
                <Switch
                  checked={themeSettings.darkMode}
                  onCheckedChange={(checked) =>
                    setThemeSettings((prev) => ({ ...prev, darkMode: checked }))
                  }
                />
              </div>

              <div>
                <p className="font-medium mb-2">Font Size</p>
                <Select
                  value={themeSettings.fontSize}
                  onValueChange={(value: 'small' | 'medium' | 'large') =>
                    setThemeSettings((prev) => ({ ...prev, fontSize: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select font size" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="large">Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Compact Mode</p>
                  <p className="text-sm text-gray-500">Reduce spacing in the interface</p>
                </div>
                <Switch
                  checked={themeSettings.compactMode}
                  onCheckedChange={(checked) =>
                    setThemeSettings((prev) => ({ ...prev, compactMode: checked }))
                  }
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={saveThemeSettings}>Save Theme Settings</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="network">
          <Card>
            <CardHeader>
              <CardTitle>Network Settings</CardTitle>
              <CardDescription>Configure network connection preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="font-medium mb-2">Default Network</p>
                <Select
                  value={networkSettings.defaultNetwork}
                  onValueChange={(value) =>
                    setNetworkSettings((prev) => ({ ...prev, defaultNetwork: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select network" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mainnet-beta">Mainnet Beta</SelectItem>
                    <SelectItem value="testnet">Testnet</SelectItem>
                    <SelectItem value="devnet">Devnet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <p className="font-medium mb-2">RPC Endpoint</p>
                <Input
                  value={networkSettings.rpcEndpoint}
                  onChange={(e) =>
                    setNetworkSettings((prev) => ({
                      ...prev,
                      rpcEndpoint: e.target.value,
                    }))
                  }
                  placeholder="Enter RPC endpoint URL"
                />
              </div>

              <div>
                <p className="font-medium mb-2">WebSocket Endpoint</p>
                <Input
                  value={networkSettings.wsEndpoint}
                  onChange={(e) =>
                    setNetworkSettings((prev) => ({
                      ...prev,
                      wsEndpoint: e.target.value,
                    }))
                  }
                  placeholder="Enter WebSocket endpoint URL"
                />
              </div>

              <div>
                <p className="font-medium mb-2">Commitment Level</p>
                <Select
                  value={networkSettings.commitment}
                  onValueChange={(value: 'processed' | 'confirmed' | 'finalized') =>
                    setNetworkSettings((prev) => ({ ...prev, commitment: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select commitment level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="processed">Processed</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="finalized">Finalized</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={saveNetworkSettings}>Save Network Settings</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>Configure your notification preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Deployment Notifications</p>
                  <p className="text-sm text-gray-500">Notify on contract deployments</p>
                </div>
                <Switch
                  checked={notificationSettings.deploymentNotifications}
                  onCheckedChange={(checked) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      deploymentNotifications: checked,
                    }))
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Compilation Notifications</p>
                  <p className="text-sm text-gray-500">Notify on contract compilations</p>
                </div>
                <Switch
                  checked={notificationSettings.compilationNotifications}
                  onCheckedChange={(checked) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      compilationNotifications: checked,
                    }))
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Error Notifications</p>
                  <p className="text-sm text-gray-500">Notify on errors and warnings</p>
                </div>
                <Switch
                  checked={notificationSettings.errorNotifications}
                  onCheckedChange={(checked) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      errorNotifications: checked,
                    }))
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Email Notifications</p>
                  <p className="text-sm text-gray-500">Receive notifications via email</p>
                </div>
                <Switch
                  checked={notificationSettings.emailNotifications}
                  onCheckedChange={(checked) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      emailNotifications: checked,
                    }))
                  }
                />
              </div>

              {notificationSettings.emailNotifications && (
                <div>
                  <p className="font-medium mb-2">Email Address</p>
                  <Input
                    type="email"
                    value={notificationSettings.email || ''}
                    onChange={(e) =>
                      setNotificationSettings((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    placeholder="Enter your email address"
                  />
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button onClick={saveNotificationSettings}>
                Save Notification Settings
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Account Settings</CardTitle>
              <CardDescription>Manage your account and session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!connected ? (
                <Alert>
                  <AlertTitle>Not Connected</AlertTitle>
                  <AlertDescription>
                    Please connect your wallet to access account settings.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="space-y-4">
                    <Button
                      variant="secondary"
                      onClick={handleLogout}
                      className="w-full"
                    >
                      Disconnect Wallet
                    </Button>

                    <Button
                      variant="destructive"
                      onClick={clearAllData}
                      className="w-full"
                    >
                      Clear All Data
                    </Button>
                  </div>

                  <div className="border-t pt-4">
                    <h3 className="font-medium mb-2">Security</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Additional security options for your account
                    </p>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Auto-lock Wallet</p>
                        <p className="text-sm text-gray-500">
                          Automatically disconnect after 15 minutes of inactivity
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
