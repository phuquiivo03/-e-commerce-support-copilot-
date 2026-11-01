#!/usr/bin/env node
/**
 * Fetches an OCI image from public.ecr.aws on the HOST network and loads it
 * into the local Docker daemon via `docker load`.
 *
 * Workaround for environments where the Docker Desktop VM cannot reach
 * registries (VM-internal DNS/proxy failures) while the host network can.
 *
 * Usage: node scripts/fetch-ecr-image.mjs public.ecr.aws/supabase/kong:2.8.1
 */
import { mkdirSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const imageRef = process.argv[2];
if (!imageRef) {
  console.error('usage: node scripts/fetch-ecr-image.mjs <registry/repo:tag>');
  process.exit(1);
}

const REGISTRY = 'public.ecr.aws';
const withoutTag = imageRef.slice('public.ecr.aws/'.length, imageRef.lastIndexOf(':'));
const tag = imageRef.slice(imageRef.lastIndexOf(':') + 1);
const workDir = join(process.cwd(), '.image-fetch', withoutTag.replace('/', '_'));

async function getToken() {
  const response = await fetch(`https://${REGISTRY}/token/?service=${REGISTRY}&scope=repository:${withoutTag}:pull`);
  if (!response.ok) throw new Error(`token request failed: ${response.status}`);
  return (await response.json()).token;
}

const MANIFEST_ACCEPTS = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

async function fetchManifestRaw(ref, token, attempt = 0) {
  const response = await fetch(`https://${REGISTRY}/v2/${withoutTag}/manifests/${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPTS },
  });
  if (!response.ok) {
    if (response.status === 429 && attempt < 6) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      return fetchManifestRaw(ref, token, attempt + 1);
    }
    throw new Error(`manifest ${ref} failed: ${response.status}`);
  }
  const raw = Buffer.from(await response.arrayBuffer());
  const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  const mediaType = response.headers.get('content-type') ?? '';
  return { raw, digest, mediaType, json: JSON.parse(raw.toString('utf8')) };
}

async function fetchBlob(digest, token, destPath, attempt = 0) {
  if (existsSync(destPath) && statSync(destPath).size > 0) return;
  try {
    const response = await fetch(`https://${REGISTRY}/v2/${withoutTag}/blobs/${digest}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`blob ${digest} failed: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(destPath, buffer);
    process.stdout.write(`  blob ${digest.slice(7, 19)}… ${(buffer.length / 1048576).toFixed(1)}MB\n`);
  } catch (error) {
    if (attempt >= 3) throw error;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return fetchBlob(digest, token, destPath, attempt + 1);
  }
}

async function main() {
  console.log(`fetching ${imageRef}`);
  rmSync(workDir, { recursive: true, force: true });
  const blobsDir = join(workDir, 'blobs', 'sha256');
  mkdirSync(blobsDir, { recursive: true });
  const token = await getToken();

  let index = await fetchManifestRaw(tag, token);
  let leaf = index;

  if (index.mediaType.includes('index') || index.mediaType.includes('manifest.list')) {
    const amd64 = index.json.manifests.find(
      (m) => m.platform?.architecture === 'amd64' && m.platform?.os === 'linux'
    );
    if (!amd64) throw new Error('no linux/amd64 manifest in index');
    leaf = await fetchManifestRaw(amd64.digest, token);
  }

  // Store the leaf manifest bytes under their verified digest.
  writeFileSync(join(blobsDir, leaf.digest.replace('sha256:', '')), leaf.raw);
  await fetchBlob(leaf.json.config.digest, token, join(blobsDir, leaf.json.config.digest.replace('sha256:', '')));
  for (const layer of leaf.json.layers) {
    await fetchBlob(layer.digest, token, join(blobsDir, layer.digest.replace('sha256:', '')));
  }

  // OCI layout: index.json references the leaf manifest with a ref name.
  writeFileSync(join(workDir, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
  writeFileSync(
    join(workDir, 'index.json'),
    JSON.stringify({
      schemaVersion: 2,
      manifests: [
        {
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          digest: leaf.digest,
          size: leaf.raw.length,
          platform: { architecture: 'amd64', os: 'linux' },
          annotations: { 'org.opencontainers.image.ref.name': imageRef },
        },
      ],
    })
  );

  console.log('building tarball…');
  const tarPath = `${workDir}.tar`;
  execFileSync('tar', ['-cf', tarPath, '-C', workDir, 'oci-layout', 'index.json', 'blobs']);
  console.log('docker load…');
  execFileSync('docker', ['load', '-i', tarPath], { stdio: 'inherit' });
  rmSync(workDir, { recursive: true, force: true });
  rmSync(tarPath, { force: true });
  console.log(`done: ${imageRef}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
