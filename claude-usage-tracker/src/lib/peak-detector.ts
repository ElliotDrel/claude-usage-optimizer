// Stub for PeakBlock type — full implementation in Plan 02-01
// This file exists so schedule.ts can compile before the parallel plan lands.

export interface PeakBlock {
  startHour: number;
  endHour: number;
  sumDelta: number;
  midpoint: number; // (startHour + 2) % 24
}

export function detectPeakBlock(_hourlyDeltas: number[]): PeakBlock | null {
  throw new Error("detectPeakBlock not yet implemented — stub only");
}
