# Federation policy fixture reconciliation: FINAL

October 28, 2026. Closes the supplementary failure reported by the P18 release
producer and independent verifier.

The policy test expected a 420-second effective ceiling but left its project
owner at the default 180-second entitlement. Under the already accepted P4
model, user/federation policy restricts an owner's grant; it does not grant
additional project benefits. Production `policy.ts` explicitly applies
`restrictBenefits(ownerBenefits(...), ...)`, so 180 was the correct outcome
for that incomplete setup.

The fixture now grants the project owner 600 seconds through the actual
operator benefits endpoint. The original 420-second assertion is unchanged.
Two new assertions establish that AI is initially `agent` and the independent
420-second ceiling already applies before the mapping is tightened. The
original final AI-off, unchanged compile ceiling, and exact independent-policy
record assertions remain.

Only the previously failing case was run. It passed **1 case/7 assertions**
with the unrelated case filtered, followed by federation strict TypeScript
and touched-test type-aware deny-warning lint, exit 0 under
`mon_EDBWS1YQJTBEKV2K`. The fixture awaits its normal provider/server/runtime
and temporary-directory disposal.

No production policy, entitlement calculation, release code, baseline hash,
or existing assertion was weakened. Historical broader failed receipts remain
failed. This targeted correction does not claim a new complete repository
test run.
