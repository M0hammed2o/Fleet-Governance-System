import "server-only";
import {
  classifyTrackerFreshness,
  type TrackerCollectionMethod,
  type TrackerCorrectionStatus,
  type TrackerDataSource,
  type TrackerMappingState,
  type TrackerPosition,
  type TrackerProcessingStatus,
} from "@/lib/telematics/integration-contract";

export type SpeedUnit = "KMH" | "MPH" | "MPS";
export type DistanceUnit = "KM" | "MILES" | "METERS";

export interface ProviderNeutralObservation {
  providerAssetId: unknown;
  latitude: unknown;
  longitude: unknown;
  eventTime: unknown;
  lastCommunicationAt?: unknown;
  online?: unknown;
  ignitionOn?: unknown;
  moving?: unknown;
  speed?: unknown;
  speedUnit?: unknown;
  headingDegrees?: unknown;
  odometer?: unknown;
  odometerUnit?: unknown;
  accuracyMeters?: unknown;
  fuelPercent?: unknown;
  driverReference?: unknown;
}

export interface NormalizationContext {
  now: Date;
  source: TrackerDataSource;
  collectionMethod: TrackerCollectionMethod;
  mappingState: TrackerMappingState;
  synthetic: boolean;
  seenEventIds?: Set<string>;
  providerEventId?: string;
  latestAcceptedEventTime?: Date | null;
  staleAfterMs?: number;
  lateAfterMs?: number;
}

export interface NormalizationResult {
  status: TrackerProcessingStatus;
  position: TrackerPosition | null;
  reasons: string[];
  outOfOrder: boolean;
  late: boolean;
}

