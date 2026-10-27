import type { EndpointName } from "@quire/contracts";

// Explicit phase boundary: no missing native P1 handler is allowed into this set.
export const p2Endpoints: readonly EndpointName[] = [
  "identityStart", "identityCallback", "samlCallback", "identityLink", "identityUnlink",
  "billingPortal", "billingPreview", "billingCheckout", "billingCancel", "invoiceDownload",
  "billingWebhook", "identityConfigGet", "identityConfigPut", "identityTest", "identityMetadata", "scimToken",
  "importCreate", "libraryDoi", "referencesSearch", "connectionsList", "connectionStart", "connectionCallback",
  "connectionTest", "connectionDelete", "connectionAction", "aiRunCreate", "aiRunGet", "aiRunCancel",
  "aiRunDecide", "aiRunUndo", "aiConversationDelete",
  "operationsList", "operationGet", "workersList", "workerPolicyGet", "workersCreate",
  "workerPolicy", "workerDrain", "workerDelete", "adminEnvironments", "environmentCreate",
  "environmentDefault", "environmentRetire", "environmentBuild", "providerGet", "providerPut", "providerTest",
  "auditSiem", "auditSiemGet", "backupPolicyGet", "backupPolicyPut", "backupCreate", "backupsList",
  "backupVerify", "backupRestore", "releasesList", "updateCreate", "diagnosticsCreate", "supportInquiry",
  "scimUsersList", "scimUserCreate", "scimUserGet", "scimUserPatch", "scimUserDelete",
  "scimGroupsList", "scimGroupCreate", "scimGroupGet", "scimGroupPatch", "scimGroupDelete",
];
