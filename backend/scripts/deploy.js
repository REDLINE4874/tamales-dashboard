const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const backendRoot = path.resolve(__dirname, "..");
const claspCli = path.join(
  backendRoot,
  "node_modules",
  "@google",
  "clasp",
  "build",
  "src",
  "index.js",
);
const frontendConfig = path.resolve(
  backendRoot,
  "..",
  "frontend",
  "src",
  "config.js",
);

function deploymentIdFromOutput(output) {
  const plainOutput = output.replace(/\u001b\[[0-9;]*m/g, "");
  const matches = [
    ...plainOutput.matchAll(/^\s*-\s+([A-Za-z0-9_-]+)\s+@\d+\.\s*$/gm),
  ];
  if (matches.length !== 1) {
    throw new Error("No se pudo identificar el ID de la implementación en la salida de clasp.");
  }
  return matches[0][1];
}

function updateApiUrl(configPath, url) {
  const source = fs.readFileSync(configPath, "utf8");
  const assignment =
    /(const\s+API_URL\s*=\s*)(["'])([^"'\r\n]*)\2(\s*;)/;
  if (!assignment.test(source)) {
    throw new Error(`No se encontró la asignación de API_URL en ${configPath}.`);
  }
  const updated = source.replace(
    assignment,
    (_match, declaration, _quote, _currentUrl, ending) =>
      declaration + JSON.stringify(url) + ending,
  );
  fs.writeFileSync(configPath, updated, "utf8");
}

function deploy() {
  const result = spawnSync(
    process.execPath,
    [claspCli, "deploy", ...process.argv.slice(2)],
    { cwd: backendRoot, encoding: "utf8" },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return;
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const deploymentId = deploymentIdFromOutput(output);
  const apiUrl = `https://script.google.com/macros/s/${deploymentId}/exec`;
  updateApiUrl(frontendConfig, apiUrl);
  console.log(`API_URL actualizada en frontend/src/config.js: ${apiUrl}`);
}

if (require.main === module) {
  try {
    deploy();
  } catch (error) {
    console.error(`Error al actualizar la URL de Apps Script: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { deploymentIdFromOutput, updateApiUrl };
