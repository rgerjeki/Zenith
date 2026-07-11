import { constellationName } from '../data/constellations.js';

// Turn a selected object's metadata into everything the focus card and the
// Gemini prompt need: a title, a subtitle, human-readable fact rows, and a
// grounded facts object for the AI (never invents, only what's real).

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const COMPASS_WORDS = {
  N: 'the north', NNE: 'the north-northeast', NE: 'the northeast', ENE: 'the east-northeast',
  E: 'the east', ESE: 'the east-southeast', SE: 'the southeast', SSE: 'the south-southeast',
  S: 'the south', SSW: 'the south-southwest', SW: 'the southwest', WSW: 'the west-southwest',
  W: 'the west', WNW: 'the west-northwest', NW: 'the northwest', NNW: 'the north-northwest',
};

function compass(az) {
  return COMPASS[Math.round(az / 22.5) % 16];
}
function altWord(alt) {
  if (alt >= 75) return 'almost directly overhead';
  if (alt >= 55) return 'high';
  if (alt >= 30) return 'well up';
  if (alt >= 12) return 'low';
  return 'just above the horizon';
}
function skyPhrase(alt, az) {
  return `${altWord(alt)} in ${COMPASS_WORDS[compass(az)]}`;
}
function skyRow(alt, az) {
  return `${compass(az)} · ${Math.round(alt)}° up`;
}

const PC_TO_LY = 3.26156;

const PLANET_SUBTITLE = {
  Mercury: 'The smallest planet, closest to the Sun',
  Venus: "Earth's blazing-hot twin, the brightest planet",
  Mars: 'The red planet, fourth from the Sun',
  Jupiter: 'The largest planet, a giant of gas and storms',
  Saturn: 'The ringed gas giant',
  Uranus: 'A tilted ice giant on the edge of naked-eye visibility',
  Neptune: 'The farthest planet, a deep-blue ice giant',
};

function moonPhaseName(phaseDeg, illum) {
  // phaseDeg: 0 new -> 90 first quarter -> 180 full -> 270 last quarter.
  const waxing = phaseDeg < 180;
  if (illum < 0.03) return 'new moon';
  if (illum > 0.97) return 'full moon';
  const quarter = Math.abs(illum - 0.5) < 0.06;
  if (quarter) return waxing ? 'first quarter' : 'last quarter';
  const gibbous = illum > 0.5;
  const shape = gibbous ? 'gibbous' : 'crescent';
  return `${waxing ? 'waxing' : 'waning'} ${shape}`;
}

export function describeObject(meta) {
  const dir = { alt: meta.alt, az: meta.az };

  if (meta.kind === 'star') {
    const title = meta.name || meta.desig || 'Unnamed star';
    const subtitle = meta.con ? `A star in ${constellationName(meta.con)}` : 'A distant star';
    const ly = meta.distPc > 0 ? Math.round(meta.distPc * PC_TO_LY) : null;
    const rows = [
      ['In the sky', skyRow(dir.alt, dir.az)],
      ['Brightness', `magnitude ${meta.mag.toFixed(1)}`],
    ];
    if (ly) rows.push(['Distance', `${ly.toLocaleString()} light-years`]);
    if (meta.desig && meta.desig !== title) rows.push(['Designation', meta.desig]);
    return {
      title,
      subtitle,
      rows,
      payload: {
        name: title,
        kind: 'star',
        subtitle,
        facts: {
          'what it is': subtitle,
          distance: ly ? `${ly.toLocaleString()} light-years away (its light left it ${ly.toLocaleString()} years ago)` : 'distance not well known',
          brightness: `apparent magnitude ${meta.mag.toFixed(1)}`,
          'where it is': skyPhrase(dir.alt, dir.az),
          designation: meta.desig || undefined,
        },
      },
    };
  }

  if (meta.kind === 'planet') {
    const mkm = meta.distKm / 1e6;
    const lightMin = meta.distKm / (299792.458 * 60);
    const subtitle = PLANET_SUBTITLE[meta.name] || 'A planet';
    const rows = [
      ['In the sky', skyRow(dir.alt, dir.az)],
      ['Distance', `${mkm.toFixed(0)} million km`],
      ['Light delay', `${lightMin.toFixed(0)} min`],
    ];
    if (meta.mag != null) rows.push(['Brightness', `magnitude ${meta.mag.toFixed(1)}`]);
    return {
      title: meta.name,
      subtitle,
      rows,
      payload: {
        name: meta.name,
        kind: 'planet',
        subtitle,
        facts: {
          'what it is': subtitle,
          distance: `${mkm.toFixed(0)} million km away right now; its light takes about ${lightMin.toFixed(0)} minutes to reach you`,
          brightness: meta.mag != null ? `apparent magnitude ${meta.mag.toFixed(1)}` : undefined,
          'where it is': skyPhrase(dir.alt, dir.az),
        },
      },
    };
  }

  if (meta.kind === 'sun') {
    const mkm = meta.distKm / 1e6;
    const lightMin = meta.distKm / (299792.458 * 60);
    return {
      title: 'The Sun',
      subtitle: 'Our star',
      rows: [
        ['In the sky', skyRow(dir.alt, dir.az)],
        ['Distance', `${mkm.toFixed(1)} million km`],
        ['Light delay', `${lightMin.toFixed(1)} min`],
      ],
      payload: {
        name: 'The Sun',
        kind: 'sun',
        subtitle: 'the star at the center of our solar system',
        facts: {
          'what it is': 'the star our planet orbits',
          distance: `${mkm.toFixed(1)} million km away; its light takes about ${lightMin.toFixed(1)} minutes to reach you`,
          'where it is': skyPhrase(dir.alt, dir.az),
        },
      },
    };
  }

  if (meta.kind === 'moon') {
    const km = Math.round(meta.distKm);
    const pct = Math.round((meta.illumination || 0) * 100);
    const phase = moonPhaseName(meta.moonPhase ?? 0, meta.illumination ?? 0);
    return {
      title: 'The Moon',
      subtitle: "Earth's only natural satellite",
      rows: [
        ['In the sky', skyRow(dir.alt, dir.az)],
        ['Phase', phase],
        ['Illuminated', `${pct}%`],
        ['Distance', `${km.toLocaleString()} km`],
      ],
      payload: {
        name: 'The Moon',
        kind: 'moon',
        subtitle: "Earth's only natural satellite",
        facts: {
          phase: `${phase}, ${pct}% illuminated`,
          distance: `${km.toLocaleString()} km from you right now`,
          'where it is': skyPhrase(dir.alt, dir.az),
        },
      },
    };
  }

  // ISS
  const km = Math.round(meta.altitudeKm);
  const range = Math.round(meta.rangeKm);
  const speed = Math.round(meta.velocityKmh);
  return {
    title: 'The ISS',
    subtitle: 'The International Space Station: crewed, orbiting Earth',
    rows: [
      ['In the sky', skyRow(dir.alt, dir.az)],
      ['Altitude', `${km} km up`],
      ['Speed', `${speed.toLocaleString()} km/h`],
      ['Distance from you', `${range.toLocaleString()} km`],
    ],
    payload: {
      name: 'The International Space Station',
      kind: 'iss',
      subtitle: 'A crewed spacecraft orbiting Earth',
      facts: {
        altitude: `orbiting about ${km} km above Earth`,
        speed: `travelling roughly ${speed.toLocaleString()} km/h`,
        distance: `about ${range.toLocaleString()} km from you`,
        'where it is': skyPhrase(dir.alt, dir.az),
        note: 'there are people aboard it right now',
      },
    },
  };
}
