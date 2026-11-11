import { downsampleCoordinates } from './geo.js';

export const MAX_SHARE_HASH_LENGTH = 1800;

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function isValidCoordPair(coord) {
  return (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    Number.isFinite(Number(coord[0])) &&
    Number.isFinite(Number(coord[1])) &&
    Math.abs(Number(coord[0])) <= 180 &&
    Math.abs(Number(coord[1])) <= 90
  );
}

/**
 * Exports active snapped route (and pinned waypoints if available) to GPX 1.1 XML.
 */
export function exportRouteToGpx({
  name = 'Custom Bypass Route',
  snappedRoute,
  rawCoordinates = [],
  pinnedStopIndices = [],
} = {}) {
  const trackCoords = snappedRoute?.geometry?.coordinates?.length >= 2
    ? snappedRoute.geometry.coordinates
    : rawCoordinates;

  if (!Array.isArray(trackCoords) || trackCoords.length < 2) {
    throw new Error('Create a route before exporting to GPX.');
  }

  const safeName = escapeXml(name || 'Custom Bypass Route');
  const wptLines = (pinnedStopIndices || [])
    .filter((idx) => rawCoordinates[idx] && isValidCoordPair(rawCoordinates[idx]))
    .map((idx, pos) => {
      const [lng, lat] = rawCoordinates[idx];
      const label =
        pos === 0
          ? 'Start'
          : pos === pinnedStopIndices.length - 1
            ? 'Destination'
            : `Stop ${pos}`;
      return `  <wpt lat="${Number(lat).toFixed(6)}" lon="${Number(lng).toFixed(6)}"><name>${escapeXml(label)}</name></wpt>`;
    });

  const trkpts = trackCoords
    .filter(isValidCoordPair)
    .map(([lng, lat]) => `      <trkpt lat="${Number(lat).toFixed(6)}" lon="${Number(lng).toFixed(6)}"></trkpt>`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="TakeurRoute" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${safeName}</name></metadata>`,
    ...wptLines,
    '  <trk>',
    `    <name>${safeName}</name>`,
    '    <trkseg>',
    trkpts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ].join('\n');
}

function parsePointsFromXmlDom(xmlText) {
  const parser = new globalThis.DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid GPX XML file.');
  }

  const metaName =
    doc.querySelector('metadata > name')?.textContent ||
    doc.querySelector('trk > name')?.textContent ||
    doc.querySelector('rte > name')?.textContent ||
    '';

  const extractNodes = (tag) =>
    Array.from(doc.getElementsByTagName(tag))
      .map((el) => [Number(el.getAttribute('lon')), Number(el.getAttribute('lat'))])
      .filter(isValidCoordPair);

  const trkpts = extractNodes('trkpt');
  const rtepts = extractNodes('rtept');
  const wpts = extractNodes('wpt');

  return { metaName, trkpts, rtepts, wpts };
}

function parsePointsFromXmlRegexFallback(xmlText) {
  const nameMatch = xmlText.match(/<name[^>]*>([^<]+)<\/name>/i);
  const metaName = nameMatch ? unescapeXml(nameMatch[1].trim()) : '';

  const extractTagCoords = (tagName) => {
    const regex = new RegExp(`<${tagName}\\b([^>]+)>`, 'gi');
    const coords = [];
    let match;
    while ((match = regex.exec(xmlText)) !== null) {
      const attrs = match[1];
      const latMatch = attrs.match(/\blat\s*=\s*["']([^"']+)["']/i);
      const lonMatch = attrs.match(/\blon\s*=\s*["']([^"']+)["']/i);
      if (latMatch && lonMatch) {
        const pair = [Number(lonMatch[1]), Number(latMatch[1])];
        if (isValidCoordPair(pair)) {
          coords.push(pair);
        }
      }
    }
    return coords;
  };

  return {
    metaName,
    trkpts: extractTagCoords('trkpt'),
    rtepts: extractTagCoords('rtept'),
    wpts: extractTagCoords('wpt'),
  };
}

/**
 * Imports GPX 1.0/1.1 text into route coordinates and optional waypoint stops.
 */
export function importRouteFromGpx(xmlText) {
  const text = String(xmlText || '').trim();
  if (!text || !text.includes('<gpx')) {
    throw new Error('File does not appear to be valid GPX XML.');
  }

  const parsed =
    typeof globalThis.DOMParser !== 'undefined'
      ? parsePointsFromXmlDom(text)
      : parsePointsFromXmlRegexFallback(text);

  const routeCoordinates =
    parsed.trkpts.length >= 2
      ? parsed.trkpts
      : parsed.rtepts.length >= 2
        ? parsed.rtepts
        : parsed.wpts;

  if (!routeCoordinates || routeCoordinates.length < 2) {
    throw new Error('GPX file must contain at least 2 track, route, or waypoint coordinates.');
  }

  const isDirectionsStyle = parsed.trkpts.length < 2 && (parsed.rtepts.length >= 2 || parsed.wpts.length >= 2);
  return {
    name: parsed.metaName || 'Imported GPX Route',
    coordinates: routeCoordinates,
    pinnedStopIndices: isDirectionsStyle
      ? routeCoordinates.map((_, idx) => idx)
      : [0, routeCoordinates.length - 1],
    routeSourceMode: isDirectionsStyle && routeCoordinates.length <= 25 ? 'directions' : 'matching',
  };
}

/**
 * Exports active route & pinned stops to RFC 7946 GeoJSON FeatureCollection.
 */
export function exportRouteToGeoJson({
  name = 'Custom Bypass Route',
  snappedRoute,
  rawCoordinates = [],
  pinnedStopIndices = [],
} = {}) {
  const coordinates = snappedRoute?.geometry?.coordinates?.length >= 2
    ? snappedRoute.geometry.coordinates
    : rawCoordinates;

  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('Create a route before exporting GeoJSON.');
  }

  const features = [
    {
      type: 'Feature',
      properties: {
        name,
        role: 'route',
        distanceMeters: snappedRoute?.distance ?? null,
        durationSeconds: snappedRoute?.duration ?? null,
      },
      geometry: {
        type: 'LineString',
        coordinates: coordinates.map(([lng, lat]) => [
          Number(Number(lng).toFixed(6)),
          Number(Number(lat).toFixed(6)),
        ]),
      },
    },
  ];

  (pinnedStopIndices || []).forEach((idx, pos) => {
    const pt = rawCoordinates[idx];
    if (!isValidCoordPair(pt)) return;
    features.push({
      type: 'Feature',
      properties: {
        role: 'waypoint',
        stopOrder: pos,
        name:
          pos === 0
            ? 'Start'
            : pos === pinnedStopIndices.length - 1
              ? 'Destination'
              : `Stop ${pos}`,
      },
      geometry: {
        type: 'Point',
        coordinates: [Number(Number(pt[0]).toFixed(6)), Number(Number(pt[1]).toFixed(6))],
      },
    });
  });

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features,
    },
    null,
    2,
  );
}

/**
 * Parses GeoJSON FeatureCollection, Feature, or LineString into importable route waypoints.
 */
export function importRouteFromGeoJson(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(String(jsonText || ''));
  } catch {
    throw new Error('Invalid JSON in GeoJSON file.');
  }

  let routeCoords = null;
  let routeName = '';
  const waypointCoords = [];

  const extractLine = (geom) => {
    if (!geom) return null;
    if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      return geom.coordinates.filter(isValidCoordPair).map(([lng, lat]) => [Number(lng), Number(lat)]);
    }
    if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      const merged = geom.coordinates.flat().filter(isValidCoordPair);
      return merged.map(([lng, lat]) => [Number(lng), Number(lat)]);
    }
    return null;
  };

  if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    for (const feature of parsed.features) {
      const line = extractLine(feature?.geometry);
      if (line && line.length >= 2 && !routeCoords) {
        routeCoords = line;
        routeName = feature?.properties?.name || '';
      } else if (feature?.geometry?.type === 'Point' && isValidCoordPair(feature.geometry.coordinates)) {
        waypointCoords.push([
          Number(feature.geometry.coordinates[0]),
          Number(feature.geometry.coordinates[1]),
        ]);
      }
    }
  } else if (parsed?.type === 'Feature') {
    routeCoords = extractLine(parsed.geometry);
    routeName = parsed?.properties?.name || '';
  } else {
    routeCoords = extractLine(parsed);
  }

  const finalCoords =
    routeCoords && routeCoords.length >= 2
      ? routeCoords
      : waypointCoords.length >= 2
        ? waypointCoords
        : null;

  if (!finalCoords) {
    throw new Error('GeoJSON must include a LineString with at least 2 valid coordinates.');
  }

  const usesWaypoints = !routeCoords && waypointCoords.length >= 2;
  return {
    name: routeName || 'Imported GeoJSON Route',
    coordinates: finalCoords,
    pinnedStopIndices: usesWaypoints
      ? finalCoords.map((_, i) => i)
      : [0, finalCoords.length - 1],
    routeSourceMode: usesWaypoints && finalCoords.length <= 25 ? 'directions' : 'matching',
  };
}

function encodeSignedNumber(num) {
  let sgn = num < 0 ? ~(num << 1) : num << 1;
  let encoded = '';
  while (sgn >= 0x20) {
    encoded += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
    sgn >>= 5;
  }
  encoded += String.fromCharCode(sgn + 63);
  return encoded;
}

/**
 * Encodes [lng, lat] pairs using standard Google Polyline5 (1e5 precision) for compact URL hashes.
 */
export function encodePolyline5(coordinates) {
  let prevLat = 0;
  let prevLng = 0;
  let result = '';
  for (const [lng, lat] of coordinates) {
    const latInt = Math.round(Number(lat) * 1e5);
    const lngInt = Math.round(Number(lng) * 1e5);
    result += encodeSignedNumber(latInt - prevLat);
    result += encodeSignedNumber(lngInt - prevLng);
    prevLat = latInt;
    prevLng = lngInt;
  }
  return result;
}

export function decodePolyline5(encoded) {
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      if (index >= encoded.length) break;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length) break;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    const coord = [Number((lng / 1e5).toFixed(5)), Number((lat / 1e5).toFixed(5))];
    if (isValidCoordPair(coord)) {
      coordinates.push(coord);
    }
  }
  return coordinates;
}

/**
 * Serializes a route into a size-bounded `#route=...` URL hash safe for QR codes and sharing.
 */
export function encodeRouteToHash({
  coordinates = [],
  routeSourceMode = 'matching',
  profile = 'driving',
  name = '',
  maxHashLength = MAX_SHARE_HASH_LENGTH,
} = {}) {
  const validCoords = coordinates.filter(isValidCoordPair);
  if (validCoords.length < 2) {
    throw new Error('Route must have at least 2 points to generate a share link.');
  }

  const modeCode = routeSourceMode === 'directions' ? 'd' : 'm';
  const profileMap = {
    'driving-traffic': 'dt',
    driving: 'dr',
    cycling: 'cy',
    walking: 'wk',
  };
  const profCode = profileMap[profile] || 'dr';
  const cleanName = String(name || '')
    .trim()
    .slice(0, 40);
  const nameParam = cleanName ? `&n=${encodeURIComponent(cleanName)}` : '';

  const buildHash = (pts) => {
    const poly = encodeURIComponent(encodePolyline5(pts));
    return `#route=v1&m=${modeCode}&p=${profCode}${nameParam}&g=${poly}`;
  };

  let candidate = validCoords;
  let hash = buildHash(candidate);
  let wasSimplified = false;

  let budgetPoints = Math.min(candidate.length, 160);
  while (hash.length > maxHashLength && budgetPoints >= 2) {
    candidate = downsampleCoordinates(validCoords, budgetPoints);
    hash = buildHash(candidate);
    wasSimplified = true;
    budgetPoints = Math.max(2, Math.floor(budgetPoints * 0.72));
    if (candidate.length === 2) break;
  }

  return {
    hash,
    wasSimplified,
    pointCount: candidate.length,
    originalCount: validCoords.length,
  };
}

/**
 * Parses a shared `#route=...` URL hash back into route coordinates, mode, profile, and name.
 */
export function decodeRouteFromHash(hashString) {
  const raw = String(hashString || '').trim();
  if (!raw.startsWith('#route=')) return null;

  const queryPart = raw.slice('#route='.length);
  const params = new URLSearchParams(queryPart);
  const g = params.get('g');
  if (!g) return null;

  const coordinates = decodePolyline5(g);
  if (coordinates.length < 2) return null;

  const reverseProfile = {
    dt: 'driving-traffic',
    dr: 'driving',
    cy: 'cycling',
    wk: 'walking',
  };

  return {
    routeSourceMode: params.get('m') === 'd' ? 'directions' : 'matching',
    profile: reverseProfile[params.get('p')] || 'driving',
    name: params.get('n') || 'Shared Route',
    coordinates,
    pinnedStopIndices:
      params.get('m') === 'd' && coordinates.length <= 25
        ? coordinates.map((_, i) => i)
        : [0, coordinates.length - 1],
  };
}
