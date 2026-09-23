#!/bin/bash
# usage: run.sh start|stop  (uses stage/)
cd /tmp/claude-0/pbtest
if [ "$1" = stop ]; then [ -f pb.pid ] && kill $(cat pb.pid) 2>/dev/null; rm -f pb.pid; sleep 1; exit 0; fi
nohup ./pocketbase serve --dir stage/data --migrationsDir stage/mig --hooksDir stage/hooks --automigrate=false --http 127.0.0.1:8091 > stage/log.txt 2>&1 &
echo $! > pb.pid; sleep 3; head -40 stage/log.txt
