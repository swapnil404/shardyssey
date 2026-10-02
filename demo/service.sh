#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$VTDATAROOT/tmp"
topo=(--topo-implementation etcd2 --topo-global-server-address etcd:2379 --topo-global-root /vitess/global)
tracing=(--tracer opentelemetry --otel-endpoint jaeger:4317 --otel-insecure --tracing-sampling-rate 1)
case "$1" in
  vtctld)
    exec vtctld "${topo[@]}" --cell local --port 15000 --grpc-port 15999 --service-map grpc-vtctld
    ;;
  vtgate)
    exec vtgate "${topo[@]}" "${tracing[@]}" --cell local --cells-to-watch local --tablet-types-to-wait PRIMARY --port 15001 --grpc-port 15991 --mysql-server-port 15306 --mysql-auth-server-impl none --service-map grpc-vtgateservice
    ;;
  tablet)
    printf -v tablet_dir 'vt_%010d' "$TABLET_UID"
    if [[ -d "$VTDATAROOT/$tablet_dir" ]]; then action=start; else action=init; fi
    # The container owns this data volume; no mysqld is running at entry.
    rm -f "$VTDATAROOT/$tablet_dir/mysql.sock" "$VTDATAROOT/$tablet_dir/mysql.sock.lock" "$VTDATAROOT/$tablet_dir/mysql.pid"
    mysqlctl --tablet-uid "$TABLET_UID" --mysql-port 3306 "$action"
    mysql --socket "$VTDATAROOT/$tablet_dir/mysql.sock" -u root -e 'SET GLOBAL super_read_only=OFF; CREATE DATABASE IF NOT EXISTS vt_demo'
    exec vttablet "${topo[@]}" "${tracing[@]}" --tablet-path "local-$(printf '%010d' "$TABLET_UID")" --tablet-hostname "$TABLET_HOST" --init-keyspace demo --init-shard "$SHARD" --init-tablet-type replica --port 15002 --grpc-port 15991 --service-map grpc-queryservice,grpc-tabletmanager --health-check-interval 1s
    ;;
  *) exit 2 ;;
esac
