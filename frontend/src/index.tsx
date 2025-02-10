import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { WalletContextProvider } from './contexts/WalletContext';
import { ContractContextProvider } from './contexts/ContractContext';
import './index.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <WalletContextProvider>
        <ContractContextProvider>
          <App />
        </ContractContextProvider>
      </WalletContextProvider>
    </BrowserRouter>
  </React.StrictMode>
);

# File: /frontend/src/App.tsx

import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/common/Layout';
import { Dashboard } from './components/pages/Dashboard';
import { ContractGenerator } from './components/pages/ContractGenerator';
import { DeploymentManager } from './components/pages/DeploymentManager';
import { Settings } from './components/pages/Settings';

const App: React.FC = () => {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/generate" element={<ContractGenerator />} />
        <Route path="/deploy" element={<DeploymentManager />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
};

export default App;

# File: /frontend/src/index.css

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --primary: #512da8;
  --secondary: #303f9f;
  --accent: #ff4081;
  --background: #fafafa;
  --text: #212121;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: var(--background);
  color: var(--text);
}
