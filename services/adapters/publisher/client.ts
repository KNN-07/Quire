import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { ActionContext, AdapterServices } from "../shared";
import { endpoint } from "./configuration";
import type { DirectPublisherContract, PublisherContract } from "./configuration";

const JsonObjectSchema = z.record(z.string(), z.json());
type PublisherResponse = {
  readonly submissionId: string;
  readonly status: string;
  readonly receipt: string;
};

export class PublisherClient {
  constructor(private readonly services: AdapterServices) {}

  async test(context: ActionContext, contract: PublisherContract): Promise<void> {
    await this.request(
      endpoint(context.configuration.baseUrl, contract.credentialTestPath),
      { method: "GET", headers: { authorization: `Bearer ${context.tokens.accessToken}` }, signal: context.signal },
    );
  }

  async submit(input: {
    readonly context: ActionContext;
    readonly contract: DirectPublisherContract;
    readonly archive: Uint8Array;
    readonly archiveSha256: string;
  }): Promise<PublisherResponse> {
    const response = await this.request(
      endpoint(input.context.configuration.baseUrl, input.contract.submitPath),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.context.tokens.accessToken}`,
          "content-type": "application/zip",
          "idempotency-key": input.context.key,
          "x-quire-project-id": input.context.projectId ?? "",
          "x-quire-archive-sha256": input.archiveSha256,
        },
        body: input.archive,
        signal: input.context.signal,
        maxBytes: 1024 * 1024,
      },
    );
    return this.parseReceipt(response, input.contract);
  }

  async status(input: {
    readonly context: ActionContext;
    readonly contract: DirectPublisherContract;
    readonly submissionId: string;
  }): Promise<PublisherResponse> {
    const path = input.contract.statusPath.replace(
      "{submissionId}",
      encodeURIComponent(input.submissionId),
    );
    const response = await this.request(endpoint(input.context.configuration.baseUrl, path), {
      method: "GET",
      headers: { authorization: `Bearer ${input.context.tokens.accessToken}` },
      signal: input.context.signal,
      maxBytes: 1024 * 1024,
    });
    return this.parseReceipt(response, input.contract);
  }

  private async request(url: string, input: Parameters<AdapterServices["http"]["request"]>[1]) {
    const response = await this.services.http.request(url, input);
    if (response.status < 200 || response.status >= 300) {
      throw new ServiceError(
        "PUBLISHER_HTTP_ERROR",
        502,
        `Publisher destination returned HTTP ${response.status}`,
      );
    }
    try {
      return JsonObjectSchema.parse(JSON.parse(new TextDecoder().decode(response.bytes)));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new ServiceError(
          "PUBLISHER_RESPONSE_INVALID",
          502,
          "Publisher response does not match the configured contract",
        );
      }
      throw error;
    }
  }

  private parseReceipt(
    response: z.infer<typeof JsonObjectSchema>,
    contract: DirectPublisherContract,
  ): PublisherResponse {
    return {
      submissionId: z.string().min(1).parse(response[contract.responseFields.submissionId]),
      status: z.string().min(1).parse(response[contract.responseFields.status]),
      receipt: z.string().min(1).parse(response[contract.responseFields.receipt]),
    };
  }
}
