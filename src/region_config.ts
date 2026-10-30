/**
 * Generic regional-adapter configuration — the configurable half of the
 * intelligence layer.
 *
 * `civic_profile.ts` owns jurisdiction *identity* (name, timezone, geography
 * anchor, provider code, publication identity). This module owns jurisdiction
 * *adapter policy*: the forecast zones, station identifiers, counties, route
 * lists, provider endpoints and severity thresholds that a hazard/operational
 * monitor needs before it can run. Keeping them in one validated contract means
 * a monitor is a generic method parameterized by configuration, and a
 * deployment is a configuration rather than a fork.
 *
 * A `region-config/v1` document is bound to exactly one civic profile: its
 * `profileId` must equal the selected profile's `id`. The default document
 * reproduces the deployed Crescent City adapter policy, so default behavior is
 * unchanged. Set `REGION_CONFIG` to a bounded regular JSON file to select
 * another region; the loader reads it once per process.
 *
 * The contract carries no credentials and no local paths, and it is not a claim
 * that another municipality's live sources, forecast zones, utility service
 * areas or fisheries regimes exist. It records the parameters a reviewed
 * adapter would need; provider availability and source rights remain separate
 * evidence.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { openSync, closeSync, fstatSync, readSync, constants as fsConstants } from "node:fs";
import { isIP } from "node:net";
import { validateSchema, type ValueSchema } from "./schema_validation.js";
import { isPublicAddress } from "./shared/transport.js";
import { currentCivicProfile } from "./civic_profile.js";

/** Buoy/station descriptor for the marine-observation adapter. */
export interface MarineStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distanceNm: number;
}

/** A geographic watch box for the vessel-traffic adapter. */
export interface WatchBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface RegionAlerts {
  tsunami: { capArea: string };
  earthquake: { latitude: number; longitude: number; radiusKm: number; minMagnitude: number };
  weather: { nwsZone: string; latitude: number; longitude: number };
  tides: { stationId: string; stationName: string; highTideAlertFt: number };
  fishing: { region: string; bulletinUrl: string };
  airQuality: { zip: string; latitude: number; longitude: number; publicStationRadiusKm: number };
  wildfire: { counties: string[]; latitude: number; longitude: number; radiusKm: number };
  marine: { stations: MarineStation[]; waveHeightWarningFt: number; waveHeightWatchFt: number; windSpeedWarningKt: number; windSpeedWatchKt: number };
  marineForecast: { productLocation: string; zoneCode: string };
  drought: { fips: string; county: string; state: string };
  psps: { utility: string; county: string };
  smoke: { box: { lonMin: number; latMin: number; lonMax: number; latMax: number } };
  roads: { routes: string[]; textUrl: string; county: string };
  schools: { district: string; websiteUrl: string; alertsUrl: string; fallbackUrl: string };
  uscg: { district: number; windowDays: number; listUrl: string; messageUrl: string };
  permits: { catalogUrl: string };
  dredging: { sitemapUrl: string; windowDays: number };
  fuel: { state: string; seriesId: string; url: string; spikeThreshold: number; trendWeeks: number };
  pacfin: { dashboardUrl: string };
  ais: { feedUrl: string; watchBox: WatchBox };
}

export interface RegionConfig {
  schemaVersion: "region-config/v1";
  /** Must equal the selected civic profile `id`. */
  profileId: string;
  id: string;
  alerts: RegionAlerts;
}

const URL_PATTERN = "^https://[^\\s<>\"']{1,2048}$";
const coordinate = (minimum: number, maximum: number): ValueSchema => ({ type: "number", minimum, maximum });
const url: ValueSchema = { type: "string", pattern: URL_PATTERN };
const identifier = (pattern: string, maxLength = 63): ValueSchema => ({ type: "string", pattern, maxLength });
const closed = (properties: Record<string, ValueSchema>, required = Object.keys(properties)): ValueSchema =>
  ({ type: "object", properties, required, additionalProperties: false });

const stationSchema = closed({
  id: identifier("^[0-9]{5}$", 5),
  name: identifier("^[^\\u0000-\\u001f\\u007f]{1,100}$", 100),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  distanceNm: { type: "number", minimum: 0, maximum: 20_000 },
});

