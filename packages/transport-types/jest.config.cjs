/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ES2020',
        strict: false,
        esModuleInterop: true,
      },
    }],
  },
  collectCoverageFrom: ['**/*.ts', '!dist/**', '!**/*.spec.ts'],
  coverageDirectory: './coverage',
  testTimeout: 30000,
};
