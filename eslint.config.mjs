// @ts-check
// ESLint 9 (flat config) — mesmo formato adotado pelo scaffold oficial do NestJS 11.
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'node_modules/**', 'report/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // Code smells no motor de regras da PRÓPRIA SonarSource — as regras do Sonar
  // sem servidor Sonar. Publicação em SonarQube é possível no futuro; hoje os
  // archetypes NÃO estão plugados a Sonar via CI — o gate é este, local e no CI.
  sonarjs.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/interface-name-prefix': 'off',
    },
  },
  {
    // ─── Quality gate de métricas (ver README §Quality gate) ─────────────────
    // Limiares CALIBRADOS contra esta base (nascem verdes): mudar é decisão
    // registrada em PR, não conveniência. Duplicação é medida à parte (jscpd).
    rules: {
      // Complexidade ciclomática: caminhos independentes pelo código
      complexity: ['error', 15],
      // Complexidade cognitiva (métrica Sonar): dificuldade de LER o fluxo
      'sonarjs/cognitive-complexity': ['error', 15],
      // Lista longa de parâmetros. Limiar 5 acomoda o padrão de DI do Nest
      // (construtores injetam dependências); crescer além disso é sinal
      // legítimo de classe com responsabilidades demais (SRP).
      'max-params': ['error', 5],
      // Bloaters: função/arquivo grandes demais para manter
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 4],
      // Import não usado já é coberto por @typescript-eslint/no-unused-vars
      // (type-aware, reconhece uso via DECORATOR como @Exclude()). A regra do
      // sonarjs é redundante E frágil: quando o parser (typescript-eslint) muda
      // a AST dos decorators num bump, ela falso-positiva imports usados só em
      // decorator. Desligada para não quebrar o build por atualização de
      // toolchain — a cobertura real permanece no typescript-eslint.
      'sonarjs/unused-import': 'off',
    },
  },
  {
    // Testes: rigor de type-safety vale (regras acima do bloco base seguem),
    // mas bloaters não — describe()/e2e são longos por natureza, e specs
    // repetem literais de propósito (fixtures legíveis).
    files: ['**/*.spec.ts', 'test/**'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },
);
