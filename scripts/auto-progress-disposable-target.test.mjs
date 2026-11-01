import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DISPOSABLE_TARGET_OPT_IN,
  parseSupabaseApiPort,
  parseSupabaseContainerMetadata,
  parseDisposableDatabaseState,
  validateApiPublishedPort,
  validateRestContainerUnpublished,
  validateSupabaseContainerMetadata,
  parseSupabaseProjectId,
  parseSupabaseStatusEnv,
  validateDisposableDatabase,
  validateDisposableProject,
} from "./auto-progress-disposable-target.mjs";

const projectId = `gdg-aceit-ranktest-${"a".repeat(32)}`;
const tempRoot = path.join(os.tmpdir(), "gdg-aceit-tests");
const projectDir = path.join(tempRoot, projectId);
const repositoryRoot = path.join(os.tmpdir(), "gdg-aceit-repository");
const configText = `project_id = "${projectId}"\n`;

function project(overrides = {}) {
  return validateDisposableProject({
    optIn: DISPOSABLE_TARGET_OPT_IN,
    projectDir,
    expectedProjectId: projectId,
    configProjectId: projectId,
    tempRoot,
    repositoryRoot,
    ...overrides,
  });
}

const status = {
  API_URL: "http://127.0.0.1:58421",
  ANON_KEY: "test-only-anon-key-value-000000",
  SERVICE_ROLE_KEY: "test-only-service-role-key-000000",
};
const freshState = {
  participants: 0,
  nextRank: 1,
  milestones: 0,
  jobs: 0,
  jobItems: 0,
  imports: 0,
  importItems: 0,
};
const migrations = ["20261026000100", "20261031000100"];
const networkName = `supabase_network_${projectId}`;
const networkAttachment = { NetworkID: "network-id-test", EndpointID: "endpoint-id-test" };

function containerMetadata(service, overrides = {}) {
  const ports = service === "kong"
    ? { "8000/tcp": [{ HostIp: "0.0.0.0", HostPort: "58421" }, { HostIp: "::", HostPort: "58421" }] }
    : service === "rest" ? { "3000/tcp": null } : { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "58422" }] };
  return {
    name: `/supabase_${service}_${projectId}`,
    labels: {
      "com.supabase.cli.project": projectId,
      "com.docker.compose.project": projectId,
      "com.supabase.cli.workdir": projectDir,
    },
    ports,
    networks: { [networkName]: networkAttachment },
    ...overrides,
  };
}

function validateDatabase(overrides = {}) {
  return validateDisposableDatabase({
    project: project(),
    status,
    apiPort: 58421,
    databaseContainerMetadata: containerMetadata("db"),
    kongContainerMetadata: containerMetadata("kong"),
    restContainerMetadata: containerMetadata("rest"),
    requiredMigrations: migrations,
    appliedMigrations: migrations,
    databaseState: freshState,
    ...overrides,
  });
}

test("project identity is read from exactly one project_id config setting", () => {
  assert.equal(parseSupabaseProjectId(configText), projectId);
  assert.equal(parseSupabaseProjectId("[api]\nenabled = true\n"), null);
  assert.equal(parseSupabaseProjectId(`${configText}${configText}`), null);
});

test("API port must be explicitly and uniquely configured in the API section", () => {
  assert.equal(parseSupabaseApiPort('[api]\nport = 58421\n[db]\nport = 58422\n'), 58421);
  assert.equal(parseSupabaseApiPort('[api]\n[db]\nport = 58422\n'), null);
  assert.equal(parseSupabaseApiPort('[api]\nport = 58421\nport = 58422\n'), null);
});

test("Docker metadata parser reads only the four selected metadata fields", () => {
  const parsed = parseSupabaseContainerMetadata([
    JSON.stringify(`/supabase_kong_${projectId}`),
    JSON.stringify(containerMetadata("kong").labels),
    JSON.stringify(containerMetadata("kong").ports),
    JSON.stringify(containerMetadata("kong").networks),
  ].join("\n"));
  assert.equal(parsed?.name, `/supabase_kong_${projectId}`);
  assert.equal(parseSupabaseContainerMetadata("not-json"), null);
});

