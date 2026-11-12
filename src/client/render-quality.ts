export const qualities = {
  balanced: { label: '均衡', ratio: 1.3, detail: true },
  fast: { label: '流畅', ratio: 1, detail: false },
  detailed: { label: '清晰', ratio: 1.8, detail: true },
} as const;
export type Quality = keyof typeof qualities;

// Adapt supersampling, never blur below one physical sample per CSS pixel.
// HUD text is rendered separately and remains at the display's native density.
export function renderRatio(deviceRatio: number, quality: Quality, scale: number): number {
  const base = Math.min(Math.max(1, deviceRatio), qualities[quality].ratio);
  return Math.max(1, base * Math.min(1, Math.max(0.7, scale)));
}
