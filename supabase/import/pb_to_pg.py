#!/usr/bin/env python3
"""Copy Propaganda from PocketBase to Postgres, and prove the copy.

Copy-first: PocketBase is only ever read. Three steps, each repeatable:

  export   PocketBase -> one JSON snapshot (stdout). Reads the API as a
           superuser, hidden fields included. Run where PocketBase is reachable
           (on the box: see supabase/README.md).
             PB_URL, PB_SUPERUSER_EMAIL, PB_SUPERUSER_PASSWORD

  load     snapshot -> Postgres. Users go through the auth server's admin API
           (created once, found again by email on later runs) with their
           PocketBase id as app_metadata.pb_id. Everything else is replaced in
           ONE transaction, in import mode: rows keep their ids, timestamps,
           numbers and slugs, and no trigger rewrites them. Refuses once
           private.import_lock has a row (the cutover happened).
             AUTH_URL (e.g. http://localhost:54321/auth/v1), SERVICE_ROLE_KEY,
             PSQL (a psql command line as the database owner)

  verify   snapshot vs Postgres: counts per collection per site, then every
           row, field by field (bodies and version history byte-for-byte).
           Exits non-zero on any difference.
             PSQL

  python3 pb_to_pg.py export > snapshot.json
  python3 pb_to_pg.py load snapshot.json
  python3 pb_to_pg.py verify snapshot.json

Standard library only, so it runs on the box as is.
"""
import datetime
import hashlib
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

# PocketBase collection -> (Postgres table, [(column, kind)]). Kinds:
#   text  "" stays ""            int   0 stays 0            bool
#   date  "" -> NULL             json  as is (NULL stays NULL)
#   ref   "" -> NULL (a relation that may be empty)
#   user  PocketBase user id -> auth user uuid
# `id` and `site` come first everywhere; every column of the table is listed,
# so the loader can fill whole rows.
TABLES = [
    ("sites", "public.sites", [
        ("id", "text"), ("name", "text"), ("slug", "text"), ("domain", "text"),
        ("analytics_tenant", "text"), ("created", "date"), ("updated", "date"),
    ]),
    ("site_members", "public.site_members", [
        ("id", "text"), ("site", "text"), ("user", "user"), ("role", "text"),
        ("created", "date"), ("updated", "date"),
    ]),
    ("collections", "public.collections", [
        ("id", "text"), ("site", "text"), ("name", "text"), ("slug", "text"), ("emoji", "text"),
        ("description", "text"), ("position", "int"), ("is_hidden", "bool"),
        ("created", "date"), ("updated", "date"),
    ]),
    ("posts", "public.posts", [
        ("id", "text"), ("site", "text"), ("legacy_id", "int"), ("number", "int"), ("title", "text"),
        ("slug", "text"), ("post_id", "text"), ("type", "text"), ("status", "text"),
        ("subtitle", "text"), ("done_at", "date"), ("published_at", "date"), ("excerpt", "text"),
        ("category", "text"), ("tags", "json"), ("content_md", "text"), ("notion_id", "text"),
        ("favorited", "bool"), ("collection_seq", "int"), ("word_count", "int"),
        ("shareable_quotes", "json"), ("created", "date"), ("updated", "date"),
    ]),
    ("post_versions", "public.post_versions", [
        ("id", "text"), ("site", "text"), ("post", "text"), ("version", "int"), ("content", "text"),
        ("attributes", "json"), ("created_by", "text"), ("message", "text"), ("authored", "date"),
        ("legacy_id", "text"), ("created", "date"),
    ]),
    ("brief_templates", "public.brief_templates", [
        ("id", "text"), ("site", "text"), ("name", "text"), ("body", "text"), ("checks", "json"),
        ("tenant", "text"), ("created", "date"), ("updated", "date"),
    ]),
    ("briefs", "public.briefs", [
        ("id", "text"), ("site", "text"), ("title", "text"), ("status", "text"),
        ("assignee_ids", "json"), ("planned_date", "text"), ("tags", "json"), ("template", "ref"),
        ("collection_name", "text"), ("body", "text"), ("checks", "json"), ("post", "ref"),
        ("tenant", "text"), ("created", "date"), ("updated", "date"),
    ]),
    ("app_settings", "public.app_settings", [
        ("id", "text"), ("site", "text"), ("key", "text"), ("value", "json"), ("updated", "date"),
    ]),
    ("writing_activity", "public.writing_activity", [
        ("id", "text"), ("site", "text"), ("tenant", "text"), ("day", "text"), ("words", "int"),
        ("updated", "date"),
    ]),
    ("post_redirects", "public.post_redirects", [
        ("id", "text"), ("site", "text"), ("collection", "text"), ("slug", "text"), ("post", "text"),
        ("created", "date"),
    ]),
]
# Postgres column name where it differs from PocketBase's.
RENAMED = {("site_members", "user"): "user_id"}


