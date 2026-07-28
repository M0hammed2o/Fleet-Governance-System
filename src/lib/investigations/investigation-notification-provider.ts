import "server-only";

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
    console.log(`[InvestigationNotification] ${input.eventType} -> ${input.toEmail}: ${input.message}`);
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
  cachedProvider = process.env.INVESTIGATION_NOTIFICATION_PROVIDER === "dev-console" ? new DevConsoleInvestigationNotificationProvider() : new NoOpInvestigationNotificationProvider();
  return cachedProvider;
}
