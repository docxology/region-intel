import { AsyncLocalStorage } from "node:async_hooks";
import { resolve, relative, isAbsolute } from "node:path";
import { readFileSync, lstatSync } from "node:fs";
import { validateCivicProfile, type CivicProfile } from "./civic_profile.js";
import { validateRegionConfig, type RegionConfig } from "./region_config.js";
export interface DeploymentSource {
    id: string;
    name: string;
    url: string;
    kind: "news" | "official" | "code" | "meetings" | "events";
    feedUrl?: string;
}
export interface Deployment {
    schemaVersion: "region-deployment/v1";
    civicProfile: string;
    regionConfig: string;
    outputDir: string;
    seedDir: string;
    enabledMonitors: string[];
    sources: DeploymentSource[];
}
export interface LoadedDeployment {
    root: string;
    config: Deployment;
    profile: CivicProfile;
    policy: RegionConfig;
    output: string;
    seed: string;
}
export function deploymentPath(root: string, path: string): string {
    if (typeof path !== "string" || !path || isAbsolute(path) || path.split(/[\\/]/).includes(".."))
        throw new Error("Deployment paths must remain relative to the consumer");
    const target = resolve(root, path);
    if (!relative(root, target) || relative(root, target).startsWith(".."))
        throw new Error("Deployment path must name a child");
    let current = resolve(root);
    for (const part of relative(root, target).split("/")) {
        current = resolve(current, part);
        try {
            if (lstatSync(current).isSymbolicLink())
                throw new Error("Deployment paths cannot traverse symlinks");
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
        }
    }
    return target;
}
function json(path: string): unknown { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
    throw new Error("Expected bounded regular configuration"); return JSON.parse(readFileSync(path, "utf8")); }
export function loadDeployment(root: string, filename = "region.json"): LoadedDeployment {
    root = resolve(root);
    const raw = json(deploymentPath(root, filename));
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("Invalid deployment");
    const c = raw as Deployment;
    const keys = ["schemaVersion", "civicProfile", "regionConfig", "outputDir", "seedDir", "enabledMonitors", "sources"];
    if (Object.keys(c).some(k => !keys.includes(k)) || keys.some(k => !(k in c)) || c.schemaVersion !== "region-deployment/v1")
        throw new Error("Invalid deployment schema");
    const profile = validateCivicProfile(json(deploymentPath(root, c.civicProfile)));
    const policy = validateRegionConfig(json(deploymentPath(root, c.regionConfig)));
    if (policy.profileId !== profile.id)
        throw new Error("Deployment profile and adapter policy differ");
    const known = ["tsunami", "earthquake", "weather", "airquality", "wildfire", "marine", "marinezone", "tides", "fishing", "drought", "psps", "smoke", "roads", "schools", "uscg", "permits", "dredging", "fuel", "pacfin", "ais"];
    if (!Array.isArray(c.enabledMonitors) || c.enabledMonitors.some(k => !known.includes(k)) || new Set(c.enabledMonitors).size !== c.enabledMonitors.length)
        throw new Error("Invalid enabled monitor roster");
    if (!Array.isArray(c.sources) || c.sources.length > 128)
        throw new Error("Invalid source catalog");
    const ids = new Set<string>();
    for (const s of c.sources) {
        if (!s || Object.keys(s).some(k => !["id", "name", "url", "kind", "feedUrl"].includes(k)) || typeof s.id !== "string" || !/^[a-z0-9-]+$/.test(s.id) || ids.has(s.id) || typeof s.name !== "string" || !s.name.trim() || !["news", "official", "code", "meetings", "events"].includes(s.kind))
            throw new Error("Invalid source identity");
        ids.add(s.id);
        for (const value of [s.url, ...(s.feedUrl ? [s.feedUrl] : [])]) {
            const u = new URL(value);
            if (u.protocol !== "https:" || u.username || u.password)
                throw new Error("Sources require public HTTPS URLs");
        }
    }
    const output = deploymentPath(root, c.outputDir), seed = deploymentPath(root, c.seedDir);
    if (output === seed || output.startsWith(seed + "/") || seed.startsWith(output + "/"))
        throw new Error("Output and seed roots overlap");
    return { root, config: c, profile, policy, output, seed };
}
const deploymentScope = new AsyncLocalStorage<LoadedDeployment>();
export function withDeployment<T>(deployment: LoadedDeployment, task: () => T): T { const checked = loadDeployment(deployment.root); return deploymentScope.run(checked, task); }
export function deploymentAllowsProducer(name: string, profileId: string): boolean {
    const d = deploymentScope.getStore();
    if (!d || d.profile.id !== profileId)
        return false;
    const producers: Record<string, string> = { "alert-fuel": "fuel", "alert-usgs-earthquake": "earthquake", "alert-nws-weather": "weather", "alert-epa-airnow": "airquality", "alert-calfire-wildfire": "wildfire", "alert-usdm-drought": "drought", "alert-pge-psps": "psps", "alert-hrrr-smoke": "smoke", "alert-caltrans-roads": "roads", "alert-dusd-schools": "schools" };
    return name === "runallalertmonitors" || !!producers[name] && d.config.enabledMonitors.includes(producers[name]!);
}
export function assertDeploymentMonitorSelection(selected: readonly string[] | undefined): void {
    const deployment = deploymentScope.getStore();
    if (!deployment)
        return;
    if (!selected?.length || selected.some(key => !deployment.config.enabledMonitors.includes(key)))
        throw new Error("Alert selection exceeds configured deployment monitors");
}