def die(msg):
    print(f"pb_to_pg: {msg}", file=sys.stderr)
    sys.exit(1)


def env(name):
    value = os.environ.get(name, "").strip().strip("'\"")
    if not value:
        die(f"{name} is not set")
    return value


def http(method, url, token=None, body=None, auth_scheme=""):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"{auth_scheme}{token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url}: {e.code} {e.read().decode(errors='replace')[:300]}") from None


# ---- export ----

def export():
    base = env("PB_URL").rstrip("/")
    auth = http("POST", f"{base}/api/collections/_superusers/auth-with-password",
                body={"identity": env("PB_SUPERUSER_EMAIL"), "password": env("PB_SUPERUSER_PASSWORD")})
    token = auth["token"]

    def all_records(collection):
        out, page = [], 1
        while True:
            q = urllib.parse.urlencode({"page": page, "perPage": 500, "sort": "id"})
            res = http("GET", f"{base}/api/collections/{collection}/records?{q}", token)
            out.extend(res["items"])
            if page >= res["totalPages"]:
                return out
            page += 1

    snapshot = {
        "exported_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": base,
        "users": [
            {"id": u["id"], "email": u.get("email", ""), "name": u.get("name", ""), "verified": bool(u.get("verified"))}
            for u in all_records("users")
        ],
        "collections": {pb: all_records(pb) for pb, _, _ in TABLES},
    }
    json.dump(snapshot, sys.stdout, ensure_ascii=False)


# ---- shared ----

def pb_date(value):
    """PocketBase "2026-09-15 23:51:59.848Z" -> ISO 8601, "" -> None."""
    return value.replace(" ", "T") if value else None


def row_for(pb_name, record, columns, users):
    row = {}
    for col, kind in columns:
        value = record.get(col)
        if kind == "text":
            value = "" if value is None else str(value)
        elif kind == "int":
            value = int(value or 0)
        elif kind == "bool":
            value = bool(value)
        elif kind == "date":
            value = pb_date(value)
        elif kind == "ref":
            value = value or None
        elif kind == "user":
            if value not in users:
                die(f"{pb_name}/{record['id']}: unknown user {value!r}")
            value = users[value]
        row[RENAMED.get((pb_name, col), col)] = value
    return row


def psql(sql, *args):
    cmd = shlex.split(env("PSQL")) + ["-v", "ON_ERROR_STOP=1", "-X", "-q", *args]
    res = subprocess.run(cmd, input=sql.encode(), capture_output=True)
    if res.returncode != 0:
        die(f"psql failed:\n{res.stderr.decode(errors='replace')}")
    return res.stdout.decode()


def query_json(sql):
    out = psql(f"select coalesce(json_agg(q), '[]') from ({sql}) q;", "-tA").strip()
    return json.loads(out or "[]")


def dollar(text):
    tag = f"$pb{secrets.token_hex(6)}$"
    if tag in text:
        return dollar(text)
    return f"{tag}{text}{tag}"


# ---- load ----

