#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
dc() { docker compose --env-file images.env "$@"; }
ctl() { dc exec -T vtctld vtctldclient --server localhost:15999 "$@"; }
wait_for() {
  for ((i=0;i<120;i++)); do if "$@"; then return; fi; sleep 1; done
  echo "Timed out waiting for: $*" >&2; dc logs --tail 40 >&2; return 1
}
case "${1:-}" in
  up)
    dc up -d etcd jaeger vtctld
    wait_for ctl GetKeyspaces
    if ! ctl GetCellInfo local; then
      ctl AddCellInfo --root /vitess/local --server-address etcd:2379 local
    fi
    if ! ctl GetKeyspace demo; then ctl CreateKeyspace --durability-policy none demo; fi
    dc up -d tablet-left tablet-right
    wait_for ctl GetTablet local-0000000100
    wait_for ctl GetTablet local-0000000200
    wait_for ctl InitShardPrimary --force demo/-80 local-0000000100
    wait_for ctl InitShardPrimary --force demo/80- local-0000000200
    ctl ApplySchema --sql-file /demo/schema.sql demo
    ctl ApplyVSchema --vschema-file /demo/vschema.json demo
    ctl RebuildKeyspaceGraph demo
    dc up -d vtgate fault
    wait_for dc exec -T vtgate mysql -h 127.0.0.1 -P 15306 -u root demo -e 'SELECT COUNT(*) FROM events'
    dc exec -T vtgate mysql -h 127.0.0.1 -P 15306 -u root demo < seed.sql
    ;;
  sql) shift; dc exec -T vtgate mysql --comments --batch --raw -h 127.0.0.1 -P 15306 -u root demo "$@" ;;
  ctl) shift; ctl "$@" ;;
  down) dc down ;;
  *) echo 'Usage: demo/cluster.sh up|sql|ctl|down' >&2; exit 2 ;;
esac
