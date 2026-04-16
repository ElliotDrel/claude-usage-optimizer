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

export interface ExtraUsageData {
  isEnabled: boolean;
  monthlyLimit: number | null;
  usedCredits: number | null;
  utilization: number | null;
}

export interface NormalizedPayload {
  windows: NormalizedWindow[];
  extras: NormalizedExtra[];
  extraUsage: ExtraUsageData | null;
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
  let extraUsage: ExtraUsageData | null = null;

  for (const [key, value] of Object.entries(payload)) {
    if (isUsageBucket(value)) {
      windows.push({
        key,
        label: toLabel(key),
        utilization: value.utilization,
        resetsAt: value.resets_at,
      });
    } else if (key === "extra_usage" && value && typeof value === "object") {
      const eu = value as Record<string, unknown>;
      extraUsage = {
        isEnabled: eu.is_enabled === true,
        monthlyLimit: typeof eu.monthly_limit === "number" ? eu.monthly_limit : null,
        usedCredits: typeof eu.used_credits === "number" ? eu.used_credits : null,
        utilization: typeof eu.utilization === "number" ? eu.utilization : null,
      };
      // Still push to extras for raw display
      extras.push({ key, label: toLabel(key), value });
    } else {
      unknownKeys[key] = value;
    }
  }

  windows.sort((a, b) => a.label.localeCompare(b.label));
  return { windows, extras, extraUsage, unknownKeys };
}
