/**
 * No GPS/telematics vendor integration is built in-house (GPS-001). This is
 * the adapter boundary a real provider (Netstar/Cartrack/Tracker/MiX/other)
 * plugs into — same shape and purpose as `FacialVerificationProvider`
 * (lib/facial-verification/provider.ts) and `StorageProvider`
 * (lib/storage/provider.ts). Only a deterministic mock implementation exists
 * in V1 (mock-provider.ts); production provider selection is blocked — see
 * INTEGRATIONS.md GPS-BLOCKED.
 */

export interface TelematicsConnectionResult {
  ok: boolean;
  message?: string;
}

export interface ProviderVehicle {
  providerVehicleId: string;
  registrationNumber?: string;
}

export interface VehiclePosition {
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  headingDegrees: number | null;
  recordedAt: Date;
}

export interface VehicleTelematicsSnapshot {
  providerVehicleId: string;
  position: VehiclePosition | null;
  ignitionOn: boolean | null;
  odometerKm: number | null;
  lastCommunicationAt: Date | null;
  providerReference: string;
}

export class TelematicsProviderUnavailableError extends Error {
  constructor(message = "The telematics provider is currently unavailable.") {
    super(message);
    this.name = "TelematicsProviderUnavailableError";
  }
}

export interface TelematicsProvider {
  testConnection(): Promise<TelematicsConnectionResult>;
  listVehicles(): Promise<ProviderVehicle[]>;
  /**
   * Normalised current status for one vehicle. Throws
   * `TelematicsProviderUnavailableError` (a typed error, not a raw
   * network/parse failure — GPS-006) if the provider can't be reached.
   */
  getSnapshot(providerVehicleId: string): Promise<VehicleTelematicsSnapshot>;
}

/** Honest fail-closed provider used until a tenant-approved live adapter exists. */
export class DisabledTelematicsProvider implements TelematicsProvider {
  async testConnection(): Promise<TelematicsConnectionResult> {
    return { ok: false, message: "No production tracker provider is configured." };
  }

  async listVehicles(): Promise<ProviderVehicle[]> {
    throw new TelematicsProviderUnavailableError("No production tracker provider is configured.");
  }

  async getSnapshot(): Promise<VehicleTelematicsSnapshot> {
    throw new TelematicsProviderUnavailableError("No production tracker provider is configured.");
  }
}