const boxSchema = closed({
  minLat: coordinate(-90, 90),
  maxLat: coordinate(-90, 90),
  minLon: coordinate(-180, 180),
  maxLon: coordinate(-180, 180),
});

/** Declarative `region-config/v1` schema; validated by the shared schema engine. */
export const REGION_CONFIG_SCHEMA: ValueSchema = closed({
  schemaVersion: { type: "string", const: "region-config/v1" },
  profileId: identifier("^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"),
  id: identifier("^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"),
  alerts: closed({
    tsunami: closed({ capArea: identifier("^[A-Z]{2}$", 2) }),
    earthquake: closed({ latitude: coordinate(-90, 90), longitude: coordinate(-180, 180), radiusKm: { type: "number", minimum: 1, maximum: 2000 }, minMagnitude: { type: "number", minimum: 0, maximum: 10 } }),
    weather: closed({ nwsZone: identifier("^[A-Z]{3}[0-9]{3}$", 6), latitude: coordinate(-90, 90), longitude: coordinate(-180, 180) }),
    tides: closed({ stationId: identifier("^[0-9]{7}$", 7), stationName: identifier("^[^\\u0000-\\u001f\\u007f]{1,100}$", 100), highTideAlertFt: { type: "number", minimum: 0, maximum: 30 } }),
    fishing: closed({ region: identifier("^[^\\u0000-\\u001f\\u007f]{1,100}$", 100), bulletinUrl: url }),
    airQuality: closed({ zip: identifier("^[0-9]{5}$", 5), latitude: coordinate(-90, 90), longitude: coordinate(-180, 180), publicStationRadiusKm: { type: "number", minimum: 1, maximum: 500 } }),
    wildfire: closed({ counties: { type: "array", minItems: 1, maxItems: 25, uniqueItems: true, items: identifier("^[^\\u0000-\\u001f\\u007f]{1,100}$", 100) }, latitude: coordinate(-90, 90), longitude: coordinate(-180, 180), radiusKm: { type: "number", minimum: 1, maximum: 2000 } }),
    marine: closed({ stations: { type: "array", minItems: 1, maxItems: 25, items: stationSchema }, waveHeightWarningFt: { type: "number", minimum: 0, maximum: 200 }, waveHeightWatchFt: { type: "number", minimum: 0, maximum: 200 }, windSpeedWarningKt: { type: "number", minimum: 0, maximum: 500 }, windSpeedWatchKt: { type: "number", minimum: 0, maximum: 500 } }),
    marineForecast: closed({ productLocation: identifier("^[A-Z]{3,4}$", 4), zoneCode: identifier("^[A-Z]{3}[0-9]{3}$", 6) }),
    drought: closed({ fips: identifier("^[0-9]{5}$", 5), county: identifier("^[^\\u0000-\\u001f\\u007f]{1,100}$", 100), state: identifier("^[A-Z]{2}$", 2) }),
    psps: closed({ utility: identifier("^[^\\u0000-\\u001f\\u007f]{1,100}$", 100), county: identifier("^[^\\u0000-\\u001f\\u007f]{1,100}$", 100) }),
    smoke: closed({ box: closed({ lonMin: coordinate(-180, 180), latMin: coordinate(-90, 90), lonMax: coordinate(-180, 180), latMax: coordinate(-90, 90) }) }),
    roads: closed({ routes: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: identifier("^[0-9]{1,3}$", 3) }, textUrl: url, county: identifier("^[^\\u0000-\\u001f\\u007f]{1,100}$", 100) }),
    schools: closed({ district: identifier("^[^\\u0000-\\u001f\\u007f]{1,150}$", 150), websiteUrl: url, alertsUrl: url, fallbackUrl: url }),
    uscg: closed({ district: { type: "integer", minimum: 1, maximum: 99 }, windowDays: { type: "integer", minimum: 1, maximum: 365 }, listUrl: url, messageUrl: url }),
    permits: closed({ catalogUrl: url }),
    dredging: closed({ sitemapUrl: url, windowDays: { type: "integer", minimum: 1, maximum: 365 } }),
    fuel: closed({ state: identifier("^[A-Za-z][A-Za-z .-]{1,49}$", 50), seriesId: identifier("^[A-Z0-9_]{1,64}$", 64), url, spikeThreshold: { type: "number", minimum: 0, maximum: 1 }, trendWeeks: { type: "integer", minimum: 1, maximum: 52 } }),
    pacfin: closed({ dashboardUrl: url }),
    ais: closed({ feedUrl: url, watchBox: boxSchema }),
  }),
});

