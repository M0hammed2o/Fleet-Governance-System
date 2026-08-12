import crypto from "node:crypto";
import type {
  TelematicsProvider,
  TelematicsConnectionResult,
  ProviderVehicle,
  VehicleTelematicsSnapshot,
} from "@/lib/telematics/provider";
import { TelematicsProviderUnavailableError } from "@/lib/telematics/provider";

// Deliberately artificial coordinates that are recognisable as test data,
// not a plausible real tracked location.
const DEFAULT_LATITUDE = 0.123456;
const DEFAULT_LONGITUDE = 0.654321;

/**
 * Deterministic dev/test provider — no real vendor connection. Behaviour is
 * driven entirely by `force:<outcome>` markers in `providerVehicleId`, same
 * pattern as `MockFacialVerificationProvider`:
 *   "force:unavailable" — throws TelematicsProviderUnavailableError (GPS-006).
 *   "force:offline" — returns a snapshot with no current position and a
 *     `lastCommunicationAt` far in the past (stale data, GPS-006).
 *   "force:ignition-off" — ignitionOn: false.
 *   "force:at:<lat>,<lng>" — returns that exact position (for geofence tests).
 * Anything else returns a normal-looking live snapshot near
 * DEFAULT_LATITUDE/LONGITUDE.
 */
export class MockTelematicsProvider implements TelematicsProvider {
  async testConnection(): Promise<TelematicsConnectionResult> {
    return { ok: true, message: "Mock telematics provider — no real connection." };
  }

  async listVehicles(): Promise<ProviderVehicle[]> {
    return [];
  }

  async getSnapshot(providerVehicleId: string): Promise<VehicleTelematicsSnapshot> {
    if (providerVehicleId.includes("force:unavailable")) {
      throw new TelematicsProviderUnavailableError("Mock provider forced unavailability.");
    }

    const providerReference = `mock-${providerVehicleId}-${Date.now()}-${crypto.randomUUID()}`;

    if (providerVehicleId.includes("force:offline")) {
      return {
        providerVehicleId,
        position: null,
        ignitionOn: null,
        odometerKm: null,
        lastCommunicationAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        providerReference,
      };
    }

    let latitude = DEFAULT_LATITUDE;
    let longitude = DEFAULT_LONGITUDE;
    const atMatch = providerVehicleId.match(/force:at:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (atMatch) {
      latitude = Number(atMatch[1]);
      longitude = Number(atMatch[2]);
    }

    const now = new Date();
    return {
      providerVehicleId,
      position: { latitude, longitude, speedKmh: 42, headingDegrees: 90, recordedAt: now },
      ignitionOn: !providerVehicleId.includes("force:ignition-off"),
      odometerKm: 12345,
      lastCommunicationAt: now,
      providerReference,
    };
  }
}
