import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    files: ["src/**/*.{js,jsx}"],
    ignores: ["src/app/lab/**", "src/app/taste/**", "src/app/api/taste/**", "src/lib/taste/**"],
    rules: {
      "@next/next/no-html-link-for-pages": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react/jsx-no-undef": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "out/**", "build/**", "dist/**", "src/app/lab/registry.js"],
  },
];

export default eslintConfig;
