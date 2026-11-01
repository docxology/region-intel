import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_REGION_CONFIG, REGION_CONFIG_SCHEMA, validateRegionConfig, regionConfigFingerprint,
  currentRegionConfig, withRegionConfig, assertRegionConfigBinding, type RegionConfig,
} from "../src/region_config.ts";
import { validateCivicProfile, defaultCivicProfile, withCivicProfile } from "../src/civic_profile.ts";

const PROFILE_ENV = process.env.REGION_CONFIG;
afterEach(() => { if (PROFILE_ENV === undefined) delete process.env.REGION_CONFIG; else process.env.REGION_CONFIG = PROFILE_ENV; });

function clone(): RegionConfig { return structuredClone(DEFAULT_REGION_CONFIG); }
function alternate(): RegionConfig {
  const config = clone();
  config.id = "example-region";
  config.profileId = "example-city";
  config.alerts.weather = { nwsZone: "NYZ072", latitude: 42.1, longitude: -73.2 };
  config.alerts.tides = { stationId: "8518750", stationName: "The Battery, NY", highTideAlertFt: 8.5 };
  config.alerts.marine.stations = [{ id: "44065", name: "New York Harbor", latitude: 40.37, longitude: -73.7, distanceNm: 5 }];
  config.alerts.ais.watchBox = { minLat: 40.4, maxLat: 40.9, minLon: -74.3, maxLon: -73.6 };
  config.alerts.ais.feedUrl = "https://ais.example.test/locations";
  return config;
}
function exampleCityProfile() {
  return validateCivicProfile({ ...structuredClone(defaultCivicProfile), id: "example-city", name: "Example City", municipality: "Example City, NY", county: "Example County", state: "New York", timeZone: "America/New_York", anchor: { latitude: 42.1, longitude: -73.2, bounds: { west: -74, south: 41, east: -72, north: 43 } }, code: { provider: "ecode360", municipalityCode: "EX1234" }, corpusSlug: "example-city-code", vectorNamespace: "example-city-code", calendar: { uidDomain: "example-city.test", productId: "-//Example City//Calendar//EN" }, publication: { title: "Example Civic Intelligence", description: "Synthetic offline acceptance only", siteUrl: "https://example.test", repositoryUrl: "https://github.com/example/civic" }, capabilities: ["ecode360", "news", "events", "analytics", "geo"] });
}
async function owned(run: (root: string) => Promise<void>) { const root = await mkdtemp(join(tmpdir(), "region-config-")); try { await run(root); } finally { await rm(root, { recursive: true, force: true }); } }

