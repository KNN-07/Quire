const tasks: Readonly<Record<string, string>> = {
  matrix: "Full T01-T22 feature evidence is not implemented in P0. See docs/feature-matrix.md.",
  restore: "Operations lane must register the complete recovery drill; P0 does not claim backup recovery.",
  scale: "Operations lane must provide PostgreSQL/Redis/S3 deployment checks; P0 uses real SQLite/disk only.",
};
console.error(tasks[process.argv[2] ?? ""] ?? "Unknown verification task");
process.exitCode = 1;
