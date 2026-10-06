import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

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
  assert(manifest.description === portable.description, "Plugin descriptions must match.");
  assert(manifest.homepage === portable.homepage, "Plugin homepages must match.");
  assert(
    manifest.repository === "https://github.com/calmtechltd/calm-connect",
    "Plugin repository metadata changed.",
  );
}

const listing = codex.interface;
assert(
  JSON.stringify(portable.extensions?.["com.openai"]?.interface) === JSON.stringify(listing),
  "Portable and Codex listing metadata must match.",
);
for (const [field, limit] of [
  ["displayName", 30],
  ["shortDescription", 30],
  ["longDescription", 4000],
  ["developerName", 80],
]) {
  assert(
    typeof listing?.[field] === "string" && listing[field].trim().length > 0 && listing[field].length <= limit,
    `Listing ${field} must contain 1–${limit} characters.`,
  );
}
const prompts = Array.isArray(listing.defaultPrompt) ? listing.defaultPrompt : [listing.defaultPrompt];
assert(prompts.length > 0 && prompts.length <= 3, "Provide one to three starter prompts.");
assert(new Set(prompts).size === prompts.length, "Starter prompts must be unique.");
assert(
  prompts.every((prompt) => typeof prompt === "string" && prompt.trim().length > 0 && prompt.length <= 128),
  "Starter prompts must contain 1–128 characters.",
);
for (const field of ["websiteURL", "supportURL"]) {
  const url = new URL(listing[field]);
  assert(url.protocol === "https:" && !url.username && !url.password, `Listing ${field} must use public HTTPS.`);
}
for (const field of ["logo", "composerIcon"]) {
  const asset = listing[field];
  assert(typeof asset === "string" && asset.startsWith("./assets/"), `Listing ${field} must reference a packaged asset.`);
  const assetPath = resolve(root, asset);
  const fromRoot = relative(root, assetPath);
  assert(!fromRoot.startsWith("..") && !isAbsolute(fromRoot), `Listing ${field} must stay inside the package.`);
  const metadata = await lstat(assetPath);
  assert(metadata.isFile() && metadata.size > 0, `Listing ${field} asset must be a nonempty file.`);
}

const serialized = JSON.stringify({ portable, portableMcp, codex, codexMcp, claude });
assert(
  !/(api[_-]?key|client[_-]?secret|authorization|bearer\s)/iu.test(serialized),
  "Plugin manifests must not contain credentials or authorization headers.",
);

await rejectSymlinks();
process.stdout.write(`Validated Calm Connect ${portable.version}.\n`);
