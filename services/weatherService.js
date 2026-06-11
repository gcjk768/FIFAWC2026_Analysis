'use strict';

const fetch = require('node-fetch');

// ─── VENUE COORDINATES ────────────────────────────────────────────────────────

/** WC2026 venue → { lat, lon, city, altitude? } */
const VENUE_COORDS = {
  'MetLife Stadium, New York/New Jersey':   { lat: 40.8135,  lon: -74.0745,  city: 'East Rutherford, NJ' },
  'AT&T Stadium, Dallas':                  { lat: 32.7480,  lon: -97.0930,  city: 'Arlington, TX' },
  'SoFi Stadium, Los Angeles':             { lat: 33.9535,  lon: -118.3392, city: 'Inglewood, CA' },
  "Levi's Stadium, San Francisco Bay Area":{ lat: 37.4032,  lon: -121.9698, city: 'Santa Clara, CA' },
  'Allegiant Stadium, Las Vegas':          { lat: 36.0908,  lon: -115.1833, city: 'Las Vegas, NV' },
  'State Farm Stadium, Glendale':          { lat: 33.5276,  lon: -112.2626, city: 'Glendale, AZ' },
  'Arrowhead Stadium, Kansas City':        { lat: 39.0490,  lon: -94.4839,  city: 'Kansas City, MO' },
  'Empower Field, Denver':                 { lat: 39.7440,  lon: -105.0201, city: 'Denver, CO', altitudeM: 1609 },
  'NRG Stadium, Houston':                  { lat: 29.6847,  lon: -95.4107,  city: 'Houston, TX' },
  'Hard Rock Stadium, Miami':              { lat: 25.9580,  lon: -80.2389,  city: 'Miami Gardens, FL' },
  'Lincoln Financial Field, Philadelphia': { lat: 39.9007,  lon: -75.1675,  city: 'Philadelphia, PA' },
  'Gillette Stadium, Boston':              { lat: 42.0909,  lon: -71.2643,  city: 'Foxborough, MA' },
  'BC Place, Vancouver':                   { lat: 49.2769,  lon: -123.1116, city: 'Vancouver, BC' },
  'Estadio Azteca, Mexico City':           { lat: 19.3029,  lon: -99.1505,  city: 'Mexico City', altitudeM: 2240 },
  'Estadio Akron, Guadalajara':            { lat: 20.6893,  lon: -103.4672, city: 'Guadalajara', altitudeM: 1566 },
  'BMO Field, Toronto':                    { lat: 43.6333,  lon: -79.4186,  city: 'Toronto, ON' },
};

// WMO weather code → human-readable description
const WMO_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
  95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Thunderstorm + heavy hail',
};

// ─── OPEN-METEO FETCH ─────────────────────────────────────────────────────────

/**
 * Fetch a daily weather forecast for a venue on a specific date.
 * Uses Open-Meteo API — free, no key required.
 *
 * @param {string} venue - must match a key in VENUE_COORDS
 * @param {string} dateStr - YYYY-MM-DD (SGT date of the match)
 * @returns {Promise<object|null>} weather object or null on failure
 */
async function fetchMatchWeather(venue, dateStr) {
  const coords = VENUE_COORDS[venue];
  if (!coords) return null;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', coords.lat);
  url.searchParams.set('longitude', coords.lon);
  url.searchParams.set('daily', [
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max',
    'windspeed_10m_max',
    'weathercode',
  ].join(','));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '16');

  try {
    const resp = await fetch(url.toString(), { timeout: 8000 });
    if (!resp.ok) return null;
    const data = await resp.json();

    const dates = data.daily?.time || [];
    const idx = dates.indexOf(dateStr);
    if (idx === -1) return null;

    const tempMax   = data.daily.temperature_2m_max?.[idx];
    const tempMin   = data.daily.temperature_2m_min?.[idx];
    const rainPct   = data.daily.precipitation_probability_max?.[idx];
    const windKph   = data.daily.windspeed_10m_max?.[idx];
    const wmoCode   = data.daily.weathercode?.[idx];
    const condition = WMO_CODES[wmoCode] ?? 'Unknown';

    return {
      venue,
      city: coords.city,
      date: dateStr,
      condition,
      tempMaxC: tempMax,
      tempMinC: tempMin,
      rainProbPct: rainPct,
      windKph,
      altitudeM: coords.altitudeM || null,
    };
  } catch (err) {
    console.warn(`[WEATHER] Fetch failed for ${venue} on ${dateStr}:`, err.message);
    return null;
  }
}

// ─── CONTEXT STRING ───────────────────────────────────────────────────────────

/**
 * Build a weather context string to inject into Ollama prompts.
 * Highlights conditions that could affect match outcome.
 *
 * @param {object|null} weather
 * @returns {string}
 */
function buildWeatherContext(weather) {
  if (!weather) return '';

  const lines = [
    `--- MATCH DAY WEATHER (${weather.city}) ---`,
    `Condition: ${weather.condition}`,
    `Temperature: ${weather.tempMinC}°C – ${weather.tempMaxC}°C`,
    `Wind: ${weather.windKph} km/h`,
    `Rain probability: ${weather.rainProbPct}%`,
  ];

  if (weather.altitudeM) {
    lines.push(`Altitude: ${weather.altitudeM}m above sea level — thinner air, stamina impacted, ball travels faster`);
  }

  // Flag conditions that materially affect football
  const flags = [];
  if (weather.tempMaxC >= 35) flags.push(`EXTREME HEAT (${weather.tempMaxC}°C) — significant stamina drain, favours physically conditioned teams`);
  if (weather.rainProbPct >= 60) flags.push(`HIGH RAIN RISK (${weather.rainProbPct}%) — wet pitch suits direct, physical play; reduces technical precision`);
  if (weather.windKph >= 40) flags.push(`STRONG WIND (${weather.windKph} km/h) — affects long balls, crossing, and set pieces`);
  if (weather.altitudeM >= 1500) flags.push(`HIGH ALTITUDE (${weather.altitudeM}m) — teams unaccustomed to altitude will fatigue faster in second half`);
  if (['Thunderstorm', 'Thunderstorm + hail', 'Thunderstorm + heavy hail'].some((c) => weather.condition.startsWith('Thunderstorm'))) {
    flags.push('THUNDERSTORM RISK — potential disruption to play; match may be paused');
  }

  if (flags.length > 0) {
    lines.push('');
    lines.push('⚠️ Key weather factors:');
    flags.forEach((f) => lines.push(`  • ${f}`));
  }

  return lines.join('\n');
}

module.exports = { fetchMatchWeather, buildWeatherContext, VENUE_COORDS };