test("Supabase CLI env output is parsed without evaluating or exposing unrelated values", () => {
  const parsed = parseSupabaseStatusEnv([
    `API_URL="${status.API_URL}"`,
    `ANON_KEY="${status.ANON_KEY}"`,
    `SERVICE_ROLE_KEY="${status.SERVICE_ROLE_KEY}"`,
    "JWT_SECRET=must-not-be-returned",
  ].join("\n"));
  assert.deepEqual(parsed, status);
});

test("database preflight accepts only seven nonnegative integer fields", () => {
  assert.deepEqual(parseDisposableDatabaseState("0|1|0|0|0|0|0"), freshState);
  assert.deepEqual(parseDisposableDatabaseState("0|11|0|0|0|0|0"), { ...freshState, nextRank: 11 });
  assert.equal(parseDisposableDatabaseState("0|1|0|0|0|0"), null);
});

test("database, Kong, and PostgREST must have matching identity and exactly one valid project network", () => {
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("db"), { projectId, projectDir, service: "db" }).ok, true);
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("kong"), { projectId, projectDir, service: "kong" }).ok, true);
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("rest"), { projectId, projectDir, service: "rest" }).ok, true);
  assert.equal(validateSupabaseContainerMetadata(null, { projectId, projectDir, service: "kong" }).reason, "kong_container_missing");
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("rest", {
    labels: { ...containerMetadata("rest").labels, "com.supabase.cli.project": "another-project" },
  }), { projectId, projectDir, service: "rest" }).reason, "rest_container_project_mismatch");
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("db", {
    labels: { ...containerMetadata("db").labels, "com.supabase.cli.workdir": path.join(tempRoot, "other") },
  }), { projectId, projectDir, service: "db" }).reason, "db_container_project_mismatch");
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("kong", {
    networks: { "supabase_network_another-project": {} },
  }), { projectId, projectDir, service: "kong" }).reason, "kong_container_network_mismatch");
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("kong", {
    networks: { [networkName]: networkAttachment, "shared_unexpected_network": networkAttachment },
  }), { projectId, projectDir, service: "kong" }).reason, "kong_container_network_mismatch");
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("rest", { networks: null }), {
    projectId, projectDir, service: "rest",
  }).reason, "rest_container_network_mismatch");
  assert.equal(validateSupabaseContainerMetadata(containerMetadata("db", {
    networks: { [networkName]: null },
  }), { projectId, projectDir, service: "db" }).reason, "db_container_network_metadata_invalid");
});

test("API hostname must match a published Kong address for its configured port", () => {
  const kong = containerMetadata("kong");
  assert.deepEqual(validateApiPublishedPort(kong, 58421, "127.0.0.1"), { ok: true });
  assert.deepEqual(validateApiPublishedPort({
    ...kong,
    ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "58421" }] },
  }, 58421, "127.0.0.1"), { ok: true });
  assert.deepEqual(validateApiPublishedPort({
    ...kong,
    ports: { "8000/tcp": [{ HostIp: "::1", HostPort: "58421" }] },
  }, 58421, "[::1]"), { ok: true });
  assert.deepEqual(validateApiPublishedPort(kong, 58421, "localhost"), { ok: true });

  assert.equal(validateApiPublishedPort({
    ...kong,
    ports: { "8000/tcp": [{ HostIp: "::1", HostPort: "58421" }] },
  }, 58421, "127.0.0.1").reason, "api_published_host_mismatch");
  assert.equal(validateApiPublishedPort({
    ...kong,
    ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "58421" }] },
  }, 58421, "[::1]").reason, "api_published_host_mismatch");
  assert.equal(validateApiPublishedPort({
    ...kong,
    ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "58421" }] },
  }, 58421, "localhost").reason, "api_published_host_mismatch");
  assert.equal(validateApiPublishedPort(kong, 58421, "0.0.0.0").reason, "api_hostname_unsupported");
  assert.equal(validateApiPublishedPort(kong, 58421, "localhost.localdomain").reason, "api_hostname_unsupported");
});

