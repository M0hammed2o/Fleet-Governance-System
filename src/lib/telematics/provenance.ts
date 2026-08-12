export type TrackerDisplayKind = "LIVE_PROVIDER" | "DELAYED_PROVIDER" | "MANUAL" | "ESTIMATED" | "SYNTHETIC" | "UNAVAILABLE";

export interface TrackerProvenanceDisplay {
  kind: TrackerDisplayKind;
  label: string;
  warning: string;
}

export function trackerProvenanceDisplay(input: { source: "PROVIDER" | "MANUAL" | "SYNTHETIC" | "ESTIMATED" | "UNAVAILABLE" | null; freshness: "FRESH" | "STALE" | "UNAVAILABLE" | null; isSynthetic: boolean }): TrackerProvenanceDisplay {
  if (input.isSynthetic || input.source === "SYNTHETIC") return { kind: "SYNTHETIC", label: "Synthetic — not live", warning: "Synthetic — not live. Generated test data; not observed from a real vehicle." };
  if (input.source === "MANUAL") return { kind: "MANUAL", label: "Manual confirmation", warning: "Human-reported location; not a tracker observation." };
  if (input.source === "ESTIMATED") return { kind: "ESTIMATED", label: "Estimated", warning: "Derived information; not a direct tracker observation." };
  if (input.source === "PROVIDER" && input.freshness === "FRESH") return { kind: "LIVE_PROVIDER", label: "Provider observation", warning: "Subject to provider accuracy, delay and mapping limitations." };
  if (input.source === "PROVIDER") return { kind: "DELAYED_PROVIDER", label: "Delayed provider observation", warning: "Stale or delayed; do not treat as current location." };
  return { kind: "UNAVAILABLE", label: "Tracker data unavailable", warning: "Missing tracker data is not proof of misconduct." };
}
