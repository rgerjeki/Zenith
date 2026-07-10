// Shared constants. Milestone 2 hardcodes the observer; milestone 3 replaces
// this with real browser geolocation (with a manual fallback).

export const OBSERVER = {
  lat: 40.7128,
  lon: -74.006,
  label: 'New York City',
};

// Radii of the concentric shells the world is built from (camera sits at the
// origin, looking outward). Kept well inside the camera's far plane.
export const RADIUS = {
  stars: 500,
  cardinals: 480,
  ground: 950,
  sky: 1000,
};

// Naked-eye magnitude range we map star size/brightness across.
// Lower magnitude = brighter star. Sirius is ~-1.46; the faint limit is ~6.5.
export const MAG_LIMIT = 6.5;
export const MAG_BRIGHT = -1.5;
