const js = require('@eslint/js');
const globals = require('globals');

// Flat config. package.json has no "type", so this file and the Electron main-side
// files are CommonJS; everything under src/, test/ and scripts/ is an ES module.
module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'src/vendor/**'] },
  js.configs.recommended,
  {
    rules: {
      // An underscore marks an argument or a caught error as deliberately unused.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['main.js', 'preload.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node }
  },
  {
    files: ['src/**/*.{js,mjs}'],
    languageOptions: { sourceType: 'module', globals: globals.browser }
  },
  {
    files: ['test/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node }
  }
];
