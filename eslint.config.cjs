const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**'],
  },
  {
    files: ['apps/**/*.{ts,tsx,js,jsx,vue}'],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message:
                'Use database access through @orchestratorai/planes/database only.',
            },
            {
              name: 'pg',
              message:
                'Use database access through @orchestratorai/planes/database only.',
            },
            {
              name: 'mssql',
              message:
                'Use database access through @orchestratorai/planes/database only.',
            },
            {
              name: 'openai',
              message: 'Use LLM access through @orchestratorai/planes/llm only.',
            },
            {
              name: '@anthropic-ai/sdk',
              message: 'Use LLM access through @orchestratorai/planes/llm only.',
            },
            {
              name: '@google-cloud/vertexai',
              message: 'Use LLM access through @orchestratorai/planes/llm only.',
            },
            {
              name: '@azure-rest/ai-inference',
              message: 'Use LLM access through @orchestratorai/planes/llm only.',
            },
          ],
        },
      ],
    },
  },
];
