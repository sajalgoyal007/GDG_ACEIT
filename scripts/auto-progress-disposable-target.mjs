import { execFile } from "node:child_process";
import { realpath, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const DISPOSABLE_TARGET_OPT_IN = "I_ACCEPT_RANKS_ARE_CONSUMED";
const TEST_PROJECT_ID = /^gdg-aceit-ranktest-[a-f0-9]{32}$/;
const LEGACY_TARGET_ENV = [
  "AUTO_PROGRESS_LOCAL_URL",
  "AUTO_PROGRESS_LOCAL_SERVICE_KEY",
  "AUTO_PROGRESS_LOCAL_ANON_KEY",
  "AUTO_PROGRESS_TEST_DB_CONTAINER",
];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loopbackFamily(hostname) {
  if (hostname === "localhost") return "localhost";
  if (hostname === "127.0.0.1") return "ipv4";
  if (hostname === "::1" || hostname === "[::1]") return "ipv6";
  return null;
}

export function parseSupabaseProjectId(configText) {
  const matches = [...configText.matchAll(/^\s*project_id\s*=\s*["']([^"']+)["']\s*$/gm)];
  return matches.length === 1 ? matches[0][1] : null;
}

/** Require an explicit API port so the CLI endpoint can be tied to its host mapping. */
export function parseSupabaseApiPort(configText) {
  let section = "";
  const ports = [];
  for (const line of configText.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== "api") continue;
    const portMatch = line.match(/^\s*port\s*=\s*(\d+)\s*(?:#.*)?$/);
    if (portMatch) ports.push(Number(portMatch[1]));
  }
  return ports.length === 1 && Number.isInteger(ports[0]) && ports[0] >= 1 && ports[0] <= 65535
    ? ports[0]
    : null;
}

/** Parse only selected, non-secret fields emitted by `docker inspect`. */
export function parseSupabaseContainerMetadata(output) {
  const lines = output.trimEnd().split(/\r?\n/);
  if (lines.length !== 4) return null;
  try {
    const [name, labels, ports, networks] = lines.map((line) => JSON.parse(line));
    if (typeof name !== "string" || !isRecord(labels) || !isRecord(ports) || !isRecord(networks)) return null;
    return { name, labels, ports, networks };
  } catch {
    return null;
  }
}

/** Parses only the three local status values needed by this test. Never eval shell output. */
export function parseSupabaseStatusEnv(output) {
  const values = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(API_URL|ANON_KEY|SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { continue; }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return Object.fromEntries(values);
}

export function parseDisposableDatabaseState(output) {
  const values = output.trim().split("|").map(Number);
  if (values.length !== 7 || values.some((value) => !Number.isSafeInteger(value) || value < 0)) return null;
  return {
    participants: values[0],
    nextRank: values[1],
    milestones: values[2],
    jobs: values[3],
    jobItems: values[4],
    imports: values[5],
    importItems: values[6],
  };
}

export function validateSupabaseContainerMetadata(metadata, { projectId, projectDir, service }) {
  const expectedName = `/supabase_${service}_${projectId}`;
  const expectedNetwork = `supabase_network_${projectId}`;
  if (!metadata) return { ok: false, reason: `${service}_container_missing` };
  if (metadata.name !== expectedName
    || metadata.labels?.["com.supabase.cli.project"] !== projectId
    || metadata.labels?.["com.docker.compose.project"] !== projectId
    || typeof metadata.labels?.["com.supabase.cli.workdir"] !== "string"
    || !samePath(metadata.labels["com.supabase.cli.workdir"], projectDir)) {
    return { ok: false, reason: `${service}_container_project_mismatch` };
  }
  if (!isRecord(metadata.networks) || Object.keys(metadata.networks).length !== 1
    || !Object.hasOwn(metadata.networks, expectedNetwork)) {
    return { ok: false, reason: `${service}_container_network_mismatch` };
  }
  const attachment = metadata.networks[expectedNetwork];
  if (!isRecord(attachment) || typeof attachment.NetworkID !== "string" || !attachment.NetworkID
    || typeof attachment.EndpointID !== "string" || !attachment.EndpointID) {
    return { ok: false, reason: `${service}_container_network_metadata_invalid` };
  }
  return { ok: true, expectedNetwork, networkId: attachment.NetworkID };
}

export function validateApiPublishedPort(kongMetadata, expectedPort, apiHostname) {
  const requestedFamily = loopbackFamily(apiHostname);
  if (!requestedFamily) return { ok: false, reason: "api_hostname_unsupported" };
  if (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535) {
    return { ok: false, reason: "api_published_port_mismatch" };
  }
  const mappings = kongMetadata?.ports?.["8000/tcp"];
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { ok: false, reason: "api_published_port_missing" };
  }
  if (mappings.some((mapping) => !isRecord(mapping)
    || typeof mapping.HostPort !== "string" || !/^[1-9]\d*$/.test(mapping.HostPort))) {
    return { ok: false, reason: "api_published_port_metadata_invalid" };
  }
  const hostFamilies = new Map();
  for (const mapping of mappings) {
    const family = mapping.HostIp === "0.0.0.0" || mapping.HostIp === "127.0.0.1"
      ? "ipv4"
      : mapping.HostIp === "::" || mapping.HostIp === "::1" ? "ipv6" : null;
    if (!family) return { ok: false, reason: "api_published_host_mismatch" };
    const familyHosts = hostFamilies.get(family) ?? new Set();
    familyHosts.add(mapping.HostIp);
    hostFamilies.set(family, familyHosts);
  }
  if ([...hostFamilies.values()].some((hosts) => hosts.size !== 1)) {
    return { ok: false, reason: "api_published_host_ambiguous" };
  }
  if (new Set(mappings.map((mapping) => `${mapping.HostIp}|${mapping.HostPort}`)).size !== mappings.length) {
    return { ok: false, reason: "api_published_mapping_ambiguous" };
  }
  if (new Set(mappings.map((mapping) => mapping.HostPort)).size !== 1) {
    return { ok: false, reason: "api_published_port_ambiguous" };
  }
  if (mappings.some((mapping) => Number(mapping.HostPort) > 65535)) {
    return { ok: false, reason: "api_published_port_metadata_invalid" };
  }
  if (mappings.some((mapping) => Number(mapping.HostPort) !== expectedPort)) {
    return { ok: false, reason: "api_published_port_mismatch" };
  }
  const hasIpv4Binding = hostFamilies.has("ipv4");
  const hasIpv6Binding = hostFamilies.has("ipv6");
  const compatible = requestedFamily === "ipv4" ? hasIpv4Binding
    : requestedFamily === "ipv6" ? hasIpv6Binding
      : hasIpv4Binding && hasIpv6Binding;
  if (!compatible) return { ok: false, reason: "api_published_host_mismatch" };
  return { ok: true };
}

export function validateRestContainerUnpublished(restMetadata) {
  const restPorts = restMetadata?.ports;
  if (!restPorts || !Object.hasOwn(restPorts, "3000/tcp")) {
    return { ok: false, reason: "rest_container_port_metadata_missing" };
  }
  if (Object.values(restPorts).some((bindings) => Array.isArray(bindings) && bindings.some((binding) => binding?.HostPort))) {
    return { ok: false, reason: "rest_container_unexpected_published_port" };
  }
  if (Object.keys(restPorts).some((port) => port !== "3000/tcp")
    || Object.values(restPorts).some((bindings) => bindings !== null)) {
    return { ok: false, reason: "rest_container_port_metadata_unsupported" };
  }
  return { ok: true };
}

export function validateDisposableProject({
  optIn,
  projectDir,
  expectedProjectId,
  configProjectId,
  tempRoot,
  repositoryRoot,
  legacyTargetVariables = [],
}) {
  if (optIn !== DISPOSABLE_TARGET_OPT_IN) return { ok: false, reason: "explicit_opt_in_required" };
  if (legacyTargetVariables.length) return { ok: false, reason: "legacy_target_overrides_forbidden" };
  if (!TEST_PROJECT_ID.test(expectedProjectId ?? "") || configProjectId !== expectedProjectId) {
    return { ok: false, reason: "project_identity_mismatch" };
  }
  if (!samePath(path.dirname(projectDir), tempRoot) || path.basename(path.resolve(projectDir)) !== expectedProjectId) {
    return { ok: false, reason: "project_must_be_unique_temp_directory" };
  }
  if (isWithin(repositoryRoot, projectDir) || isWithin(projectDir, repositoryRoot)) {
    return { ok: false, reason: "project_must_be_separate_from_repository" };
  }
  return { ok: true, projectId: expectedProjectId, projectDir: path.resolve(projectDir) };
}

export function validateDisposableDatabase({
  project,
  status,
  apiPort,
  databaseContainerMetadata,
  kongContainerMetadata,
  restContainerMetadata,
  appliedMigrations,
  requiredMigrations,
  databaseState,
}) {
  if (!project?.ok) return project ?? { ok: false, reason: "project_not_verified" };
  if (!status || typeof status.API_URL !== "string"
    || typeof status.ANON_KEY !== "string" || status.ANON_KEY.length < 20
    || typeof status.SERVICE_ROLE_KEY !== "string" || status.SERVICE_ROLE_KEY.length < 20) {
    return { ok: false, reason: "local_supabase_status_incomplete" };
  }
  let apiUrl;
  try { apiUrl = new URL(status.API_URL); } catch { return { ok: false, reason: "local_api_url_invalid" }; }
  if (apiUrl.protocol !== "http:" || !loopbackFamily(apiUrl.hostname)
    || !apiUrl.port || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash
    || (apiUrl.pathname !== "" && apiUrl.pathname !== "/")) {
    return { ok: false, reason: "local_api_url_not_isolated" };
  }
  if (!Number.isInteger(apiPort) || apiUrl.port !== String(apiPort)) {
    return { ok: false, reason: "local_api_port_does_not_match_config" };
  }
  const expectedNetwork = `supabase_network_${project.projectId}`;
  const networkIds = new Set();
  for (const [metadata, service] of [
    [databaseContainerMetadata, "db"],
    [kongContainerMetadata, "kong"],
    [restContainerMetadata, "rest"],
  ]) {
    const identity = validateSupabaseContainerMetadata(metadata, {
      projectId: project.projectId,
      projectDir: project.projectDir,
      service,
    });
    if (!identity.ok) return identity;
    if (identity.expectedNetwork !== expectedNetwork) return { ok: false, reason: "container_network_mismatch" };
    networkIds.add(identity.networkId);
  }
  if (networkIds.size !== 1) return { ok: false, reason: "container_network_identity_mismatch" };
  const publishedPort = validateApiPublishedPort(kongContainerMetadata, apiPort, apiUrl.hostname);
  if (!publishedPort.ok) return publishedPort;
  const restPublication = validateRestContainerUnpublished(restContainerMetadata);
  if (!restPublication.ok) return restPublication;
  if (!Array.isArray(requiredMigrations) || !Array.isArray(appliedMigrations)
    || requiredMigrations.length !== appliedMigrations.length
    || requiredMigrations.some((version, index) => version !== appliedMigrations[index])) {
    return { ok: false, reason: "migration_history_mismatch" };
  }
  if (!databaseState || databaseState.participants !== 0 || databaseState.nextRank !== 1
    || databaseState.milestones !== 0 || databaseState.jobs !== 0 || databaseState.jobItems !== 0
    || databaseState.imports !== 0 || databaseState.importItems !== 0) {
    return { ok: false, reason: "database_is_not_fresh_disposable_state" };
  }
  return {
    ok: true,
    projectId: project.projectId,
    apiUrl: apiUrl.toString().replace(/\/$/, ""),
    anonKey: status.ANON_KEY,
    serviceKey: status.SERVICE_ROLE_KEY,
    databaseContainer: `supabase_db_${project.projectId}`,
  };
}

async function runCliStatus(projectDir) {
  const cliWrapper = path.join(projectRoot, "node_modules", "supabase", "dist", "supabase.js");
  const childEnv = { ...process.env };
  delete childEnv.SUPABASE_CLI_BINARY_OVERRIDE;
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliWrapper, "status", "--output", "env", "--workdir", projectDir,
    ], { encoding: "utf8", maxBuffer: 1024 * 1024, env: childEnv });
    return parseSupabaseStatusEnv(stdout);
  } catch {
    throw new Error("Could not verify the isolated local Supabase project; no fixture writes were attempted.");
  }
}

