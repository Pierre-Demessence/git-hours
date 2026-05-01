import antfu from '@antfu/eslint-config';

export default antfu({
  type: 'app',
  typescript: true,
  formatters: false,
  stylistic: {
    semi: true,
  },
  ignores: ['dist/**', 'node_modules/**'],
  rules: {
    // This is a CLI; console output is the product.
    'no-console': 'off',
    // We use the built-in node:test runner, not vitest.
    'test/no-import-node-test': 'off',
  },
});
