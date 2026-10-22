import { Color } from "three";

export const PALETTE = {
  mat: "#2B5A4A",
  matDeep: "#173A30",
  matLine: "#8DB8A6",
  paper: "#F7F5EF",
  ink: "#163A2F",
  marker: "#D9372B",
  steel: "#C9CCC8",
  scan: "#FFF6D8",
  shadow: "#0B2019",
  desk: "#0F241D",
} as const;

export type PaletteName = keyof typeof PALETTE;

export function linearColor(name: PaletteName): Color {
  return new Color(PALETTE[name]);
}
