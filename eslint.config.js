import neostandard from 'neostandard'

export default [
  { ignores: ['public/**', 'coverage/**', '.context/**'] },
  ...neostandard({
    env: ['browser', 'es2022'],
    ts: true,
    filesTs: ['src/**/*.ts', 'src/**/*.tsx'],
    files: ['src/**/*.js', 'index.js', 'lib/**/*.js'],
  }),
  ...neostandard({
    env: ['jest'],
    files: ['test/**/*.js', 'test/**/*.jsx'],
    ignores: [
      'node_modules',
      'public',
    ]
  }),
  {
    files: ['tests/**/*.jsx'],
    // neostandard omits react/jsx-uses-react while supporting ESLint 10.
    rules: {
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^React$'
      }]
    }
  }
]
