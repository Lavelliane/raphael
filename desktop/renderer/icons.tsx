import { Alien, Atom, Drop, Fire, Sparkle } from "@phosphor-icons/react";
export const personas: Record<string, string> = {
  sage: "Great Sage",
  pair: "Pair programmer",
  reviewer: "Reviewer",
  coach: "Coach",
};
export const avatars: Record<string, string> = {
  sage: "Sage",
  slime: "Slime",
  flame: "Ember",
  orbit: "Orbit",
};
export function Avatar({ name, size = 21 }: { name: string; size?: number }) {
  const Icon =
    { sage: Alien, slime: Drop, flame: Fire, orbit: Atom }[name] || Sparkle;
  return <Icon size={size} weight="duotone" />;
}