describe("generic regional-adapter configuration", () => {
  test("the default reproduces the deployed Crescent City policy and is deeply frozen", () => {
    const config = currentRegionConfig();
    expect(config.profileId).toBe(defaultCivicProfile.id);
    expect(config.alerts.weather.nwsZone).toBe("CAZ101");
    expect(config.alerts.tides.stationId).toBe("9419750");
    expect(config.alerts.marineForecast.zoneCode).toBe("PZZ450");
    expect(config.alerts.drought.fips).toBe("06015");
    expect(config.alerts.ais.feedUrl).toBe("https://meri.digitraffic.fi/api/ais/v1/locations");
    expect(Object.isFrozen(config.alerts.marine.stations[0])).toBe(true);
    expect(Object.isFrozen(config.alerts)).toBe(true);
  });

  test("canonical fingerprint ignores input key order", () => {
    const a = clone();
    const b = Object.fromEntries(Object.entries(clone()).reverse()) as RegionConfig;
    expect(regionConfigFingerprint(validateRegionConfig(a))).toBe(regionConfigFingerprint(validateRegionConfig(b)));
  });

  test("malformed configuration fails admission", () => {
    const cases: Array<[string, unknown]> = [
      ["unknown field", { ...clone(), privateOutputPath: "/Users/operator/private" }],
      ["unsupported schema", { ...clone(), schemaVersion: "region-config/v2" }],
      ["bad zone", { ...clone(), alerts: { ...clone().alerts, weather: { nwsZone: "NYZ72", latitude: 1, longitude: 2 } } }],
      ["private feed", { ...clone(), alerts: { ...clone().alerts, ais: { feedUrl: "http://localhost/ais", watchBox: { minLat: 1, maxLat: 2, minLon: 1, maxLon: 2 } } } }],
      ["credential URL", { ...clone(), alerts: { ...clone().alerts, permits: { catalogUrl: "https://user:secret@example.test/module" } } }],
      ["unordered box", { ...clone(), alerts: { ...clone().alerts, ais: { feedUrl: "https://ais.example.test/x", watchBox: { minLat: 5, maxLat: 2, minLon: 1, maxLon: 2 } } } }],
      ["duplicate county", { ...clone(), alerts: { ...clone().alerts, wildfire: { counties: ["A", "A"], latitude: 1, longitude: 2, radiusKm: 5 } } }],
      ["empty stations", { ...clone(), alerts: { ...clone().alerts, marine: { ...clone().alerts.marine, stations: [] } } }],
      ["nonfinite radius", { ...clone(), alerts: { ...clone().alerts, earthquake: { latitude: 1, longitude: 2, radiusKm: Number.POSITIVE_INFINITY, minMagnitude: 4 } } }],
    ];
    for (const [label, value] of cases) expect(() => validateRegionConfig(value), label).toThrow();
    expect(REGION_CONFIG_SCHEMA.additionalProperties).toBe(false);
  });

  test("a captured context carries an alternate region without mutating the default", () => {
    const config = alternate();
    withCivicProfile(exampleCityProfile(), () => {
      withRegionConfig(config, () => {
        expect(currentRegionConfig().alerts.weather.nwsZone).toBe("NYZ072");
        expect(currentRegionConfig().alerts.tides.stationId).toBe("8518750");
      });
    });
    expect(currentRegionConfig().alerts.weather.nwsZone).toBe("CAZ101");
  });

  test("an alternate region is only valid alongside the civic profile it names", () => {
    const config = alternate();
    expect(() => withRegionConfig(config, () => {})).toThrow("bound to civic profile example-city");
    withCivicProfile(exampleCityProfile(), () => {
      withRegionConfig(config, () => expect(currentRegionConfig().alerts.ais.feedUrl).toBe("https://ais.example.test/locations"));
      expect(() => withRegionConfig(clone(), () => {})).toThrow("bound to civic profile crescent-city");
    });
  });

  test("a selected file is read once and bound to the selected profile", async () => owned(async root => {
    const path = join(root, "region.json");
    await writeFile(path, JSON.stringify(alternate()));
    process.env.REGION_CONFIG = path;
    expect(() => currentRegionConfig()).toThrow("bound to civic profile example-city");
    withCivicProfile(exampleCityProfile(), () => {
      expect(currentRegionConfig().alerts.weather.nwsZone).toBe("NYZ072");
      expect(regionConfigFingerprint()).toBe(regionConfigFingerprint(alternate()));
    });
  }));

  test("oversized and linked configuration files are refused", async () => owned(async root => {
    const oversized = join(root, "oversized.json");
    await writeFile(oversized, `{"pad":"${"x".repeat(70 * 1024)}"}`);
    process.env.REGION_CONFIG = oversized;
    expect(() => currentRegionConfig()).toThrow("bounded regular JSON file");
    const target = join(root, "target.json");
    await writeFile(target, JSON.stringify(alternate()));
    const link = join(root, "link.json");
    await symlink(target, link);
    process.env.REGION_CONFIG = link;
    expect(() => currentRegionConfig()).toThrow();
  }));

  test("binding assertion reports the selected profile", () => {
    expect(() => assertRegionConfigBinding(validateRegionConfig(clone()))).not.toThrow();
    expect(() => assertRegionConfigBinding(validateRegionConfig(alternate()))).toThrow("crescent-city is selected");
  });

  test("monitor-exported constants match the default region configuration", async () => {
    const { CRESCENT_CITY_STATION_ID } = await import("../src/alerts/noaa_tides.ts");
    const { MARINE_ZONE_CODE } = await import("../src/alerts/nws_marine.ts");
    const { AIS_WATCH_BOX, DIGITRAFFIC_AIS_URL } = await import("../src/alerts/ais.ts");
    const { MYGOV_PERMITS_URL } = await import("../src/alerts/permits.ts");
    const { CCHARBOR_SITEMAP_URL, DREDGING_WINDOW_DAYS } = await import("../src/alerts/dredging.ts");
    const { USCG_BNM_WINDOW_DAYS } = await import("../src/alerts/uscg_broadcasts.ts");
    const { EIA_CA_RETAIL_GAS_URL, FUEL_SPIKE_THRESHOLD, FUEL_TREND_WEEKS } = await import("../src/alerts/fuel.ts");
    const { PACFIN_DASHBOARD_URL } = await import("../src/alerts/pacfin.ts");
    const { DUSD_WEBSITE_URL } = await import("../src/alerts/dusd_schools.ts");
    const { CALTRANS_ROADS_TEXT_URL } = await import("../src/alerts/caltrans_roads.ts");
    const { USDM_API_URL } = await import("../src/alerts/usdm_drought.ts");
    const { NWS_FORECAST_ZONE } = await import("../src/constants.ts");
    const cfg = DEFAULT_REGION_CONFIG.alerts;
    expect(CRESCENT_CITY_STATION_ID).toBe(cfg.tides.stationId);
    expect(MARINE_ZONE_CODE).toBe(cfg.marineForecast.zoneCode);
    expect(cfg.ais.watchBox).toEqual({ ...AIS_WATCH_BOX });
    expect(DIGITRAFFIC_AIS_URL).toBe(cfg.ais.feedUrl);
    expect(MYGOV_PERMITS_URL).toBe(cfg.permits.catalogUrl);
    expect(CCHARBOR_SITEMAP_URL).toBe(cfg.dredging.sitemapUrl);
    expect(DREDGING_WINDOW_DAYS).toBe(cfg.dredging.windowDays);
    expect(USCG_BNM_WINDOW_DAYS).toBe(cfg.uscg.windowDays);
    expect(EIA_CA_RETAIL_GAS_URL).toBe(cfg.fuel.url);
    expect(FUEL_SPIKE_THRESHOLD).toBe(cfg.fuel.spikeThreshold);
    expect(FUEL_TREND_WEEKS).toBe(cfg.fuel.trendWeeks);
    expect(PACFIN_DASHBOARD_URL).toBe(cfg.pacfin.dashboardUrl);
    expect(DUSD_WEBSITE_URL).toBe(cfg.schools.websiteUrl);
    expect(CALTRANS_ROADS_TEXT_URL).toBe(cfg.roads.textUrl);
    expect(NWS_FORECAST_ZONE).toBe(cfg.weather.nwsZone);
    expect(USDM_API_URL).toContain(`aoi=${cfg.drought.fips}`);
  });
});

