import "server-only";
import { logger } from "@/lib/observability/logger";

/** Same provider-neutral shape as retention/notification-provider.ts and billing/billing-email-provider.ts. */

export interface InvestigationNotificationInput {
  toEmail: string;
  recipientName: string;
  caseNumber: string;
  caseTitle: string;
  eventType: string;
  message: string;
}

export interface InvestigationNotificationDeliveryResult {
  delivered: boolean;
  failureReason?: string;
}

export interface InvestigationNotificationProvider {
  readonly channel: "DEV_CONSOLE" | "NOOP";
  send(input: InvestigationNotificationInput): Promise<InvestigationNotificationDeliveryResult>;
}

export class DevConsoleInvestigationNotificationProvider implements InvestigationNotificationProvider {
  readonly channel = "DEV_CONSOLE" as const;
  async send(input: InvestigationNotificationInput): Promise<InvestigationNotificationDeliveryResult> {
    logger.info("email.synthetic_delivery", { template: "investigation-notification", eventType: input.eventType, recipientDomain: input.toEmail.split("@")[1] ?? "invalid" });
    return { delivered: true };
  }
}

export class NoOpInvestigationNotificationProvider implements InvestigationNotificationProvider {
  readonly channel = "NOOP" as const;
  async send(): Promise<InvestigationNotificationDeliveryResult> {
    return { delivered: false, failureReason: "No production notification provider is configured." };
  }
}

let cachedProvider: InvestigationNotificationProvider | null = null;
export function getDefaultInvestigationNotificationProvider(): InvestigationNotificationProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = process.env.INVESTIGATION_NOTIFICATION_PROVIDER === "dev-console" && process.env.APP_ENV !== "production"
    ? new DevConsoleInvestigationNotificationProvider()
    : new NoOpInvestigationNotificationProvider();
  return cachedProvider;
}
