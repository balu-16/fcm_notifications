import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.expo/**'] },
  ...tseslint.configs.recommended,
];