test("missing, malformed, conflicting, or ambiguous Kong published-address metadata fails closed", () => {
  const kong = containerMetadata("kong");
  assert.equal(validateApiPublishedPort({ ...kong, ports: { "8000/tcp": null } }, 58421, "127.0.0.1").reason, "api_published_port_missing");
  assert.equal(validateApiPublishedPort({ ...kong, ports: { "8000/tcp": [
    { HostIp: "127.0.0.1" },
  ] } }, 58421, "127.0.0.1").reason, "api_published_port_metadata_invalid");
  assert.equal(validateApiPublishedPort({ ...kong, ports: { "8000/tcp": [
    { HostIp: "127.0.0.1", HostPort: "58421" },
    { HostIp: "127.0.0.1", HostPort: "58422" },
  ] } }, 58421, "127.0.0.1").reason, "api_published_port_ambiguous");
  assert.equal(validateApiPublishedPort({ ...kong, ports: { "8000/tcp": [
    { HostIp: "0.0.0.0", HostPort: "58421" },
    { HostIp: "127.0.0.1", HostPort: "58421" },
  ] } }, 58421, "127.0.0.1").reason, "api_published_host_ambiguous");
  assert.equal(validateApiPublishedPort({ ...kong, ports: { "8000/tcp": [
    { HostIp: "127.0.0.1", HostPort: "58421" },
    { HostIp: "127.0.0.1", HostPort: "58421" },
  ] } }, 58421, "127.0.0.1").reason, "api_published_mapping_ambiguous");
  assert.equal(validateApiPublishedPort({ ...kong, ports: { "8000/tcp": [
    { HostIp: "192.0.2.10", HostPort: "58421" },
  ] } }, 58421, "127.0.0.1").reason, "api_published_host_mismatch");
  assert.equal(validateApiPublishedPort({ ...kong, ports: { "8000/tcp": [
    { HostIp: "127.0.0.1", HostPort: "54321" },
  ] } }, 58421, "127.0.0.1").reason, "api_published_port_mismatch");
});

test("database validation passes the parsed API hostname through to address matching", () => {
  assert.equal(validateDatabase({
    status: { ...status, API_URL: "http://[::1]:58421" },
    kongContainerMetadata: containerMetadata("kong", {
      ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "58421" }] },
    }),
  }).reason, "api_published_host_mismatch");
  assert.equal(validateDatabase({
    status: { ...status, API_URL: "http://localhost:58421" },
    kongContainerMetadata: containerMetadata("kong", {
      ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "58421" }] },
    }),
  }).reason, "api_published_host_mismatch");
});

test("a loopback URL is rejected unless it maps to this project's Kong and PostgREST services", () => {
  assert.equal(validateDatabase({
    kongContainerMetadata: containerMetadata("kong", {
      labels: { ...containerMetadata("kong").labels, "com.supabase.cli.project": "another-project" },
    }),
  }).reason, "kong_container_project_mismatch");
  assert.equal(validateDatabase({ kongContainerMetadata: null }).reason, "kong_container_missing");
  assert.equal(validateDatabase({ restContainerMetadata: null }).reason, "rest_container_missing");
  assert.equal(validateDatabase({
    kongContainerMetadata: containerMetadata("kong", { ports: { "8000/tcp": null } }),
  }).reason, "api_published_port_missing");
  assert.equal(validateDatabase({
    kongContainerMetadata: containerMetadata("kong", { ports: { "8000/tcp": [
      { HostIp: "127.0.0.1", HostPort: "58421" },
      { HostIp: "127.0.0.1", HostPort: "58422" },
    ] } }),
  }).reason, "api_published_port_ambiguous");
  assert.equal(validateDatabase({
    restContainerMetadata: containerMetadata("rest", {
      networks: { [networkName]: { NetworkID: "different-network-id", EndpointID: "rest-endpoint" } },
    }),
  }).reason, "container_network_identity_mismatch");
  assert.equal(validateDatabase({
    kongContainerMetadata: containerMetadata("kong", { ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } }),
  }).reason, "api_published_port_mismatch");
  assert.equal(validateDatabase({ apiPort: 58422 }).reason, "local_api_port_does_not_match_config");
});

