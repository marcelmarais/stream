#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "marcelmarais/stream";
const RELEASE_ASSET = "stream_aarch64.app.tar.gz";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readConfig(configPath) {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function bumpVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump;
  }

  const [major, minor, patch] = current.split(".").map(Number);

  switch (bump) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "major":
      return `${major + 1}.0.0`;
    default:
      return fail(`Expected patch, minor, major or x.y.z, got "${bump}"`);
  }
}

// Minisign stores the key id in bytes 2-9 of the payload on the second line
function minisignKeyId(encoded) {
  const text = Buffer.from(encoded.trim(), "base64").toString("utf8");
  const payload = Buffer.from(text.split("\n")[1], "base64");
  return payload.subarray(2, 10).toString("hex");
}

const commands = {
  version: ([configPath]) => {
    console.log(readConfig(configPath).version);
  },

  "next-version": ([configPath, bump]) => {
    console.log(bumpVersion(readConfig(configPath).version, bump));
  },

  // Rewrites only the version line, so the rest of the file stays as it is
  "set-version": ([configPath, version]) => {
    const source = readFileSync(configPath, "utf8");
    const updated = source.replace(
      /("version":\s*")[^"]+(")/,
      `$1${version}$2`,
    );

    if (updated === source) {
      fail(`Could not set version ${version} in ${configPath}`);
    }

    writeFileSync(configPath, updated);
  },

  // Exits non-zero unless the signature was made by the key the app trusts
  "check-signature": ([configPath, signaturePath]) => {
    const trusted = minisignKeyId(
      readConfig(configPath).plugins.updater.pubkey,
    );
    const signer = minisignKeyId(readFileSync(signaturePath, "utf8"));

    if (signer !== trusted) {
      fail(
        `Updater key mismatch: signed by ${signer}, but tauri.conf.json trusts ${trusted}.\nInstalled apps would reject this update.`,
      );
    }
  },

  manifest: ([version, signaturePath, notesPath, outputPath]) => {
    const platform = {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/${REPO}/releases/download/v${version}/${RELEASE_ASSET}`,
    };

    writeFileSync(
      outputPath,
      `${JSON.stringify(
        {
          version,
          notes: readFileSync(notesPath, "utf8").trim(),
          pub_date: new Date().toISOString(),
          platforms: {
            "darwin-aarch64": platform,
            "darwin-aarch64-app": platform,
          },
        },
        null,
        2,
      )}\n`,
    );
  },
};

const [command, ...args] = process.argv.slice(2);

if (!commands[command]) {
  fail(`Unknown command "${command}"`);
}

commands[command](args);
