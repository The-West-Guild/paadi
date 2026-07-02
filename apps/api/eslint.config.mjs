import config from "@paadi/eslint-config/nest";

const base = Array.isArray(config) ? config : [config];

export default [...base, { ignores: ["scripts/**/*.cjs"] }];
