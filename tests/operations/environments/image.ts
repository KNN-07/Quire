import { ImageSchema } from "../../../services/operations/environments/model";
import type { Profile } from "../../../services/operations/environments/model";
import { probeImage } from "../../../services/operations/environments/probe";
import { runCommand } from "../../../services/operations/environments/process";

export async function ownedImage() {
  const inspect = await runCommand(["docker","image","inspect","quire-p2o-environments:st_01a17c2c","--format","{{.Id}}"],{seconds:10});
  if (inspect.code !== 0) throw new TypeError(inspect.stderr);
  return ImageSchema.parse(process.env["QUIRE_TEST_ENVIRONMENT_IMAGE"] ?? inspect.stdout.trim());
}
const reports = new Map<Profile,ReturnType<typeof probeImage>>();
export async function verifiedReport(profile: Profile = "default") {
  let report = reports.get(profile);
  if (!report) {
    report=ownedImage().then(image=>probeImage(image,profile));
    reports.set(profile,report);
  }
  const value = await report;
  if (!value.available) throw new TypeError(`Owned image failed real probes: ${value.checks.filter(check=>check.code!==0).map(check=>check.name).join(", ")}`);
  return value;
}
