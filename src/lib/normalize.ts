export interface UsageBucket {
  utilization: number;
  resets_at: string;
}

export interface NormalizedWindow {
  key: string;
  label: string;
  utilization: number;
  resetsAt: string;
}

export interface NormalizedExtra {
  key: string;
  label: string;
  value: unknown;
}

export interface NormalizedPayload {
  windows: NormalizedWindow[];
  extras: NormalizedExtra[];
  unknownKeys: Record<string, unknown>;
}

function toLabel(key: string): string {
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isUsageBucket(value: unknown): value is UsageBucket {
  return (
    value != null &&
    typeof value === "object" &&
    "utilization" in value &&
    typeof (value as UsageBucket).utilization === "number" &&
    "resets_at" in value &&
    typeof (value as UsageBucket).resets_at === "string"
  );
}

export function normalizeUsagePayload(
  payload: Record<string, unknown>
): NormalizedPayload {
  const windows: NormalizedWindow[] = [];
  const extras: NormalizedExtra[] = [];
  const unknownKeys: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (isUsageBucket(value)) {
      windows.push({
        key,
        label: toLabel(key),
        utilization: value.utilization,
        resetsAt: value.resets_at,
      });
    } else if (key === "extra_usage" && value && typeof value === "object") {
      extras.push({ key, label: toLabel(key), value });
    } else {
      unknownKeys[key] = value;
    }
  }

  windows.sort((a, b) => a.label.localeCompare(b.label));
  return { windows, extras, unknownKeys };
}
