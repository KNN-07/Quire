import { expect, test } from "bun:test";
import { ServiceError } from "@quire/runtime";
import { returnPath } from "../../../services/adapters/identity/state";

test("OAuth return validation admits only canonical onboarding start and retains projects/settings", () => {
  const origin = "https://quire.example.test";
  for (const path of ["/sign-up?step=start", "/projects", "/projects/project/edit?branch=main",
    "/settings/identities", "/settings/billing?plan=price_year&period=year"]) {
    expect(returnPath(path, origin)).toBe(path);
  }
  for (const path of [
    "https://outside.invalid/sign-up?step=start", "https://quire.example.test/sign-up?step=start",
    "//outside.invalid/sign-up?step=start", "//quire.example.test/sign-up?step=start",
    "sign-up?step=start", "/\\outside.invalid/sign-up?step=start", "/sign-up?step=start\n",
    "/sign-up", "/sign-up?step=create", "/sign-up?step=verify", "/sign-up?step=START",
    "/sign-up?step=start#fragment", "/sign-up?step=start#",
    "/sign-up?step=start&plan=x", "/sign-up?step=start&returnTo=%2Fsettings%2Fbilling",
    "/sign-up?step=start&step=start", "/sign-up?step=start&step=create", "/sign-up?step=start&",
    "/sign-up?%73tep=start", "/sign-up?step=%73tart", "/projects/../sign-up?step=start",
    "/projects#fragment", "/settings#fragment", "/other",
  ]) {
    let failure: unknown;
    try { returnPath(path, origin); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ServiceError);
    if (failure instanceof ServiceError) expect(failure.code).toBe("OAUTH_RETURN_DENIED");
  }
});
