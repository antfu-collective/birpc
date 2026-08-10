import antfu from '@antfu/eslint-config'

export default antfu({
}, {
  // Runnable demo scripts: allow console output and Node globals.
  files: ['examples/**'],
  rules: {
    'no-console': 'off',
    'node/prefer-global/process': 'off',
  },
})
