#!/usr/bin/env bash
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$dir")"
bump_type="patch"

usage() {
  echo "Usage: $0 [--version major|minor|patch]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      if [[ $# -lt 2 ]]; then
        echo "Error: --version requires one of: major, minor, patch" >&2
        usage >&2
        exit 1
      fi
      bump_type="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$bump_type" in
  major|minor|patch)
    ;;
  *)
    echo "Error: --version must be one of: major, minor, patch" >&2
    exit 1
    ;;
esac

if [[ -z "${HARBORCLIENT_PLUGIN_SIGNING_KEY:-}" ]]; then
  echo "Warning: HARBORCLIENT_PLUGIN_SIGNING_KEY is not set." >&2
  echo "Export the path to your Ed25519 private key PEM before publishing." >&2
  exit 1
fi

cd "$root"

new_version="$(
  node --input-type=module - "$bump_type" <<'NODE'
import fs from "node:fs";

const bump = process.argv[2];
const manifestPath = "manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.version);

if (!match) {
  throw new Error(`Invalid manifest version: ${manifest.version}`);
}

const [, majorText, minorText, patchText] = match;
let major = Number(majorText);
let minor = Number(minorText);
let patch = Number(patchText);

if (bump === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const newVersion = `${major}.${minor}.${patch}`;
manifest.version = newVersion;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(newVersion);
NODE
)"

key_id="$(
  node --input-type=module - <<'NODE'
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
console.log(manifest.id);
NODE
)"

pnpm build
pnpm sign -- --dir . \
  --private-key "$HARBORCLIENT_PLUGIN_SIGNING_KEY" \
  --key-id "$key_id"

git commit . -m "Incremented to version ${new_version}"
git tag "v${new_version}"
git push
git push --tags
