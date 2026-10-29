import { expect, test } from "bun:test";
import { checkFeatureMapping } from "../../packages/runtime/src/verification";

const inventory = {
  core: "| A01 | R | authoring |\n| P01 | R | projects |",
  services: "| C31 / F31 | collaboration |",
  design: "| `01-editor` | 1440x900 | editor |",
  matrix: "| A01 | **MOUNT** |\n| P01 | **PART** |\n| C31 | **EXT** |\n| D01 `01-editor` | **BOUND** |",
};
test("mapping checks all inventories without certifying runtime behavior", () => {
  expect(checkFeatureMapping(inventory)).toMatchObject({
    mappingComplete: true, behavioralAcceptance: false, mapped: 4,
    inventory: { core: 2, services: 1, design: 1, total: 4 },
    declaredCoverage: { MOUNT: 1, PART: 1, EXT: 1, BOUND: 1 },
  });
});
test("mapping reports missing, unexpected, duplicate and undispositioned rows", () => {
  expect(checkFeatureMapping({ ...inventory, matrix: "| A01 | **MOUNT** |\n| A01 | **MOUNT** |\n| Z99 | missing |" }))
    .toMatchObject({ mappingComplete: false, missing: ["C31", "D01", "P01"], unexpected: ["Z99"],
      matrixDuplicates: ["A01"], missingDisposition: ["Z99"] });
});
test("mapping rejects empty or duplicate source inventories", () => {
  expect(checkFeatureMapping({ ...inventory, core: "", design: "" })).toMatchObject({
    mappingComplete: false, emptyInventories: ["core", "design"],
  });
  expect(checkFeatureMapping({ ...inventory, services: inventory.services + "\n| A01 / duplicate | capability |" }))
    .toMatchObject({ mappingComplete: false, inventoryDuplicates: ["A01"] });
});
test("an explicit gap stays reported and scenario IDs are not capabilities", () => {
  const report = checkFeatureMapping({ ...inventory,
    matrix: inventory.matrix.replace("**MOUNT**", "**GAP**") + "\n| T01 | scenario |\n| Q01 | registered QA scenario |" });
  expect(report.mappingComplete).toBe(true);
  expect(report.behavioralAcceptance).toBe(false);
  expect(report.declaredCoverage.GAP).toBe(1);
  expect(report.mapped).toBe(4);
});
