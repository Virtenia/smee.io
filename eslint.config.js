import neostandard from 'neostandard'

export default [
  { ignores: ['public/**', 'coverage/**', '.context/**', 'tests/deferred/**', 'test-results/**', 'playwright-report/**'] },
  ...neostandard({
    env: ['browser', 'es2022'],
    ts: true,
    filesTs: ['src/**/*.ts', 'src/**/*.tsx'],
    files: ['src/**/*.js', 'index.js', 'lib/**/*.js'],
  })
]
