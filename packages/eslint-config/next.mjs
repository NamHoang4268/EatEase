import next from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';

export default [{ ignores: ['**/.next-e2e/**'] }, ...next, prettier];
