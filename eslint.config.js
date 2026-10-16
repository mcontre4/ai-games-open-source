import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/ios/**',
      '**/android/**',
      '**/.expo/**',
      '**/assets/**',
      'work/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: [
      'apps/mobile/**/*.tsx',
      'apps/mobile/src/application/controller.ts',
      'apps/mobile/metro.config.cjs',
      'apps/mobile/plugins/**/*.cjs',
    ],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
