import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AiRunStepSchema, IdSchema, InstantSchema } from "@quire/contracts";
import { AssistantRunProgress } from "../../../apps/web/src/features/editor/assistant/RunProgress";

const startedAt = InstantSchema.parse("2026-10-28T10:00:00.000Z");
const finishedAt = InstantSchema.parse("2026-10-28T10:00:00.000Z");
const base = { id: IdSchema.parse("6b27d5ba-a385-457f-a293-e6edc8132508"), mode: "agent" as const, version: 4 };

test.each(AiRunStepSchema.unwrap().shape.kind.options)("renders every recorded %s state and preserves real timestamps", kind => {
  for (const status of AiRunStepSchema.unwrap().shape.status.options) {
    const step = { kind, status, startedAt, finishedAt: status === "running" ? null : finishedAt };
    const html = renderToStaticMarkup(<AssistantRunProgress run={{ ...base, status: status === "running" ? "running" : status,
      steps: [step] }} />);
    expect(html).toContain(`data-step-kind="${kind}"`);
    expect(html).toContain(`data-step-status="${status}"`);
    expect(html).toContain(`data-started-at="${startedAt}"`);
    expect(html).toContain(`dateTime="${startedAt}"`);
    expect(html).toContain(status === "running" ? 'data-finished-at=""' : `data-finished-at="${finishedAt}"`);
    expect([...html.matchAll(/data-step-kind=/gu)]).toHaveLength(1);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-atomic="true"');
  }
});

test("timeout receipts retain the recorded failed stage instead of fabricating later work", () => {
  const html = renderToStaticMarkup(<AssistantRunProgress run={{ ...base, status: "timeout",
    steps: [{ kind: "provider", status: "failed", startedAt, finishedAt }] }} />);
  expect(html).toContain('data-run-status="timeout"');
  expect(html).toContain('data-step-status="failed"');
  expect(html).toContain('data-result-ready="false"');
  expect([...html.matchAll(/data-step-kind=/gu)]).toHaveLength(1);
});

test("empty legacy history never infers completed stages or a progress percentage", () => {
  const html = renderToStaticMarkup(<AssistantRunProgress run={{ ...base, status: "succeeded", steps: [] }} />);
  expect(html).toContain('data-step-history="unavailable"');
  expect(html).not.toContain("data-step-kind=");
  expect(html).not.toContain('role="progressbar"');
  expect(html).toContain('data-result-ready="true"');
});

test("ordinary completed history has only the four recorded stages, without an acceptance action", () => {
  const steps = (["context", "provider", "validation", "publication"] as const).map(kind =>
    ({ kind, status: "succeeded" as const, startedAt, finishedAt }));
  const html = renderToStaticMarkup(<AssistantRunProgress run={{ ...base, status: "succeeded", steps }} />);
  expect([...html.matchAll(/data-step-kind="([^"]+)"/gu)].map(match => match[1])).toEqual(steps.map(step => step.kind));
  expect(html).not.toContain("<button");
  expect(html).not.toContain("data-step-kind=\"retrieval\"");
  expect(html).not.toContain('aria-valuenow');
});