def load_users(snapshot):
    """PocketBase user id -> auth user uuid, creating users that don't exist yet."""
    auth = env("AUTH_URL").rstrip("/")
    key = env("SERVICE_ROLE_KEY")
    existing, page = {}, 1
    while True:
        res = http("GET", f"{auth}/admin/users?page={page}&per_page=1000", key, auth_scheme="Bearer ")
        for u in res.get("users", []):
            existing[(u.get("email") or "").lower()] = u
        if len(res.get("users", [])) < 1000:
            break
        page += 1

    mapping = {}
    for u in snapshot["users"]:
        email = u["email"].strip().lower()
        if not email:
            die(f"user {u['id']} has no email")
        found = existing.get(email)
        meta = {"pb_id": u["id"]}
        if found:
            if (found.get("app_metadata") or {}).get("pb_id") != u["id"]:
                http("PUT", f"{auth}/admin/users/{found['id']}", key, {"app_metadata": meta}, "Bearer ")
            mapping[u["id"]] = found["id"]
        else:
            created = http("POST", f"{auth}/admin/users", key, {
                "email": email,
                "email_confirm": u["verified"],
                "app_metadata": meta,
                "user_metadata": {"name": u["name"]} if u["name"] else {},
            }, "Bearer ")
            mapping[u["id"]] = created["id"]
    return mapping


def load(path):
    snapshot = json.load(open(path))
    locked = psql("select count(*) from private.import_lock;", "-tA").strip()
    if locked != "0":
        die("private.import_lock has a row: this database is live, refusing to replace its content")
    users = load_users(snapshot)

    sites = snapshot["collections"]["sites"]
    statements = [
        "begin;",
        "set local propaganda.importing = 'on';",
        # Children first.
        *[f"delete from {table};" for _, table, _ in reversed(TABLES)],
    ]
    counts = {}
    for pb_name, table, columns in TABLES:
        rows = [row_for(pb_name, r, columns, users) for r in snapshot["collections"][pb_name]]
        counts[pb_name] = len(rows)
        if not rows:
            continue
        cols = ", ".join(RENAMED.get((pb_name, c), c) for c, _ in columns)
        statements.append(
            f"insert into {table} ({cols}) select {cols} from "
            f"jsonb_populate_recordset(null::{table}, {dollar(json.dumps(rows, ensure_ascii=False))}::jsonb);"
        )
    # The hidden fields of `sites`, now in private.site_internals (whose rows
    # the insert above created).
    for s in sites:
        created_by = users.get(s.get("created_by") or "", None)
        statements.append(
            "update private.site_internals set post_counter = {n}, created_by = {by} where site = {site};".format(
                n=int(s.get("post_counter") or 0),
                by=f"'{created_by}'::uuid" if created_by else "null",
                site=dollar(s["id"]),
            )
        )
    statements.append(
        "insert into private.import_runs (exported_at, counts) values ({at}, {counts}::jsonb);".format(
            at=dollar(snapshot["exported_at"]), counts=dollar(json.dumps(counts)),
        )
    )
    statements.append("commit;")
    psql("\n".join(statements))
    print(json.dumps({"loaded": counts, "users": len(users)}))


# ---- verify ----

def canonical(kind, value):
    """One comparable form for a value from either side."""
    if kind == "date":
        if not value:
            return None
        # Any Python 3: pad the fraction to microseconds and the offset to +HH:MM.
        m = re.match(r"(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$", value)
        if not m:
            raise ValueError(f"not a timestamp: {value!r}")
        day, time, frac, tz = m.groups()
        tz = "+00:00" if tz in (None, "Z") else (tz if len(tz) == 6 else (tz + ":00" if len(tz) == 3 else tz[:3] + ":" + tz[3:]))
        dt = datetime.datetime.fromisoformat(f"{day}T{time}.{(frac or '0')[:6].ljust(6, '0')}{tz}")
        return round(dt.timestamp() * 1000)
    if kind == "json":
        return json.dumps(value, sort_keys=True, ensure_ascii=False)
    if kind == "ref":
        return value or None
    if kind == "text":
        return "" if value is None else value
    if kind == "int":
        return int(value or 0)
    if kind == "bool":
        return bool(value)
    return value