test("alternate smoke and road summaries preserve selected regional identity",async()=>{
 const {buildExtendedMonitorDefinitions}=await import("../src/alerts/composite.js");
 const {buildHmsSmokeReport}=await import("../src/alerts/hrrr_smoke.js"),{computeAlertSeverity}=await import("../src/alerts/severity.js");
 const config=alternate();config.alerts.roads.county="Example County";config.alerts.smoke.box={lonMin:-74,lonMax:-72,latMin:41,latMax:43};config.alerts.drought={county:"Example County",fips:"36001",state:"NY"};
 withCivicProfile(exampleCityProfile(),()=>withRegionConfig(config,()=>{
  const report=buildHmsSmokeReport({mapDate:"20260102",plumes:0,maxDensity:"Unknown"},"2026-01-02T12:00:00Z");expect(report.summary).toContain("Example City watch box");expect(report.summary).not.toContain("Del Norte");
  const drought=buildExtendedMonitorDefinitions({}).find(row=>row.key==="drought")!;expect(drought.url).toContain("aoi=36001");expect(drought.provenance).toContain("Example County FIPS 36001");
  expect(computeAlertSeverity({warningCount:0,watchCount:0},{events:[]},{severities:[],count:0,available:false},{waterLevelFt:null,available:false},{closureActive:false,available:false},undefined,undefined,undefined,undefined,undefined,undefined,{severity:"NONE",incidentCount:0,hasMajorClosure:false,available:true}).monitors.roads.summary).toContain("Example County");
 }));
});
