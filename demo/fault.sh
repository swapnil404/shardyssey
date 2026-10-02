#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
dc() { docker compose --env-file images.env "$@"; }
tc_cmd() { dc exec -T fault tc "$@"; }
case "${1:-}" in
  on)
    ms=${2:-500}
    [[ "$ms" =~ ^[0-9]+$ ]] && ((ms >= 100 && ms <= 1000)) || { echo 'Delay must be 100–1000 ms' >&2; exit 2; }
    ip=$(dc exec -T fault getent ahostsv4 tablet-right | awk 'NR==1 {print $1}')
    [[ "$ip" =~ ^[0-9.]+$ ]] || exit 1
    # All unmatched traffic, including Jaeger exports and the other tablet, is normal.
    tc_cmd qdisc add dev eth0 root handle 1: prio bands 3 priomap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
    trap 'tc_cmd qdisc del dev eth0 root || true' ERR
    tc_cmd qdisc add dev eth0 parent 1:3 handle 30: netem delay "${ms}ms"
    tc_cmd filter add dev eth0 protocol ip parent 1: prio 1 u32 match ip dst "$ip/32" match ip dport 15991 0xffff flowid 1:3
    lease=$(cat /proc/sys/kernel/random/uuid)
    dc exec -T fault sh -c 'echo "$1" > /tmp/shardyssey-fault-lease' sh "$lease"
    dc exec -d fault sh -c 'sleep 90; if [ "$(cat /tmp/shardyssey-fault-lease 2>/dev/null)" = "$1" ]; then tc qdisc del dev eth0 root; rm -f /tmp/shardyssey-fault-lease; fi' sh "$lease"
    ;;
  off)
    # Deleting a missing qdisc is harmless; container/service failures are not.
    state=$(tc_cmd qdisc show dev eth0)
    if [[ "$state" == *'prio 1:'* ]]; then tc_cmd qdisc del dev eth0 root; fi
    dc exec -T fault rm -f /tmp/shardyssey-fault-lease
    ;;
  status) tc_cmd -s qdisc show dev eth0; tc_cmd filter show dev eth0 ;;
  *) echo 'Usage: demo/fault.sh on [100–1000 ms]|off|status' >&2; exit 2 ;;
esac