test("PostgREST must be present on the project network and unpublished on the host", () => {
  const rest = containerMetadata("rest");
  assert.deepEqual(validateRestContainerUnpublished(rest), { ok: true });
  assert.equal(validateRestContainerUnpublished({ ...rest, ports: {} }).reason, "rest_container_port_metadata_missing");
  assert.equal(validateRestContainerUnpublished({ ...rest, ports: { "3000/tcp": [{ HostIp: "0.0.0.0", HostPort: "58423" }] } }).reason, "rest_container_unexpected_published_port");
  assert.equal(validateRestContainerUnpublished({ ...rest, ports: { "3000/tcp": null, "8080/tcp": null } }).reason, "rest_container_port_metadata_unsupported");
});

test("project gate rejects missing or incorrect deliberate mutation opt-in", () => {
  assert.equal(project({ optIn: undefined }).reason, "explicit_opt_in_required");
  assert.equal(project({ optIn: "true" }).reason, "explicit_opt_in_required");
});

test("project gate rejects ordinary project IDs, mismatches, and legacy endpoint overrides", () => {
  assert.equal(project({ expectedProjectId: "gdg-aceit-learn-communities" }).reason, "project_identity_mismatch");
  assert.equal(project({ configProjectId: `gdg-aceit-ranktest-${"b".repeat(32)}` }).reason, "project_identity_mismatch");
  assert.equal(project({ legacyTargetVariables: ["AUTO_PROGRESS_LOCAL_URL"] }).reason, "legacy_target_overrides_forbidden");
});

test("project gate requires a dedicated directory directly under temp and outside the repository", () => {
  assert.equal(project({ projectDir: path.join(repositoryRoot, projectId) }).reason, "project_must_be_unique_temp_directory");
  assert.equal(project({ repositoryRoot: tempRoot }).reason, "project_must_be_separate_from_repository");
  assert.equal(project({ tempRoot: path.dirname(tempRoot) }).reason, "project_must_be_unique_temp_directory");
});

test("database gate rejects nonlocal endpoints, incomplete status, and migration drift", () => {
  assert.equal(validateDatabase({ status: { ...status, API_URL: "https://example.test" } }).reason, "local_api_url_not_isolated");
  assert.equal(validateDatabase({ status: { API_URL: status.API_URL } }).reason, "local_supabase_status_incomplete");
  assert.equal(validateDatabase({ appliedMigrations: migrations.slice(0, 1) }).reason, "migration_history_mismatch");
});

test("README keeps Kong and PostgREST enabled for the REST-based concurrency harness", async () => {
  const readme = await readFile(new URL("./README-auto-progress-tests.md", import.meta.url), "utf8");
  const startCommand = readme.match(/supabase start[^\r\n]*/)?.[0] ?? "";
  assert.match(startCommand, /--exclude/);
  assert.doesNotMatch(startCommand, /(?:^|[,\s])kong(?:[,\s]|$)/);
  assert.doesNotMatch(startCommand, /(?:^|[,\s])postgrest(?:[,\s]|$)/);
  assert.match(readme, /REST-based concurrency harness/);
});

test("database gate refuses nonfresh participant, rank, job, or import state", () => {
  for (const changed of [
    { participants: 1 }, { nextRank: 11 }, { milestones: 1 }, { jobs: 1 },
    { jobItems: 1 }, { imports: 1 }, { importItems: 1 },
  ]) {
    assert.equal(validateDatabase({ databaseState: { ...freshState, ...changed } }).reason, "database_is_not_fresh_disposable_state");
  }
});

test("only an opted-in, uniquely named, fresh isolated project is accepted", () => {
  assert.deepEqual(validateDatabase(), {
    ok: true,
    projectId,
    apiUrl: status.API_URL,
    anonKey: status.ANON_KEY,
    serviceKey: status.SERVICE_ROLE_KEY,
    databaseContainer: `supabase_db_${projectId}`,
  });
});
