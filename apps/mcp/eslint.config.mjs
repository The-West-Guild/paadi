import base from "@paadi/eslint-config/base";

export default [
  ...base,
  {
    files: ["jest.config.js"],
    languageOptions: {
      globals: { module: "readonly" },
    },
  },
];
