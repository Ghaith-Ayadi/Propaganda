#!/bin/bash
# Fresh rehearsal: pre-migration data copy + current Propaganda pb/ files.
cd /tmp/claude-0/pbtest
./run.sh stop
rm -rf stage/data stage/mig stage/hooks && cp -r stage/data-before stage/data
cp -r /home/user/Propaganda/pb/pb_migrations stage/mig && cp -r /home/user/Propaganda/pb/pb_hooks stage/hooks
./run.sh start >/dev/null; grep -i "error\|fail" stage/log.txt | head
cd scripts && node snapshot.mjs > after.json && python3 -c "
import json;a=json.load(open('before.json'));b=json.load(open('after.json'))
print('content unchanged:', all(a[k]==b[k] for k in a))"
