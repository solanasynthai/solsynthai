const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  rootDir: '.',
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  testEnvironment: 'jest-environment-jsdom',
  
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^@styles/(.*)$': '<rootDir>/src/styles/$1',
    '^@tests/(.*)$': '<rootDir>/src/tests/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/src/tests/__mocks__/fileMock.js',
  },

  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/*.{spec,test}.{js,jsx,ts,tsx}',
  ],

  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/out/',
    '<rootDir>/coverage/',
    '<rootDir>/public/',
  ],

  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { presets: ['next/babel'] }],
  },

  transformIgnorePatterns: [
    '/node_modules/(?!(@solana|@project-serum|@metaplex-foundation|@coral-xyz)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/*.styles.{js,jsx,ts,tsx}',
    '!src/types/**/*',
    '!src/pages/_*.{js,jsx,ts,tsx}',
    '!src/pages/api/**/*',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/components/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './src/services/': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },

  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'reports/junit',
        outputName: 'jest-junit.xml',
        classNameTemplate: '{filepath}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
      },
    ],
    [
      'jest-html-reporter',
      {
        pageTitle: 'Frontend Test Report',
        outputPath: 'reports/test-report.html',
        includeFailureMsg: true,
        includeSuiteFailure: true,
      },
    ],
  ],

  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
      diagnostics: {
        warnOnly: true,
      },
    },
  },

  maxWorkers: process.env.CI ? 2 : '50%',
  workerIdleMemoryLimit: '512MB',

  verbose: true,
  testTimeout: 30000,
  slowTestThreshold: 5000,

  bail: process.env.CI ? 1 : 0,
  
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname',
    ['jest-watch-suspend', { 'key-for-suspend': 's' }],
  ],

  resolver: '<rootDir>/src/tests/resolver.js',

  // Specific settings for Solana/Web3 testing
  testEnvironmentOptions: {
    url: 'http://localhost:8899',
    customExportConditions: ['browser', 'web'],
  },

  // Handle specific module mocks
  moduleNameMapper: {
    '@solana/web3.js': '<rootDir>/src/tests/__mocks__/@solana/web3.js',
    '@solana/spl-token': '<rootDir>/src/tests/__mocks__/@solana/spl-token',
    '@metaplex-foundation/js': '<rootDir>/src/tests/__mocks__/@metaplex-foundation/js',
  },
};

module.exports = createJestConfig(customJestConfig);
