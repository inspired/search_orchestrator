#!/usr/bin/env bash
# Milestone 1 test fixture: restricted users, roles, an index and saved searches.
# TEST-ONLY. Do not use for anything else. See docs/m1-procedure.md.
#
# Usage: scripts/m1_setup.sh --host <mgmt url> [--insecure] [--cleanup]
#   --host      Management URL, for example https://splunk.example.com:8089
#   --insecure  Allow a self-signed management port certificate
#   --cleanup   Remove everything this script created
#
# Safe to re-run. Passwords and session keys reach curl only through
# `--config -` on stdin, so they never appear in process listings, and they are
# neither stored nor printed.
set -euo pipefail

APP=search_orchestrator
USER1=so_m1_user
ROLE1=so_m1_role
USER2=so_m1_owner2
ROLE2=so_m1_owner2_role
INDEX=so_m1_secret
SHARED=_so_spike_shared
PRIVATE_SEARCHES="_so_spike_identity _so_spike_secret _so_spike_args _so_spike_now _so_spike_loadjob _so_spike_long _so_spike_wrapper"
HIDDEN="dispatchAs=owner is_scheduled=0 is_visible=0"

BASE_URL=""
INSECURE=0
CLEANUP=0
SESSION=""
HTTP_CODE=""
HTTP_BODY=""
RAW_BODY=""

die() { echo "ERROR: $*" >&2; exit 1; }

usage() { sed -n '5,8p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host) [ $# -ge 2 ] || usage; BASE_URL=${2%/}; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    --cleanup) CLEANUP=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$BASE_URL" ] || usage
case "$BASE_URL" in
  https://*) ;;
  http://*) echo "WARNING: $BASE_URL is not TLS; the admin password travels unencrypted." >&2 ;;
  *) die "--host must start with https:// or http://" ;;
esac
command -v curl >/dev/null || die "curl is required"

# Quote a value for a curl config file.
conf_quote() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

# api METHOD PATH [name=value ...]: sets HTTP_CODE and HTTP_BODY.
api() {
  local method=$1 path=$2 cfg out kv
  shift 2
  cfg="url = $(conf_quote "$BASE_URL$path")"$'\n'"request = $(conf_quote "$method")"$'\n'
  cfg+=$'silent\nshow-error\nmax-time = 120\n'
  if [ "$INSECURE" = 1 ]; then cfg+=$'insecure\n'; fi
  if [ -n "$SESSION" ]; then cfg+="header = $(conf_quote "Authorization: Splunk $SESSION")"$'\n'; fi
  if [ -n "$RAW_BODY" ]; then cfg+="data-binary = $(conf_quote "$RAW_BODY")"$'\n'; fi
  for kv in "$@"; do cfg+="data-urlencode = $(conf_quote "$kv")"$'\n'; done
  # printf is a shell builtin, so cfg is not visible in any process's arguments.
  if ! out=$(printf '%s' "$cfg" | curl --config - --write-out '\n%{http_code}'); then
    die "could not reach $BASE_URL (for a self-signed certificate, add --insecure)"
  fi
  HTTP_CODE=${out##*$'\n'}
  HTTP_BODY=${out%$'\n'*}
}

http_ok() { case "$HTTP_CODE" in 2*) return 0 ;; *) return 1 ;; esac; }

server_message() { printf '%s\n' "$HTTP_BODY" | sed -n 's/.*<msg[^>]*>\(.*\)<\/msg>.*/\1/p' | head -n 3; }

require_ok() {
  if ! http_ok; then die "$1: HTTP $HTTP_CODE $(server_message)"; fi
  echo "ok: $1"
}

