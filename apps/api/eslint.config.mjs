import node from '@eatease/eslint-config/node';

export default [
  ...node,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
];
