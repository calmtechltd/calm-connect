import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const endpoint = "https://app.calmcompliance.com/mcp";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

async function rejectSymlinks(directory = root) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    assert(!metadata.isSymbolicLink(), `Plugin packages cannot contain symlinks: ${path}`);
    if (metadata.isDirectory()) await rejectSymlinks(path);
  }
}

const portable = await json("plugin.json");
const portableMcp = await json("mcp.json");
const codex = await json(".codex-plugin/plugin.json");
const codexMcp = await json(".mcp.json");
const claude = await json(".claude-plugin/plugin.json");

assert(
  portable.$schema === "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "Unexpected Agent Plugin schema.",
);
assert(
  portableMcp.$schema === "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "Unexpected Agent Plugin MCP schema.",
);
assert(
  portableMcp.mcpServers?.calm?.type === "streamable-http",
  "Portable MCP must use Streamable HTTP.",
);
assert(codexMcp.mcpServers?.calm?.type === "http", "Codex MCP must use HTTP.");
assert(portableMcp.mcpServers.calm.url === endpoint, "Portable MCP endpoint changed.");
assert(codexMcp.mcpServers.calm.url === endpoint, "Codex MCP endpoint changed.");

for (const manifest of [portable, codex, claude]) {
  assert(manifest.name === "calm-connect", "Plugin manifests must use the calm-connect identifier.");
  assert(manifest.version === portable.version, "Plugin manifest versions must match.");
  assert(
    manifest.repository === "https://github.com/calmtechltd/calm-connect",
    "Plugin repository metadata changed.",
  );
}

const serialized = JSON.stringify({ portable, portableMcp, codex, codexMcp, claude });
assert(
  !/(api[_-]?key|client[_-]?secret|authorization|bearer\s)/iu.test(serialized),
  "Plugin manifests must not contain credentials or authorization headers.",
);

await rejectSymlinks();
process.stdout.write(`Validated Calm Connect ${portable.version}.\n`);
