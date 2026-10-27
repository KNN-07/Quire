import type { createClient } from "@quire/contracts";

export type MarketingPageProps = {
  readonly path: string;
  readonly client: ReturnType<typeof createClient>;
  readonly navigate: (path: string) => void;
  readonly onSessionChange: () => Promise<void>;
  readonly operatorContact?: {
    readonly email: string;
    readonly scope: string;
  };
};