/** The deployed Crescent City adapter policy — the default, and the shape every override is checked against. */
export const DEFAULT_REGION_CONFIG: RegionConfig = {
  schemaVersion: "region-config/v1",
  profileId: "crescent-city",
  id: "crescent-city",
  alerts: {
    tsunami: { capArea: "CA" },
    earthquake: { latitude: 41.7485, longitude: -124.2028, radiusKm: 200, minMagnitude: 4.0 },
    weather: { nwsZone: "CAZ101", latitude: 41.7485, longitude: -124.2028 },
    tides: { stationId: "9419750", stationName: "Crescent City, CA", highTideAlertFt: 7.0 },
    fishing: { region: "California", bulletinUrl: "https://wildlife.ca.gov/Fishing/Ocean/Regulations/Bulletins" },
    airQuality: { zip: "95531", latitude: 41.7485, longitude: -124.2028, publicStationRadiusKm: 80 },
    wildfire: { counties: ["Del Norte", "Siskiyou", "Humboldt", "Trinity"], latitude: 41.7485, longitude: -124.2028, radiusKm: 150 },
    marine: {
      stations: [
        { id: "46027", name: "St Georges CA", latitude: 41.85, longitude: -124.38, distanceNm: 27 },
        { id: "46022", name: "Eel River CA", latitude: 40.72, longitude: -124.53, distanceNm: 120 },
        { id: "46214", name: "Humboldt Bay CA", latitude: 40.88, longitude: -124.36, distanceNm: 60 },
      ],
      waveHeightWarningFt: 15, waveHeightWatchFt: 10, windSpeedWarningKt: 34, windSpeedWatchKt: 22,
    },
    marineForecast: { productLocation: "EKA", zoneCode: "PZZ450" },
    drought: { fips: "06015", county: "Del Norte", state: "CA" },
    psps: { utility: "PG&E", county: "Del Norte" },
    smoke: { box: { lonMin: -124.45, latMin: 41.45, lonMax: -123.55, latMax: 42.15 } },
    roads: { routes: ["101", "199", "169", "197", "299"], textUrl: "https://roads.dot.ca.gov/?roadnumber=", county: "Del Norte" },
    schools: {
      district: "Del Norte Unified School District",
      websiteUrl: "https://www.dnusd.org", alertsUrl: "https://www.dnusd.org/news", fallbackUrl: "https://www.dnusd.org/announcements",
    },
    uscg: {
      district: 11, windowDays: 35,
      listUrl: "https://www.navcen.uscg.gov/broadcast-notice-to-mariners-search-results?district=11&sector=0&date-range={START}--{END}&items_per_page=50",
      messageUrl: "https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message?guid={GUID}",
    },
    permits: { catalogUrl: "https://public.mygov.us/crescent_city_ca/module?module=pi" },
    dredging: { sitemapUrl: "https://www.ccharbor.com/sitemap.xml", windowDays: 90 },
    fuel: { state: "California", seriesId: "EMM_EPM0_PTE_SCA_DPG", url: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPM0_PTE_SCA_DPG&f=W", spikeThreshold: 0.15, trendWeeks: 8 },
    pacfin: { dashboardUrl: "https://reports.psmfc.org/pacfin/" },
    ais: { feedUrl: "https://meri.digitraffic.fi/api/ais/v1/locations", watchBox: { minLat: 41.6, maxLat: 42.1, minLon: -124.45, maxLon: -123.9 } },
  },
};

const context = new AsyncLocalStorage<RegionConfig>();
const admitted = new WeakSet<object>();
const fingerprints = new WeakMap<object, string>();
const processConfigs = new Map<string, RegionConfig>();
let defaultConfig: RegionConfig | undefined;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Rebuild with sorted keys so equal configurations share one canonical fingerprint. */
function canonicalize<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonicalize) as unknown as T;
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    return sorted as T;
  }
  return value;
}

