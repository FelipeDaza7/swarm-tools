#!/usr/bin/env bun
/**
 * Custom publish script that resolves workspace:* protocols before npm publish
 * 
 * 1. Uses bun pm pack to create tarball (resolves workspace:*)
 * 2. Uses npm publish on the tarball (supports OIDC trusted publishers)
 */

import { $ } from "bun";
import { readdir, unlink } from "node:fs/promises";

const packages = [
  "packages/swarm-mail",
  "packages/opencode-swarm-plugin",
];

async function getPublishedVersion(name: string): Promise<string | null> {
  try {
    const result = await $`npm view ${name} version`.quiet().text();
    return result.trim();
  } catch {
    return null; // Not published yet
  }
}

async function getLocalVersion(pkgPath: string): Promise<{ name: string; version: string }> {
  const pkg = await Bun.file(`${pkgPath}/package.json`).json();
  return { name: pkg.name, version: pkg.version };
}

async function findTarball(pkgPath: string): Promise<string> {
  const files = await readdir(pkgPath);
  const tarball = files.find(f => f.endsWith('.tgz'));
  if (!tarball) throw new Error(`No tarball found in ${pkgPath}`);
  return `${pkgPath}/${tarball}`;
}

async function main() {
  console.log("🦋 Checking packages for publishing...\n");

  for (const pkgPath of packages) {
    const { name, version } = await getLocalVersion(pkgPath);
    const publishedVersion = await getPublishedVersion(name);

    if (publishedVersion === version) {
      console.log(`⏭️  ${name}@${version} already published, skipping`);
      continue;
    }

    console.log(`📦 Publishing ${name}@${version} (npm has ${publishedVersion ?? "nothing"})...`);
    
    try {
      // Step 1: Use bun pack to create tarball (resolves workspace:* protocols)
      console.log(`   📋 Creating tarball with bun pack...`);
      await $`bun pm pack`.cwd(pkgPath).quiet();
      
      // Step 2: Find the tarball
      const tarball = await findTarball(pkgPath);
      console.log(`   📦 Found tarball: ${tarball}`);
      
      // Step 3: Publish tarball with npm (supports OIDC)
      console.log(`   🚀 Publishing with npm...`);
      await $`npm publish ${tarball} --access public`.quiet();
      
      // Step 4: Clean up tarball
      await unlink(tarball);
      
      console.log(`✅ ${name}@${version} published successfully`);
      
      // Create git tag
      const tag = `${name}@${version}`;
      await $`git tag ${tag}`.quiet();
      await $`git push origin ${tag}`.quiet();
      console.log(`🏷️  Created and pushed tag: ${tag}`);
    } catch (error) {
      console.error(`❌ Failed to publish ${name}:`, error);
      process.exit(1);
    }
  }

  console.log("\n✨ Done!");
}

main();