async function dockerText(args) {
  try {
    const { stdout } = await execFileAsync("docker", args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
    return stdout.trim();
  } catch {
    throw new Error("Could not verify the isolated Docker database target; no fixture writes were attempted.");
  }
}

async function inspectSupabaseContainer(container) {
  // Exclude Config.Env and all other fields that may contain credentials.
  const format = '{{json .Name}}{{"\\n"}}{{json .Config.Labels}}{{"\\n"}}{{json .NetworkSettings.Ports}}{{"\\n"}}{{json .NetworkSettings.Networks}}';
  const output = await dockerText(["inspect", "--format", format, container]);
  const metadata = parseSupabaseContainerMetadata(output);
  if (!metadata) throw new Error("Could not verify isolated Supabase container metadata; no fixture writes were attempted.");
  return metadata;
}

async function psql(container, query) {
  return dockerText(["exec", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", query]);
}

export async function resolveDisposableSupabaseTarget(env = process.env) {
  const rawProjectDir = env.AUTO_PROGRESS_TEST_PROJECT_DIR;
  const expectedProjectId = env.AUTO_PROGRESS_TEST_EXPECTED_PROJECT_ID;
  const legacyTargetVariables = LEGACY_TARGET_ENV.filter((name) => env[name] !== undefined);
  if (!rawProjectDir || !expectedProjectId) {
    throw new Error("Set the isolated temporary Supabase project directory and expected test project ID; no fixture writes were attempted.");
  }

  let projectDir;
  let tempRoot;
  let repositoryRoot;
  try {
    projectDir = await realpath(rawProjectDir);
    tempRoot = await realpath(os.tmpdir());
    repositoryRoot = await realpath(projectRoot);
  } catch {
    throw new Error("The temporary project, system temp directory, or repository path could not be verified; no fixture writes were attempted.");
  }
  const configPath = path.join(projectDir, "supabase", "config.toml");
  let configText;
  try { configText = await readFile(configPath, "utf8"); } catch {
    throw new Error("The temporary project has no readable Supabase config; no fixture writes were attempted.");
  }
  const project = validateDisposableProject({
    optIn: env.AUTO_PROGRESS_ALLOW_DISPOSABLE_DB_MUTATION,
    projectDir,
    expectedProjectId,
    configProjectId: parseSupabaseProjectId(configText),
    tempRoot,
    repositoryRoot,
    legacyTargetVariables,
  });
  if (!project.ok) throw new Error(`Unsafe concurrency target (${project.reason}); no fixture writes were attempted.`);

  const status = await runCliStatus(projectDir);
  if (!status.API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error("Local Supabase status did not provide the expected project endpoint and keys; no fixture writes were attempted.");
  }
  const container = `supabase_db_${project.projectId}`;
  const apiPort = parseSupabaseApiPort(configText);
  if (apiPort === null) throw new Error("The temporary Supabase config must specify exactly one API port; no fixture writes were attempted.");
  const [databaseContainerMetadata, kongContainerMetadata, restContainerMetadata] = await Promise.all([
    inspectSupabaseContainer(container),
    inspectSupabaseContainer(`supabase_kong_${project.projectId}`),
    inspectSupabaseContainer(`supabase_rest_${project.projectId}`),
  ]);

  const migrationsDirectory = path.join(repositoryRoot, "supabase", "migrations");
  const requiredMigrations = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .map((name) => name.slice(0, 14))
    .sort();
  const migrationOutput = await psql(container,
    "select coalesce(string_agg(version, ',' order by version), '') from supabase_migrations.schema_migrations");
  const appliedMigrations = migrationOutput ? migrationOutput.split(",") : [];
  const stateOutput = await psql(container, `select
    (select count(*) from public.participants),
    (select next_rank from public.participant_auto_rank_allocator where singleton),
    (select count(*) from public.participant_auto_milestones),
    (select count(*) from public.participant_auto_refresh_jobs),
    (select count(*) from public.participant_auto_refresh_job_items),
    (select count(*) from public.participant_progress_imports),
    (select count(*) from public.participant_progress_import_items)`);
  const databaseState = parseDisposableDatabaseState(stateOutput);
  const verified = validateDisposableDatabase({
    project,
    status,
    apiPort,
    databaseContainerMetadata,
    kongContainerMetadata,
    restContainerMetadata,
    appliedMigrations,
    requiredMigrations,
    databaseState,
  });
  if (!verified.ok) throw new Error(`Unsafe concurrency database (${verified.reason}); no fixture writes were attempted.`);
  return verified;
}
