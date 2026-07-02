import base from "@paadi/eslint-config/base";

export default [
  ...base,
  {
    files: ["jest.config.js"],
    languageOptions: {
      globals: { module: "readonly" },
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["@nestjs/*", "@prisma/client", "@paadi/db"],
        },
      ],
    },
  },
];
