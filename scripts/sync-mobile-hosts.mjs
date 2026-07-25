import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  repositoryRoot,
  "src-tauri/mobile/android/MainActivity.kt",
);
const destination = resolve(
  repositoryRoot,
  "src-tauri/gen/android/app/src/main/java/app/novelier/reader/MainActivity.kt",
);
const generatedAndroidRoot = resolve(repositoryRoot, "src-tauri/gen/android");
const generatedAndroidBuild = resolve(
  generatedAndroidRoot,
  "app/build.gradle.kts",
);

try {
  if (!(await stat(generatedAndroidRoot)).isDirectory()) process.exit(0);
} catch {
  // `src-tauri/gen` is intentionally ignored. Desktop-only checkouts do not
  // need an Android host until `tauri android init` creates this directory.
  process.exit(0);
}

const next = await readFile(source, "utf8");
let current = "";
try {
  current = await readFile(destination, "utf8");
} catch {
  // The package path may not exist yet immediately after Android init.
}

if (current !== next) {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, next, "utf8");
  console.log("Synced NOVELIER Android hardware-navigation host.");
}

try {
  const androidBuild = await readFile(generatedAndroidBuild, "utf8");
  const releaseMinification =
    '        getByName("release") {\n            isMinifyEnabled = true';
  const releaseOptimization =
    `${releaseMinification}\n            isShrinkResources = true`;

  if (
    androidBuild.includes(releaseMinification) &&
    !androidBuild.includes("isShrinkResources = true")
  ) {
    await writeFile(
      generatedAndroidBuild,
      androidBuild.replace(releaseMinification, releaseOptimization),
      "utf8",
    );
    console.log("Enabled NOVELIER Android release resource shrinking.");
  }
} catch {
  // Tauri can recreate this generated build file during Android init. The next
  // mobile sync will apply the release-only optimization once it exists.
}
