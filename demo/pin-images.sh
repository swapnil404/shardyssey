#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
for spec in VITESS_IMAGE=vitess/lite:v24.0.0 ETCD_IMAGE=registry.k8s.io/etcd:3.5.21-0 JAEGER_IMAGE=jaegertracing/all-in-one:1.76.0 FAULT_IMAGE=nicolaka/netshoot:v0.14; do
  name=${spec%%=*}; tag=${spec#*=}
  docker pull "$tag"
  digest=$(docker image inspect "$tag" --format '{{index .RepoDigests 0}}')
  printf '%s=%s\n' "$name" "$digest" >> "$tmp"
done
mv "$tmp" images.env