const FUTURE_SKEW_MS = 5 * 60 * 1000;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function date(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function speedToKmh(value: number, unit: SpeedUnit): number {
  if (unit === "MPH") return value * 1.609344;
  if (unit === "MPS") return value * 3.6;
  return value;
}

export function distanceToKm(value: number, unit: DistanceUnit): number {
  if (unit === "MILES") return value * 1.609344;
  if (unit === "METERS") return value / 1_000;
  return value;
}

export function normalizeTrackerObservation(raw: ProviderNeutralObservation, context: NormalizationContext): NormalizationResult {
  const reasons: string[] = [];
  const providerAssetId = typeof raw.providerAssetId === "string" ? raw.providerAssetId.trim() : "";
  const latitude = finite(raw.latitude);
  const longitude = finite(raw.longitude);
  const gpsTimestamp = date(raw.eventTime);
  const lastCommunicationAt = date(raw.lastCommunicationAt ?? raw.eventTime);

  if (!providerAssetId) reasons.push("providerAssetId is missing");
  if (latitude === null || latitude < -90 || latitude > 90) reasons.push("latitude is outside the valid range");
  if (longitude === null || longitude < -180 || longitude > 180) reasons.push("longitude is outside the valid range");
  if (!gpsTimestamp) reasons.push("eventTime is invalid");
  else if (gpsTimestamp.getTime() > context.now.getTime() + FUTURE_SKEW_MS) reasons.push("eventTime exceeds the permitted future clock skew");
  if (!lastCommunicationAt) reasons.push("lastCommunicationAt is invalid");
  else if (lastCommunicationAt.getTime() > context.now.getTime() + FUTURE_SKEW_MS) reasons.push("lastCommunicationAt exceeds the permitted future clock skew");

  const speed = raw.speed == null ? null : finite(raw.speed);
  const speedUnit = raw.speedUnit == null ? "KMH" : raw.speedUnit;
  if (speed === null && raw.speed != null) reasons.push("speed is not finite");
  if (speed !== null && speed < 0) reasons.push("speed cannot be negative");
  if (!(["KMH", "MPH", "MPS"] as unknown[]).includes(speedUnit)) reasons.push("speedUnit is unsupported");

  const odometer = raw.odometer == null ? null : finite(raw.odometer);
  const odometerUnit = raw.odometerUnit == null ? "KM" : raw.odometerUnit;
  if (odometer === null && raw.odometer != null) reasons.push("odometer is not finite");
  if (odometer !== null && odometer < 0) reasons.push("odometer cannot be negative");
  if (!(["KM", "MILES", "METERS"] as unknown[]).includes(odometerUnit)) reasons.push("odometerUnit is unsupported");

  const heading = raw.headingDegrees == null ? null : finite(raw.headingDegrees);
  if (heading === null && raw.headingDegrees != null) reasons.push("headingDegrees is not finite");
  if (heading !== null && (heading < 0 || heading >= 360)) reasons.push("headingDegrees is outside the valid range");
  const accuracy = raw.accuracyMeters == null ? null : finite(raw.accuracyMeters);
  if (accuracy === null && raw.accuracyMeters != null) reasons.push("accuracyMeters is not finite");
  if (accuracy !== null && accuracy < 0) reasons.push("accuracyMeters cannot be negative");
  const fuel = raw.fuelPercent == null ? null : finite(raw.fuelPercent);
  if (fuel === null && raw.fuelPercent != null) reasons.push("fuelPercent is not finite");
  if (fuel !== null && (fuel < 0 || fuel > 100)) reasons.push("fuelPercent is outside the valid range");

  if (context.mappingState !== "MAPPED") reasons.push(`mapping state is ${context.mappingState.toLowerCase()}`);
  if (reasons.length > 0 || !gpsTimestamp || !lastCommunicationAt || latitude === null || longitude === null) {
    return { status: "QUARANTINED", position: null, reasons, outOfOrder: false, late: false };
  }

  if (context.providerEventId && context.seenEventIds?.has(context.providerEventId)) {
    return { status: "DUPLICATE", position: null, reasons: ["provider event id has already been accepted"], outOfOrder: false, late: false };
  }

  const outOfOrder = Boolean(context.latestAcceptedEventTime && gpsTimestamp < context.latestAcceptedEventTime);
  const late = context.now.getTime() - gpsTimestamp.getTime() > (context.lateAfterMs ?? 24 * 60 * 60 * 1000);
  const correctionStatus: TrackerCorrectionStatus = "ORIGINAL";
  const confidenceLimitations = [
    ...(context.synthetic ? ["Synthetic test data; not observed from a real vehicle."] : []),
    ...(outOfOrder ? ["Event arrived out of chronological order."] : []),
    ...(late ? ["Event arrived after the configured late-event threshold."] : []),
    ...(accuracy === null ? ["Provider did not supply location accuracy."] : []),
  ];

  if (context.providerEventId) context.seenEventIds?.add(context.providerEventId);
  return {
    status: "ACCEPTED",
    reasons: [],
    outOfOrder,
    late,
    position: {
      providerAssetId,
      latitude,
      longitude,
      gpsTimestamp,
      lastCommunicationAt,
      online: typeof raw.online === "boolean" ? raw.online : null,
      ignitionOn: typeof raw.ignitionOn === "boolean" ? raw.ignitionOn : null,
      moving: typeof raw.moving === "boolean" ? raw.moving : null,
      speedKmh: speed === null ? null : speedToKmh(speed, speedUnit as SpeedUnit),
      headingDegrees: heading,
      odometerKm: odometer === null ? null : distanceToKm(odometer, odometerUnit as DistanceUnit),
      accuracyMeters: accuracy,
      fuelPercent: fuel,
      driverReference: typeof raw.driverReference === "string" ? raw.driverReference : null,
      source: context.source,
      collectionMethod: context.collectionMethod,
      receivedAt: context.now,
      normalizedAt: context.now,
      freshness: classifyTrackerFreshness(lastCommunicationAt, context.now, context.staleAfterMs),
      mappingState: context.mappingState,
      processingStatus: "ACCEPTED",
      correctionStatus,
      confidenceLimitations,
      synthetic: context.synthetic,
    },
  };
}