/** Every provider endpoint must be a public HTTPS origin without embedded credentials. */
function assertPublicEndpoint(value: string): void {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, "");
  const publicHost = isIP(host) ? isPublicAddress(host) : host.includes(".") && !/(?:^localhost$|\.(?:localhost|local|internal|lan)$)/i.test(host);
  if (url.username || url.password || url.protocol !== "https:" || !publicHost) throw new Error("Region configuration endpoints must be public HTTPS URLs without credentials");
}

/**
 * Validate a `region-config/v1` document. Rejects unknown fields, wrong types,
 * non-public provider URLs, malformed zones/identifiers and unordered watch
 * boxes, then deep-freezes the accepted value. Binding to the selected civic
 * profile is asserted separately by {@link currentRegionConfig}.
 */
export function validateRegionConfig(value: unknown): RegionConfig {
  if (value && typeof value === "object" && admitted.has(value)) return value as RegionConfig;
  const errors = validateSchema(value, REGION_CONFIG_SCHEMA, "region config");
  if (errors.length) throw new Error(`Invalid region configuration: ${errors[0]}`);
  const config = canonicalize(value) as RegionConfig;
  const box = config.alerts.ais.watchBox;
  if (box.minLat >= box.maxLat || box.minLon >= box.maxLon) throw new Error("Region configuration watch box must have ordered bounds");
  const endpoints: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === "string") { if (/^https?:\/\//.test(node)) endpoints.push(node); return; }
    if (node && typeof node === "object") for (const child of Object.values(node)) collect(child);
  };
  collect(config);
  for (const endpoint of endpoints) assertPublicEndpoint(endpoint);
  admitted.add(config);
  return freeze(config);
}

/** Canonical SHA-256 of a validated region configuration. */
export function regionConfigFingerprint(config: RegionConfig = currentRegionConfig()): string {
  const checked = validateRegionConfig(config);
  const cached = fingerprints.get(checked);
  if (cached) return cached;
  const hash = new Bun.CryptoHasher("sha256").update(JSON.stringify(checked)).digest("hex");
  fingerprints.set(checked, hash);
  return hash;
}

/** A region configuration is only valid alongside the civic profile it names. */
export function assertRegionConfigBinding(config: RegionConfig): void {
  const profile = currentCivicProfile();
  if (config.profileId !== profile.id) throw new Error(`Region configuration is bound to civic profile ${config.profileId}, but ${profile.id} is selected`);
}

/** Read a bounded regular JSON file, refusing symlinks and oversized input. */
function readBoundedJson(file: string): unknown {
  const handle = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  try {
    const info = fstatSync(handle);
    if (!info.isFile() || info.size > 64 * 1024) throw new Error("Region configuration must be a bounded regular JSON file");
    const buffer = Buffer.alloc(64 * 1024 + 1);
    let count = 0, read: number;
    while ((read = readSync(handle, buffer, count, buffer.length - count, count)) > 0) {
      count += read;
      if (count > 64 * 1024) throw new Error("Region configuration exceeds byte bound");
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count)));
  } finally {
    closeSync(handle);
  }
}

/**
 * The active region configuration: the captured context, then `REGION_CONFIG`
 * (read once per process), then the Crescent City default. A configuration that
 * does not match the selected civic profile fails closed.
 */
export function currentRegionConfig(): RegionConfig {
  const scoped = context.getStore();
  if (scoped) return scoped;
  const file = process.env.REGION_CONFIG;
  if (!file) {
    const config = (defaultConfig ??= validateRegionConfig(DEFAULT_REGION_CONFIG));
    assertRegionConfigBinding(config);
    return config;
  }
  const cached = processConfigs.get(file);
  if (cached) return cached;
  const config = validateRegionConfig(readBoundedJson(file));
  assertRegionConfigBinding(config);
  processConfigs.set(file, config);
  return config;
}

/** Run a task under a captured region configuration (offline acceptance/tests). */
export function withRegionConfig<T>(config: RegionConfig, task: () => T): T {
  const checked = validateRegionConfig(config);
  assertRegionConfigBinding(checked);
  return context.run(checked, task);
}

if (import.meta.main) {
  const config = currentRegionConfig();
  console.log(JSON.stringify({ config, profileId: currentCivicProfile().id, sha256: regionConfigFingerprint(config), boundary: "Adapter parameters only; provider availability, source rights and local coverage remain separate evidence" }, null, 2));
}