def verify(path):
    snapshot = json.load(open(path))
    users = {u["id"]: u["email"].lower() for u in snapshot["users"]}
    pg_users = {r["id"]: (r["email"] or "").lower() for r in query_json("select id, email from auth.users")}
    failures = 0

    def fail(msg):
        nonlocal failures
        failures += 1
        if failures <= 50:
            print(f"DIFF  {msg}")

    for pb_name, table, columns in TABLES:
        pb_rows = {r["id"]: r for r in snapshot["collections"][pb_name]}
        pg_rows = {r["id"]: r for r in query_json(f"select * from {table}")}
        # Counts per site.
        def per_site(rows, key):
            out = {}
            for r in rows.values():
                site = r.get(key) if pb_name != "sites" else r["id"]
                out[site] = out.get(site, 0) + 1
            return out
        a, b = per_site(pb_rows, "site"), per_site(pg_rows, "site")
        status = "ok" if a == b else "MISMATCH"
        print(f"{pb_name:18} {sum(a.values()):5} PocketBase  {sum(b.values()):5} Postgres  {status}  {json.dumps(a, sort_keys=True)}")
        if a != b:
            failures += 1
        for rid in pb_rows.keys() - pg_rows.keys():
            fail(f"{pb_name}/{rid} missing in Postgres")
        for rid in pg_rows.keys() - pb_rows.keys():
            fail(f"{pb_name}/{rid} only in Postgres")
        # Every field of every row.
        digest = hashlib.sha256()
        for rid in sorted(pb_rows.keys() & pg_rows.keys()):
            pb, pg = pb_rows[rid], pg_rows[rid]
            for col, kind in columns:
                pg_col = RENAMED.get((pb_name, col), col)
                if kind == "user":
                    left, right = users.get(pb.get(col)), pg_users.get(pg.get(pg_col))
                else:
                    left, right = canonical(kind, pb.get(col)), canonical(kind, pg.get(pg_col))
                if left != right:
                    fail(f"{pb_name}/{rid}.{col}: {str(left)[:80]!r} != {str(right)[:80]!r}")
                digest.update(f"{rid}.{col}={left}".encode())
        if pb_name in ("posts", "post_versions"):
            print(f"{'':18} every field identical across {len(pb_rows)} rows, sha256 {digest.hexdigest()[:16]}")

    # The hidden fields.
    internals = {r["site"]: r for r in query_json("select site, post_counter, created_by from private.site_internals")}
    for s in snapshot["collections"]["sites"]:
        got = internals.get(s["id"], {})
        if int(s.get("post_counter") or 0) != got.get("post_counter"):
            fail(f"sites/{s['id']}.post_counter: {s.get('post_counter')} != {got.get('post_counter')}")
        want_by = users.get(s.get("created_by") or "")
        if want_by and pg_users.get(got.get("created_by")) != want_by:
            fail(f"sites/{s['id']}.created_by differs")
    # Every user, with their PocketBase id.
    meta = {r["pb_id"]: (r["email"] or "").lower()
            for r in query_json("select raw_app_meta_data->>'pb_id' as pb_id, email from auth.users where raw_app_meta_data ? 'pb_id'")}
    for pb_id, email in users.items():
        if meta.get(pb_id) != email.lower():
            fail(f"users/{pb_id} ({email}) has no auth user with that pb_id")
    print(f"users              {len(users):5} PocketBase  {len(meta):5} with pb_id")

    print("VERIFY: ALL IDENTICAL" if not failures else f"VERIFY: {failures} DIFFERENCES")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("export", "load", "verify"):
        die(__doc__)
    if sys.argv[1] == "export":
        export()
    elif len(sys.argv) < 3:
        die(f"{sys.argv[1]} needs the snapshot file")
    elif sys.argv[1] == "load":
        load(sys.argv[2])
    else:
        verify(sys.argv[2])
