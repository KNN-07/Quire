const tasks: Readonly<Record<string, string>> = {
  matrix: "Full T01-T22 feature evidence is not implemented in P0. See docs/feature-matrix.md.",
  restore: "Operations lane must register the complete recovery drill; P0 does not claim backup recovery.",
  scale: "Run bun run test:scale for the real PostgreSQL/Redis/S3/repository and two-API checks.",
};
console.error(tasks[process.argv[2] ?? ""] ?? "Unknown verification task");
process.exitCode = 1;
