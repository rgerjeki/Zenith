# Zenith

**The sky above you, right now.**

I've always been drawn to the sky, and everything beyond it. Zenith is a
first-person view of _yours_: it takes your location, lowers you onto your exact
spot on Earth, and gives you the real sky overhead, one you can drag to look around. Tap a planet, the Moon, a star, or the
ISS streaking overhead, and you **travel to it** through the real stars while
**Google Gemini** writes a short, wonder-filled explanation of what you're actually
seeing, from where you are, at this very moment, and **ElevenLabs** reads it aloud
in a warm voice.

> **DEV Weekend Challenge, theme: _passion_.** Built in one weekend, from an empty
> folder.

## The passion behind it

The theme was passion, and mine has always been the sky and everything beyond it.
Day or night, there's a specific kind of awe in remembering that the sky isn't a
backdrop. It's real, it's _happening right now_, and every point of light is an
actual place. Night is simply when you can see the most of it.

I wanted that feeling in a browser tab: not information about space, but the quiet,
enormous wonder of looking up and knowing, for a moment, exactly what you're
looking at. Zenith is my attempt at it.

---

## What it does

- **Finds you.** Share your location (or type any city), and Zenith computes the
  real sky for your exact latitude, longitude, and the current moment.
- **Drops you in.** A cinematic descent swoops from Earth-in-space down to your
  spot and hands off into a first-person sky you can drag to look around, with a
  real horizon, cardinal directions, and thousands of real stars.
- **Shows the real sky.** Every star is a real star (Yale Bright Star Catalog /
  HYG database) placed at its true altitude and azimuth, coloured by its real
  temperature. The Moon and every visible planet are computed live and placed
  exactly where they are, and the Moon even shows its correct lit phase.
- **Tracks the ISS.** The real International Space Station, fetched live, crosses
  your sky in real time with a glowing trail whenever it's above your horizon.
- **Lets you travel.** Tap any object and fly to it through the real starfield;
  it grows as you approach and resolves into a detailed close-up with real facts
  and a briefing **written by Google Gemini**.
- **Reads you the sky.** A warm voice narrates each briefing aloud by **ElevenLabs**:
  someone reading the heavens to you. Toggle it on or off any time.
- **Reminds you who's up there.** "N humans in space right now," with their
  names.

## The briefings: Google AI (Gemini)

The heart of Zenith runs on **Google AI**. Tapping an object calls a serverless
function ([`/api/briefing.js`](api/briefing.js)) that proxies **Google Gemini** (a
Flash model) to generate a short, vivid, _factually grounded_ description of
exactly what you're looking at, woven from the object's real computed data
(distance in light-years or light-minutes, direction, brightness, phase, orbital
speed, and more) with strict instructions never to invent numbers. It's what turns
a dot on a screen into "that's Saturn, its light left it 78 minutes ago."

- The **API key stays server-side** (env var `GEMINI_API_KEY`) and is never
  exposed to the browser.
- The model defaults to `gemini-3.5-flash` and is overridable via `GEMINI_MODEL`.
- It **degrades gracefully**: if the key is missing, the API is rate-limited, or
  a request fails, Zenith falls back to a locally-written blurb so the experience
  is never broken.

_(This is the entry for the **Best use of Google AI** category.)_

## The voice: ElevenLabs

Each briefing is also **read aloud** by a warm, calm voice via
[`/api/narrate.js`](api/narrate.js), which proxies **ElevenLabs**
text-to-speech. It turns Zenith from something you read into something that
_speaks to you_: someone reading you the sky as you arrive at each object. The
`ELEVENLABS_API_KEY` stays server-side, and a toggle lets you mute it any time
(your choice is remembered).

If ElevenLabs is unavailable (no key, or its free tier is spent), narration falls
back to **Kokoro-82M**, an open-weight (Apache-2.0) text-to-speech model that runs
**entirely in your browser** via [kokoro-js](https://github.com/hexgrad/kokoro)
(WebGPU, with a WASM fallback). The ~86 MB model is fetched only when the fallback
is first needed. So the sky always has a voice, with no API limit, while
ElevenLabs stays the premium default.

_(This is the entry for the **Best use of ElevenLabs** category.)_

## Tech

- **Vite + vanilla JavaScript.** No framework, lightweight and fast.
- **Three.js** for the 3D Earth, the interactive sky dome, and the travel-to-object
  focus view.
- **astronomy-engine** for real celestial mechanics (planet/Moon/Sun positions as
  altitude/azimuth, Moon phase, illumination), computed client-side, no API key.
- **Vercel serverless functions**: `/api/briefing` (Gemini proxy), `/api/narrate`
  (ElevenLabs text-to-speech proxy), and `/api/humans` (proxies the HTTP-only
  "humans in space" feed so it works on HTTPS). All keys stay server-side.

## Data sources & attribution

- **Stars**: the [HYG database](https://github.com/astronexus/HYG-Database)
  (which builds on the Yale Bright Star Catalog), filtered to naked-eye stars,
  with proper names, Bayer/Flamsteed designations, distances, and colour indices.
- **Planets, Moon, Sun**: computed locally with
  [astronomy-engine](https://github.com/cosinekitty/astronomy).
- **ISS position**: [wheretheiss.at](https://wheretheiss.at/) (no key).
- **Humans in space**: [Open Notify](http://open-notify.org/) `astros.json`.
- **City geocoding** (manual location entry):
  [Open-Meteo](https://open-meteo.com/) geocoding API (no key).
- **Planet & Moon close-up textures**: [Solar System
  Scope](https://www.solarsystemscope.com/textures/), licensed **CC BY 4.0**.
- **Earth texture**: NASA Blue Marble (via the Three.js examples assets).
- **Voice**: [ElevenLabs](https://elevenlabs.io) (premium), with an in-browser
  fallback via [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
  (Apache-2.0) through [kokoro-js](https://github.com/hexgrad/kokoro).

## Running it locally

```bash
npm install
npm run dev          # frontend only (Vite); AI briefings use the local fallback
```

For the full experience (real Gemini briefings and humans-in-space), run the whole
thing with the Vercel CLI so the frontend and the `/api` functions run together:

```bash
cp .env.example .env   # add your GEMINI_API_KEY
vercel dev
```

Deploy target is **Vercel**: push the repo and set `GEMINI_API_KEY` in the
project's environment variables.
