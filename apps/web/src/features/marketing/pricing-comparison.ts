/** Source group/row structure: docs/discovery/design-source/09-pricing.source.html.
 * These describe local capabilities, never commercial entitlements. */
export const pricingComparison = [
  { name: "Writing & compile", rows: [
    ["Collaborators per project", "Project permissions and operator policy"],
    ["Projects", "Local project repositories; operator storage policy"],
    ["Source, Split, Visual and PDF views", "Available in the editor"],
    ["Compile timeout", "Configured isolated worker limits"],
    ["Compile servers", "Operator-installed isolated workers"],
    ["Templates", "Project templates and template-based creation"],
  ] },
  { name: "Collaboration", rows: [
    ["Comments", "Project comments and review threads"],
    ["Track changes", "Source change tracking and review; project policy applies"],
    ["Version history", "Repository history; retention follows operator policy"],
    ["Advanced reference search", "Bibliography search; remote search requires providers"],
  ] },
  { name: "Git & integrations", rows: [
    ["Git clone and push", "Repository Git operations with authorized access"],
    ["GitHub and GitLab sync", "Requires configured connections and credentials"],
    ["Zotero and Mendeley", "Requires configured bibliography providers"],
  ] },
  { name: "AI assistant", rows: [
    ["AI allowance", "No default paid allowance; operator budgets apply"],
    ["Chat assistant and agent", "Requires configured models and permitted tools"],
    ["Global AI controls", "Operator provider and project policy controls"],
  ] },
  { name: "Groups & security", rows: [
    ["Group licence discount", "No commercial feature gates; no discount promised"],
    ["Audit log, user admin, metrics", "Authorized organization and operator administration"],
    ["SSO and managed accounts", "Requires configured identity providers and organization policy"],
    ["Site-wide licence, auto sign-up", "No license key; registration and enrollment follow server policy"],
  ] },
  { name: "Support", rows: [
    ["Help docs and community", "Installation documentation; contact the operator"],
    ["Priority support", "Only by separate operator agreement"],
    ["Dedicated account manager", "Only by separate operator agreement"],
  ] },
] as const;
