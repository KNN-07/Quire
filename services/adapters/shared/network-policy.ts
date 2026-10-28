import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { ServiceError } from "@quire/runtime";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export type ResolvedAddress = { readonly address: string; readonly family: number };
export type DnsResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;
export type HttpPolicy = {
  readonly fixtureOrigins?: readonly string[];
  readonly resolve?: DnsResolver;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
};
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family === 6) return globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
  return false;
}
export async function resolveTarget(url: URL, policy: HttpPolicy): Promise<ResolvedAddress> {
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new ServiceError("EGRESS_URL_DENIED", 400, "Only credential-free HTTP(S) URLs without fragments are allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const fixture = policy.fixtureOrigins?.includes(url.origin) === true;
  if (fixture && hostname !== "127.0.0.1" && hostname !== "::1") {
    throw new ServiceError("FIXTURE_ORIGIN_INVALID", 500, "Fixture origins must use literal loopback addresses");
  }
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }]
    : await (policy.resolve ?? ((host) => lookup(host, { all: true, verbatim: true })))(hostname);
  const first = addresses[0];
  if (!first || (!fixture && addresses.some((entry) => !isPublicAddress(entry.address)))) {
    throw new ServiceError("EGRESS_ADDRESS_DENIED", 403, "Destination resolves to a prohibited or empty address set");
  }
  return first;
}
