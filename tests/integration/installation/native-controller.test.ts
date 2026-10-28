import { expect, test } from "bun:test";
import { z } from "zod";
import { endpoints, UserSchema } from "@quire/contracts";
import { InstallationStateSchema } from "../../../services/operations/installation/model";
import { inspectUnit, cgroupPids } from "../../../services/operations/installation/systemd-process";
import { nativeInstallation, origin, password } from "./native-fixture";

test("production controller launches two actual API invocations on one approved native binding", async () => {
  await using owned = await nativeInstallation();
  await owned.start();
  const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
  expect(state.mode).toBe("open");
  const invocations = [];
  for (let i = 0; i < owned.config.roles.length; i++) {
    const role = owned.config.roles[i];
    if (!role) throw new Error("Expected configured role slot");
    const unit = await inspectUnit(owned.config, role.unit);
    expect(unit.state).toBe("active");
    expect(unit.bindsTo).toContain(owned.config.controllerUnit);
    expect(await cgroupPids(unit.cgroup)).toContain(unit.mainPid);
    invocations.push(unit.invocationId);
    const response = await fetch(`http://127.0.0.1:${owned.ports[i]}/api/health`, { signal: AbortSignal.timeout(10000) });
    expect(response.status).toBe(200);
    expect(z.object({ data: endpoints.health.output }).parse(await response.json()).data.database).toBe("sqlite");
  }
  expect(new Set(invocations).size).toBe(2);
  const login = await fetch(`http://127.0.0.1:${owned.ports[0]}/api/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "operator@quire.local", password }), signal: AbortSignal.timeout(10000),
  });
  expect(login.status).toBe(200);
  expect(z.object({ data: UserSchema }).parse(await login.json()).data.primaryEmail).toBe("operator@quire.local");
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected actual operator session");
  const releases = await fetch(`http://127.0.0.1:${owned.ports[1]}/api/admin/releases`, {
    headers: { cookie, origin }, signal: AbortSignal.timeout(10000),
  });
  expect(releases.status).toBe(200);
  expect(z.object({ data: endpoints.releasesList.output }).parse(await releases.json()).data.items.map(row => row.id))
    .toEqual([owned.release.id]);
}, 180000);
