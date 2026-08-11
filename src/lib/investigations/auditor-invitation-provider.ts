import "server-only";
import { logger } from "@/lib/observability/logger";

/**
 * Same provider-neutral pattern as billing/billing-email-provider.ts and
 * retention/notification-provider.ts: an interface, a safe NoOp (honestly
 * reports no production provider configured, never fabricates success),
 * and a deterministic Mock (dev/test only, never contacts a real external
 * service, logs metadata only). P11L: "Do not send a real external
 * invitation" — this codebase has no external identity/email vendor
 * configured, so the NoOp is the default in every environment unless
 * AUDITOR_INVITATION_PROVIDER=mock is explicitly set, same convention as
 * every other provider in this codebase.
 */

export interface AuditorInvitationInput {
  toEmail: string;
  auditorName: string;
  caseNumbers: string[];
  grantedByName: string;
  expiresAt: Date;
  portalUrl: string;
}

export interface AuditorInvitationResult {
  provider: string;
  delivered: boolean;
  errorMessage?: string;
}

export interface AuditorInvitationProvider {
  readonly name: string;
  send(input: AuditorInvitationInput): Promise<AuditorInvitationResult>;
}

export class NoOpAuditorInvitationProvider implements AuditorInvitationProvider {
  readonly name = "noop";
  async send(): Promise<AuditorInvitationResult> {
    return { provider: this.name, delivered: false, errorMessage: "No production external-invitation provider is configured. The grant itself is still active — share portal access out of band." };
  }
}

export class MockAuditorInvitationProvider implements AuditorInvitationProvider {
  readonly name = "mock";
  private sent: AuditorInvitationInput[] = [];

  async send(input: AuditorInvitationInput): Promise<AuditorInvitationResult> {
    this.sent.push(input);
    logger.info("email.synthetic_delivery", { template: "external-auditor-invitation", recipientDomain: input.toEmail.split("@")[1] ?? "invalid", expiresAt: input.expiresAt });
    return { provider: this.name, delivered: true };
  }

  getSent(): AuditorInvitationInput[] {
    return this.sent;
  }
}

let cachedProvider: AuditorInvitationProvider | null = null;
export function getDefaultAuditorInvitationProvider(): AuditorInvitationProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = process.env.AUDITOR_INVITATION_PROVIDER === "mock" && process.env.APP_ENV !== "production"
    ? new MockAuditorInvitationProvider()
    : new NoOpAuditorInvitationProvider();
  return cachedProvider;
}
