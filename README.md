# SolSynthAI

An advanced platform that leverages AI to generate, deploy, and manage Solana smart contracts with ease. Turn natural language into production-ready Solana programs.

## Overview

SolSynthai automates the creation, optimization, and deployment of Solana smart contracts using AI. The platform supports various contract types including tokens, NFTs, and DeFi protocols, with built-in security analysis and best practices.

[Web App](https://solsynthai.org) (Beta-release scheduled for 1st March 2025)

## Features

### 🤖 AI-Powered Contract Generation
- Convert natural language descriptions into Rust smart contracts
- Intelligent code optimization and suggestions
- Built-in security analysis and vulnerability detection
- Real-time code validation and suggestions
- Support for multiple contract types (Token, NFT, DeFi)

### 💻 Smart Contract Development
- Interactive Rust code editor with syntax highlighting
- Real-time compilation and error checking
- Automated code optimization
- Security analysis and best practices enforcement

### 🚀 Deployment & Management
- One-click deployment to Solana networks (Devnet, Testnet, Mainnet)
- Cost estimation and gas optimization
- Contract upgrade management
- Transaction monitoring and history
- Contract state management
- Performance analytics
- Account state management
- Real-time updates via WebSocket

## Installation

### Prerequisites
```bash
# Install Node.js 18+
https://nodejs.org/

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI tools
sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"
```

### Setup Repository
```bash
# Clone the repository
git clone https://github.com/solanasynthai/solsynthai.git
cd solsynthai

# Install frontend dependencies
cd frontend
npm install

# Install backend dependencies
cd ../backend
npm install
```

### Environment Configuration

1. Frontend Configuration:
```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env`:
```env
REACT_APP_BACKEND_URL=http://localhost:4000
REACT_APP_SOLANA_NETWORK=devnet
```

2. Backend Configuration:
```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:
```env
PORT=4000
NODE_ENV=development
OPENAI_API_KEY=your_key_here
SOLANA_RPC_URL=your_rpc_url
```

## Development

### Starting the Application

1. Start Backend:
```bash
cd backend
npm run dev
```

2. Start Frontend:
```bash
cd frontend
npm run dev
```

### Using Docker
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Contract Templates

The platform includes templates for:
- SPL Tokens
- NFT Collections
- DeFi Protocols (Staking, Lending)

Each template can be customized through:
- Natural language prompts
- Direct code modification
- Parameter configuration

## Usage Examples

### Creating a Token Contract
1. Navigate to Contract Generator
2. Select "Token" template
3. Describe requirements (e.g., "Create a token with mint and burn capabilities")
4. Review and modify generated code
5. Deploy to selected network

### Deploying NFT Collection
1. Choose NFT template
2. Configure collection parameters
3. Set minting limits and royalties
4. Review security analysis
5. Deploy and monitor

## Contributing

1. Fork repository: https://github.com/solanasynthai/solsynthai/fork
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push branch: `git push origin feature/new-feature`
5. Submit Pull Request

### Development Guidelines
- Follow Rust and TypeScript best practices
- Include tests for new features
- Update documentation as needed
- Ensure security best practices

## Testing

```bash
# Frontend Tests
cd frontend
npm test

# Backend Tests
cd backend
npm test

# Contract Tests
cd contracts
cargo test
```


## Support

- Documentation: [docs.solsynthai.org](https://docs.solsynthai.org) (Coming Soon)
- Telegram: [Join Community](https://t.me/solanasynthai)
- Website: [SolSynthAI](https://solsynthai.org)

## License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/solanasynthai/solsynthai/blob/main/license.md) file for details.

Made with ❤️ by the SolSynthAI team
