/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  
  moduleFileExtensions: [
    'ts',
    'tsx',
    'js',
    'jsx',
    'json',
    'node'
  ],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@models/(.*)$': '<rootDir>/src/models/$1',
    '^@tests/(.*)$': '<rootDir>/src/tests/$1'
  },

  setupFilesAfterEnv: [
    '<rootDir>/src/tests/setup.ts'
  ],

  testMatch: [
    '**/__tests__/**/*.(spec|test).[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)'
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/.next/',
    '/migrations/'
  ],

  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
        diagnostics: {
          ignoreCodes: [1343],
          warnOnly: true
        },
        isolatedModules: true
      }
    ]
  },

  transformIgnorePatterns: [
    '/node_modules/(?!(@solana|@project-serum|@metaplex-foundation|bn.js|buffer|borsh)/)'
  ],

  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.d.ts',
    '!src/types/**/*',
    '!src/migrations/**/*',
    '!src/scripts/**/*',
    '!src/**/index.{js,ts}',
    '!src/tests/**/*'
  ],

  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'clover',
    'html',
    'cobertura'
  ],

  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    './src/services/**/*.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './src/utils/**/*.ts': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    }
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
        reportTestSuiteErrors: true
      }
    ],
    [
      'jest-html-reporter',
      {
        pageTitle: 'Backend Test Report',
        outputPath: 'reports/test-report.html',
        includeFailureMsg: true,
        includeSuiteFailure: true,
        includeConsoleLog: true,
        includeStackTrace: true
      }
    ]
  ],

  globals: {
    'ts-jest': {
      isolatedModules: true
    },
    NODE_ENV: 'test'
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
    'jest-watch-select-projects',
    ['jest-watch-suspend', { 'key-for-suspend': 's' }]
  ],

  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/tests/setup.unit.ts']
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/src/**/*.integration.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/tests/setup.integration.ts'],
      testTimeout: 60000
    }
  ],

  globalSetup: '<rootDir>/src/tests/globalSetup.ts',
  globalTeardown: '<rootDir>/src/tests/globalTeardown.ts',

  errorOnDeprecated: true,
  
  cache: true,
  cacheDirectory: '.jest-cache',

  detectOpenHandles: true,
  forceExit: true,

  resolver: '<rootDir>/src/tests/resolver.js',

  testEnvironmentOptions: {
    url: 'http://localhost:8899'
  },

  // Specific settings for Solana/Web3 testing
  setupFiles: [
    '<rootDir>/src/tests/setupEnv.ts'
  ],

  moduleNameMapper: {
    '^@solana/web3.js$': '<rootDir>/src/tests/__mocks__/@solana/web3.js',
    '^@solana/spl-token$': '<rootDir>/src/tests/__mocks__/@solana/spl-token',
    '^@metaplex-foundation/(.*)$': '<rootDir>/src/tests/__mocks__/@metaplex-foundation/$1'
  }
};