# login USER PASSWORD: prints nothing; sets LOGIN_KEY. Never echoes the response.
login() {
  local key
  SESSION=""
  api POST /services/auth/login "username=$1" "password=$2"
  if ! http_ok; then
    HTTP_BODY=""
    die "login failed for $1 (HTTP $HTTP_CODE)"
  fi
  key=${HTTP_BODY#*<sessionKey>}
  key=${key%%</sessionKey>*}
  HTTP_BODY=""
  [ -n "$key" ] || die "login for $1 returned no session key"
  LOGIN_KEY=$key
}

prompt_admin() {
  local name
  printf 'Admin username [admin]: ' >&2
  IFS= read -r name || true
  ADMIN_USER=${name:-admin}
  printf 'Admin password: ' >&2
  IFS= read -rs ADMIN_PW || true
  echo >&2
  [ -n "$ADMIN_PW" ] || die "an admin password is required"
  login "$ADMIN_USER" "$ADMIN_PW"
  ADMIN_KEY=$LOGIN_KEY
  unset ADMIN_PW
  SESSION=$ADMIN_KEY
}

run_cleanup() {
  local failed=0 name
  remove() {
    api DELETE "$1"
    if http_ok; then echo "removed: $1"
    elif [ "$HTTP_CODE" = 404 ]; then echo "absent: $1"
    else echo "FAILED: $1: HTTP $HTTP_CODE $(server_message)" >&2; failed=1
    fi
  }
  for name in $PRIVATE_SEARCHES; do remove "/servicesNS/$USER1/$APP/saved/searches/$name"; done
  remove "/servicesNS/nobody/$APP/saved/searches/$SHARED"
  remove "/servicesNS/$USER2/$APP/saved/searches/$SHARED"
  remove "/services/authentication/users/$USER1"
  remove "/services/authentication/users/$USER2"
  remove "/services/authorization/roles/$ROLE1"
  remove "/services/authorization/roles/$ROLE2"
  remove "/services/data/indexes/$INDEX"
  [ "$failed" = 0 ] || die "cleanup incomplete; see FAILED lines above"
  echo "Cleanup finished. To remove the spike rows too, uninstall the app or use a later build."
}

# ensure_role ROLE ALLOWED_INDEX [extra capability ...]
ensure_role() {
  local role=$1 idx=$2 caps="capabilities=search capabilities=rest_properties_get" cap
  shift 2
  for cap in "$@"; do caps="$caps capabilities=$cap"; done
  SESSION=$ADMIN_KEY
  api GET "/services/authorization/roles/$role"
  if http_ok; then
    # shellcheck disable=SC2086
    api POST "/services/authorization/roles/$role" $caps "srchIndexesAllowed=$idx" "srchIndexesDefault=$idx" "imported_roles="
  else
    # shellcheck disable=SC2086
    api POST /services/authorization/roles "name=$role" $caps "srchIndexesAllowed=$idx" "srchIndexesDefault=$idx"
  fi
  require_ok "role $role (searches $idx only, imports nothing)"
}

# ensure_user USER ROLE
ensure_user() {
  SESSION=$ADMIN_KEY
  api GET "/services/authentication/users/$1"
  if http_ok; then
    api POST "/services/authentication/users/$1" "password=$TEST_PW" "roles=$2" "force-change-pass=0"
  else
    api POST /services/authentication/users "name=$1" "password=$TEST_PW" "roles=$2" "force-change-pass=0"
  fi
  require_ok "user $1"
}

secret_count() {
  SESSION=$ADMIN_KEY
  api POST /services/search/jobs exec_mode=oneshot output_mode=csv earliest_time=0 latest_time=now \
    "search=search index=$INDEX | stats count"
  require_ok "count events in $INDEX" >/dev/null
  SECRET_COUNT=$(printf '%s\n' "$HTTP_BODY" | grep -E '^"?[0-9]+"?$' | tail -n 1 | tr -dc '0-9' || true)
  SECRET_COUNT=${SECRET_COUNT:-0}
}

seed_index() {
  local i
  secret_count
  if [ "$SECRET_COUNT" -gt 0 ]; then
    echo "ok: $INDEX already holds $SECRET_COUNT event(s)"
    return
  fi
  RAW_BODY="so_m1_secret seed event: so_m1_user must never be able to read this"
  api POST "/services/receivers/simple?index=$INDEX&sourcetype=so_m1_seed&source=m1_setup"
  RAW_BODY=""
  require_ok "seed event sent to $INDEX"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    secret_count
    if [ "$SECRET_COUNT" -gt 0 ]; then
      echo "ok: seed event searchable"
      return
    fi
    sleep 3
  done
  die "seed event not searchable after 60s; the index-access check would prove nothing"
}

# save_as NAMESPACE NAME name=value ...: update if present, otherwise create.
# Uses the current SESSION, which decides who owns a new search.
save_as() {
  local ns=$1 name=$2
  shift 2
  api POST "/servicesNS/$ns/$APP/saved/searches/$name" "$@"
  if [ "$HTTP_CODE" = 404 ]; then
    api POST "/servicesNS/$ns/$APP/saved/searches" "name=$name" "$@"
  fi
}

# save_private NAME name=value ...: private search owned by so_m1_user, using
# that user's session. The role starts minimal. Its capability is added only if
# Splunk refuses the save, and the script says so.
save_private() {
  local name=$1
  shift
  SESSION=$USER1_KEY
  # shellcheck disable=SC2086
  save_as "$USER1" "$name" "$@" $HIDDEN
  if [ "$HTTP_CODE" = 403 ] && [ "$GRANTED" = 0 ]; then
    echo "note: saving was refused, adding edit_search_schedule_window to $ROLE1 and $ROLE2"
    GRANTED=1
    ensure_role "$ROLE1" main edit_search_schedule_window
    ensure_role "$ROLE2" "$INDEX" edit_search_schedule_window
    login "$USER1" "$TEST_PW"; USER1_KEY=$LOGIN_KEY
    login "$USER2" "$TEST_PW"; USER2_KEY=$LOGIN_KEY
    SESSION=$USER1_KEY
    # shellcheck disable=SC2086
    save_as "$USER1" "$name" "$@" $HIDDEN
  fi
  require_ok "search $name owned by $USER1"
}

save_shared() {
  local spl="search=search index=$INDEX | stats count"
  SESSION=$ADMIN_KEY
  api GET "/servicesNS/nobody/$APP/saved/searches/$SHARED"
  if http_ok; then
    # Already shared by an earlier run, so only an admin may write it. Keeps its owner.
    # shellcheck disable=SC2086
    api POST "/servicesNS/nobody/$APP/saved/searches/$SHARED" "$spl" dispatch.earliest_time=0 dispatch.latest_time=now $HIDDEN
  else
    SESSION=$USER2_KEY
    # shellcheck disable=SC2086
    save_as "$USER2" "$SHARED" "$spl" dispatch.earliest_time=0 dispatch.latest_time=now $HIDDEN
  fi
  require_ok "search $SHARED owned by $USER2"
  SESSION=$ADMIN_KEY
  api POST "/servicesNS/$USER2/$APP/saved/searches/$SHARED/acl" sharing=app "owner=$USER2" \
    "perms.read=$ROLE1,$ROLE2,admin" perms.write=admin
  require_ok "$SHARED shared in the app, dispatchAs=owner"
}

run_setup() {
  local generated=0
  command -v openssl >/dev/null || die "openssl is required"
  printf 'Password for the test users (blank to generate one): ' >&2
  IFS= read -rs TEST_PW || true
  echo >&2
  if [ -z "$TEST_PW" ]; then
    TEST_PW="So1!$(openssl rand -base64 24)"
    generated=1
  fi

  SESSION=$ADMIN_KEY
  api GET "/services/apps/local/$APP"
  if ! http_ok; then
    die "app $APP is not installed (HTTP $HTTP_CODE). Install it first; see docs/m1-procedure.md."
  fi

  api GET "/services/data/indexes/$INDEX"
  if http_ok; then
    echo "ok: index $INDEX exists"
  else
    api POST /services/data/indexes "name=$INDEX"
    require_ok "index $INDEX"
  fi

  GRANTED=0
  ensure_role "$ROLE1" main
  ensure_role "$ROLE2" "$INDEX"
  ensure_user "$USER1" "$ROLE1"
  ensure_user "$USER2" "$ROLE2"
  seed_index

  login "$USER1" "$TEST_PW"; USER1_KEY=$LOGIN_KEY
  login "$USER2" "$TEST_PW"; USER2_KEY=$LOGIN_KEY

  save_private _so_spike_identity \
    'search=| rest /services/authentication/current-context splunk_server=local | fields username roles'
  save_private _so_spike_secret "search=search index=$INDEX | stats count" \
    dispatch.earliest_time=0 dispatch.latest_time=now
  save_private _so_spike_args \
    'search=| makeresults | eval v="$args.v$", literal="foo$", other="$unknown$"'
  save_private _so_spike_now 'search=| makeresults | addinfo | table info_min_time' \
    dispatch.earliest_time=-1d@d
  save_private _so_spike_loadjob 'search=| loadjob $args.sid$ | stats count'
  # CPU-bound and bounded: the job-cancel check needs a job still running when
  # it cancels. dispatch.max_time stops it even if the cancel fails.
  save_private _so_spike_long \
    'search=| makeresults count=50000 | eval x=mvrange(0,100) | mvexpand x | eval h=sha512(tostring(random())) | eventstats dc(h) AS d | stats count' \
    dispatch.max_time=120
  save_shared
  save_private _so_spike_wrapper "search=| savedsearch $SHARED" dispatch.earliest_time=0

  if [ "$generated" = 1 ]; then
    echo "The generated test-user password was used and not kept. Re-running sets a new one."
  fi
  unset TEST_PW USER1_KEY USER2_KEY

  cat <<NEXT

Setup finished. What to do next:
  1. Restart Splunk on this server. The spike runs its checks once each time the engine starts.
  2. Wait about 5 minutes after the restart, then run this search as an admin:
       | inputlookup so_spike_results | table check ok detail sid at
     The sequence has finished when a row with check=done appears.
  3. Tell the builder the spike has run, so the results can be verified.
  4. When the milestone is closed, remove the test objects, while the app is still installed:
       scripts/m1_setup.sh --host $BASE_URL$( [ "$INSECURE" = 1 ] && printf ' --insecure' ) --cleanup
NEXT
}

prompt_admin
if [ "$CLEANUP" = 1 ]; then
  run_cleanup
else
  run_setup
fi
unset ADMIN_KEY SESSION
