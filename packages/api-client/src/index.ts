import type {
  ApiFailureBody,
  GateQueueItem,
  MobileBootstrapResponse,
  MobileMovementDetail,
  MobileNotification,
  OwnerOverview,
  Page,
} from "@genbridge/shared-types";

export interface SessionTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ConnectivityState {
  isOnline(): boolean;
}

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "API_ERROR",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export class DisconnectedMutationError extends MobileApiError {
  constructor() {
    super(
      "Reconnect before submitting this action. Nothing has been recorded yet.",
      0,
      "OFFLINE",
      true,
    );
  }
}

export function createIdempotencyKey(prefix = "mobile"): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function safeBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)
    )
  ) {
    throw new Error(
      "The mobile API must use HTTPS except for an approved local development host.",
    );
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}

export class GenbridgeMobileClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly tokens: SessionTokenStore,
    private readonly connectivity: ConnectivityState,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = safeBaseUrl(baseUrl);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    mutation = false,
  ): Promise<T> {
    if (mutation && !this.connectivity.isOnline())
      throw new DisconnectedMutationError();
    const token = await this.tokens.get();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (mutation && !headers.has("Idempotency-Key"))
      headers.set("Idempotency-Key", createIdempotencyKey());

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch {
      throw new MobileApiError(
        "The server could not be reached. Check connectivity and retry.",
        0,
        "NETWORK_ERROR",
        true,
      );
    }
    const body = (await response.json().catch(() => ({}))) as T &
      ApiFailureBody;
    if (!response.ok) {
      if (response.status === 401) await this.tokens.clear();
      throw new MobileApiError(
        body.error || "The request could not be completed.",
        response.status,
        body.code,
        Boolean(body.retryable),
      );
    }
    return body;
  }

  async signIn(input: { tenantSlug: string; email: string; password: string }) {
    const response = await this.request<{
      token: string;
      bootstrap: MobileBootstrapResponse;
    }>(
      "/api/mobile/auth/login",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      true,
    );
    await this.tokens.set(response.token);
    return response.bootstrap;
  }

  async signOut() {
    try {
      await this.request<{ ok: true }>(
        "/api/mobile/auth/logout",
        { method: "POST" },
        true,
      );
    } finally {
      await this.tokens.clear();
    }
  }

  bootstrap() {
    return this.request<MobileBootstrapResponse>("/api/mobile/bootstrap");
  }
  gateQueue(query = "", page = 1) {
    return this.request<Page<GateQueueItem>>(
      `/api/mobile/gate/queue?q=${encodeURIComponent(query)}&page=${page}`,
    );
  }
  movement(id: string) {
    return this.request<{
      movement: MobileMovementDetail;
      tracker: GateQueueItem["tracker"];
    }>(`/api/mobile/movements/${encodeURIComponent(id)}`);
  }
  startGateEvent(
    input: {
      movementAuthorisationId: string;
      gateId: string;
      direction: "ENTRY" | "EXIT";
    },
    key = createIdempotencyKey("gate-start"),
  ) {
    return this.mutate<{ gateEvent: { id: string; status: string } }>(
      "/api/mobile/gate/events",
      input,
      key,
    );
  }
  gateEvent(id: string) {
    return this.request<{ gateEvent: MobileGateEvent }>(
      `/api/mobile/gate/events/${encodeURIComponent(id)}`,
    );
  }
  gateAction<T = unknown>(
    id: string,
    body: unknown,
    key = createIdempotencyKey("gate-action"),
  ) {
    return this.mutate<T>(
      `/api/mobile/gate/events/${encodeURIComponent(id)}/actions`,
      body,
      key,
    );
  }
  ownerOverview() {
    return this.request<OwnerOverview>("/api/mobile/owner/overview");
  }
  movementDecision(
    id: string,
    decision: "APPROVE" | "REJECT",
    comments: string,
    key = createIdempotencyKey("movement-decision"),
  ) {
    return this.mutate<{ movement: { id: string; status: string } }>(
      `/api/mobile/movements/${encodeURIComponent(id)}/decision`,
      { decision, comments },
      key,
    );
  }
  notifications(page = 1) {
    return this.request<Page<MobileNotification>>(
      `/api/mobile/notifications?page=${page}`,
    );
  }
  markNotificationRead(id: string) {
    return this.request<{ ok: true }>(
      `/api/mobile/notifications/${encodeURIComponent(id)}/read`,
      { method: "POST" },
      true,
    );
  }
  mutate<T>(
    path: string,
    body: unknown,
    idempotencyKey = createIdempotencyKey(),
  ) {
    return this.request<T>(
      path,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      },
      true,
    );
  }

  async uploadEvidence(input: {
    file: File;
    ownerId: string;
    ownerType?: "GATE_EVENT" | "GATE_EVENT_INSPECTION_ITEM";
    category: string;
    idempotencyKey?: string;
  }) {
    if (!this.connectivity.isOnline()) throw new DisconnectedMutationError();
    const token = await this.tokens.get();
    if (!token)
      throw new MobileApiError(
        "Session expired. Sign in again.",
        401,
        "SESSION_INVALID",
      );
    const data = new FormData();
    data.set("file", input.file, input.file.name);
    data.set("ownerId", input.ownerId);
    data.set("ownerType", input.ownerType ?? "GATE_EVENT");
    data.set("category", input.category);
    data.set(
      "idempotencyKey",
      input.idempotencyKey ?? createIdempotencyKey("evidence"),
    );
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/api/mobile/evidence/upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: data,
        },
      );
    } catch {
      throw new MobileApiError(
        "Evidence upload could not reach the server. The file was not recorded.",
        0,
        "NETWORK_ERROR",
        true,
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      mediaAsset?: { id: string };
      error?: string;
      code?: string;
    };
    if (!response.ok || !body.mediaAsset) {
      if (response.status === 401) await this.tokens.clear();
      throw new MobileApiError(
        body.error ?? "Evidence upload failed.",
        response.status,
        body.code,
      );
    }
    return body.mediaAsset;
  }
}

export interface MobileGateEvent {
  id: string;
  status: string;
  direction: "ENTRY" | "EXIT";
  decision: string | null;
  vehicle: {
    id: string;
    registrationNumber: string;
    fleetNumber: string | null;
  };
  driver: { id: string; name: string; employeeNumber: string | null };
  gate: { id: string; name: string };
  site: { id: string; name: string };
  inspectionTemplate: {
    items: Array<{
      id: string;
      label: string;
      description: string | null;
      responseType: "CHECK" | "READING" | "TEXT";
      unit: string | null;
      isRequired: boolean;
    }>;
  } | null;
  inspectionResults: Array<{
    inspectionItemId: string;
    outcome: string;
    readingValue: string | null;
    comment: string | null;
  }>;
  exceptions: Array<{
    id: string;
    description: string;
    severity: string;
    resolvedAt: string | null;
  }>;
}
