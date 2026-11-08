#!/usr/bin/env bash
# Milestone 1 test fixture: restricted users, roles, an index and saved searches.
# TEST-ONLY. Do not use for anything else. See docs/m1-procedure.md.
#
# Usage: scripts/m1_setup.sh --host <mgmt url> [--insecure] [--allow-http] [--cleanup]
#   --host        Management URL, for example https://splunk.example.com:8089
#   --insecure    Allow a self-signed management port certificate
#   --allow-http  Allow a plain http:// host, which sends passwords unencrypted
#   --cleanup     Remove everything this script created
#
# Everything created carries evidence of this script. Setup refuses to reuse a
# user, role or index without that evidence, and cleanup skips it with a warning.
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
# Evidence that this script created an object. Users carry it as realname,
# searches as description, and the index as a word in its seed event. Roles have
# no free-text field, so they carry an inert quota: these roles can't run
# real-time searches at all.
MARKER=so_m1_setup_fixture
ROLE_MARKER_VALUE=1371
ROLE_MARKER="name=\"rtSrchJobsQuota\">$ROLE_MARKER_VALUE<"
# Sent with the restricted user's session. New searches are unscheduled by default,
# and scheduling, alert and action arguments are refused without schedule_search,
# so none are sent. dispatchAs is only meaningful once shared, and defaults to
# owner, so an admin sets it on the shared search alone.
HIDDEN="is_visible=0 description=$MARKER"

BASE_URL=""
INSECURE=0
ALLOW_HTTP=0
CLEANUP=0
SESSION=""
HTTP_CODE=""
HTTP_BODY=""
RAW_BODY=""

die() { echo "ERROR: $*" >&2; exit 1; }

usage() { sed -n '5,9p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host) [ $# -ge 2 ] || usage; BASE_URL=${2%/}; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    --allow-http) ALLOW_HTTP=1; shift ;;
    --cleanup) CLEANUP=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$BASE_URL" ] || usage
case "$BASE_URL" in
  https://*) ;;
  http://*)
    [ "$ALLOW_HTTP" = 1 ] || die "$BASE_URL would send passwords unencrypted. Use https://, or pass --allow-http to accept that."
    echo "WARNING: $BASE_URL is not TLS; passwords travel unencrypted." >&2
    ;;
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

# secret_count: sets SECRET_COUNT to the number of marker events in the index.
# A search that fails counts as no evidence.
secret_count() {
  SESSION=$ADMIN_KEY
  api POST /services/search/jobs exec_mode=oneshot output_mode=csv earliest_time=0 latest_time=now \
    "search=search index=$INDEX source=m1_setup sourcetype=so_m1_seed $MARKER | stats count"
  SECRET_COUNT=0
  if http_ok; then
    SECRET_COUNT=$(printf '%s\n' "$HTTP_BODY" | grep -E '^"?[0-9]+"?$' | tail -n 1 | tr -dc '0-9' || true)
    SECRET_COUNT=${SECRET_COUNT:-0}
  fi
}

# object_state PATH MARKER_TEXT: sets STATE to absent, marked, foreign or error.
object_state() {
  SESSION=$ADMIN_KEY
  api GET "$1"
  case "$HTTP_CODE" in
    404) STATE=absent ;;
    2*) case "$HTTP_BODY" in *"$2"*) STATE=marked ;; *) STATE=foreign ;; esac ;;
    *) STATE=error ;;
  esac
}

user_state() { object_state "/services/authentication/users/$1" "$MARKER"; }
role_state() { object_state "/services/authorization/roles/$1" "$ROLE_MARKER"; }

index_state() {
  object_state "/services/data/indexes/$INDEX" ""
  if [ "$STATE" = foreign ] || [ "$STATE" = marked ]; then
    secret_count
    if [ "$SECRET_COUNT" -gt 0 ]; then STATE=marked; else STATE=foreign; fi
  fi
}

# Runs before setup changes anything, so a refusal leaves the server untouched.
refuse_foreign_objects() {
  local refused="" name
  note_state() {
    case "$STATE" in
      foreign) refused="$refused  $1 exists without this script's evidence"$'\n' ;;
      error) die "could not inspect $1: HTTP $HTTP_CODE $(server_message)" ;;
    esac
  }
  for name in "$USER1" "$USER2"; do user_state "$name"; note_state "user $name"; done
  for name in "$ROLE1" "$ROLE2"; do role_state "$name"; note_state "role $name"; done
  index_state; note_state "index $INDEX"
  if [ -n "$refused" ]; then
    printf 'Refusing to reuse objects this script cannot show it created:\n%s' "$refused" >&2
    die "nothing was changed. Rename or remove them first, if they really are disposable. An index left empty by an interrupted run also shows up here."
  fi
}

warn_unless_marked() {
  if [ "$STATE" != marked ]; then
    echo "WARNING: $1 was saved but its evidence can't be read back; a re-run will refuse it and --cleanup will skip it." >&2
  fi
}

run_cleanup() {
  local failed=0 skipped=0 name
  act_on_state() {
    case "$STATE" in
      absent) echo "absent: $1" ;;
      foreign) echo "WARNING: skipped $1: no evidence this script created it" >&2; skipped=1 ;;
      error) echo "FAILED: $1: HTTP $HTTP_CODE $(server_message)" >&2; failed=1 ;;
      marked)
        api DELETE "$1"
        if http_ok; then echo "removed: $1"
        elif [ "$HTTP_CODE" = 404 ]; then echo "absent: $1"
        else echo "FAILED: $1: HTTP $HTTP_CODE $(server_message)" >&2; failed=1
        fi
        ;;
    esac
  }
  remove_search() { object_state "$1" "$MARKER"; act_on_state "$1"; }
  for name in $PRIVATE_SEARCHES; do remove_search "/servicesNS/$USER1/$APP/saved/searches/$name"; done
  remove_search "/servicesNS/nobody/$APP/saved/searches/$SHARED"
  remove_search "/servicesNS/$USER2/$APP/saved/searches/$SHARED"
  for name in "$USER1" "$USER2"; do user_state "$name"; act_on_state "/services/authentication/users/$name"; done
  for name in "$ROLE1" "$ROLE2"; do role_state "$name"; act_on_state "/services/authorization/roles/$name"; done
  index_state; act_on_state "/services/data/indexes/$INDEX"
  [ "$failed" = 0 ] || die "cleanup incomplete; see FAILED lines above"
  if [ "$skipped" = 1 ]; then
    echo "Cleanup finished, but skipped the objects warned about above. Check them by hand."
  else
    echo "Cleanup finished. To remove the spike rows too, uninstall the app or use a later build."
  fi
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
    api POST "/services/authorization/roles/$role" $caps "srchIndexesAllowed=$idx" "srchIndexesDefault=$idx" "rtSrchJobsQuota=$ROLE_MARKER_VALUE" "imported_roles="
  else
    # shellcheck disable=SC2086
    api POST /services/authorization/roles "name=$role" $caps "srchIndexesAllowed=$idx" "srchIndexesDefault=$idx" "rtSrchJobsQuota=$ROLE_MARKER_VALUE"
  fi
  require_ok "role $role (searches $idx only, imports nothing)"
  role_state "$role"
  warn_unless_marked "role $role"
}

# ensure_user USER ROLE
ensure_user() {
  SESSION=$ADMIN_KEY
  api GET "/services/authentication/users/$1"
  if http_ok; then
    api POST "/services/authentication/users/$1" "password=$TEST_PW" "roles=$2" "force-change-pass=0" "realname=$MARKER"
  else
    api POST /services/authentication/users "name=$1" "password=$TEST_PW" "roles=$2" "force-change-pass=0" "realname=$MARKER"
  fi
  require_ok "user $1"
  user_state "$1"
  warn_unless_marked "user $1"
}

seed_index() {
  local i
  secret_count
  if [ "$SECRET_COUNT" -gt 0 ]; then
    echo "ok: $INDEX already holds $SECRET_COUNT event(s)"
    return
  fi
  RAW_BODY="$MARKER seed event: so_m1_user must never be able to read this"
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

# The argument Splunk says it refused, if that's what the last response was.
rejected_argument() {
  printf '%s\n' "$HTTP_BODY" | sed -n -E 's/.*Argument (&quot;|")([^"&]*)(&quot;|") is not supported by this handler.*/\2/p' | head -n 1
}

# Add a capability to both test roles, then log in again to pick it up.
grant_capability() {
  EXTRA_CAPS="$EXTRA_CAPS $1"
  # shellcheck disable=SC2086
  ensure_role "$ROLE1" main $EXTRA_CAPS
  # shellcheck disable=SC2086
  ensure_role "$ROLE2" "$INDEX" $EXTRA_CAPS
  login "$USER1" "$TEST_PW"; USER1_KEY=$LOGIN_KEY
  login "$USER2" "$TEST_PW"; USER2_KEY=$LOGIN_KEY
}

has_capability() { case " $EXTRA_CAPS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# save_search USER NAME required_name=value ...: saves with USER's session, so
# that USER owns a new search. Starts with minimal capabilities. If Splunk
# refuses, it says so and adds the least it can. A refused argument from HIDDEN
# gets schedule_search once, then is dropped and set afterwards by an admin,
# which keeps the owner, so description stays available as evidence. Neither
# capability gives index access. Any other refusal is recorded against this
# search, and the remaining searches still run.
save_search() {
  local user=$1 name=$2 opts=$HIDDEN dropped="" rejected opt kept
  shift 2
  while :; do
    if [ "$user" = "$USER1" ]; then SESSION=$USER1_KEY; else SESSION=$USER2_KEY; fi
    # shellcheck disable=SC2086
    save_as "$user" "$name" "$@" $opts
    if http_ok; then break; fi
    if [ "$HTTP_CODE" = 403 ] && ! has_capability edit_search_schedule_window; then
      echo "note: saving $name was refused, adding edit_search_schedule_window to $ROLE1 and $ROLE2"
      grant_capability edit_search_schedule_window
      continue
    fi
    rejected=$(rejected_argument)
    case " $opts " in
      *" $rejected="*)
        if [ -n "$rejected" ]; then
          if ! has_capability schedule_search; then
            echo "note: $user was refused argument $rejected on $name, adding schedule_search to $ROLE1 and $ROLE2"
            grant_capability schedule_search
            continue
          fi
          echo "note: $user is still refused argument $rejected on $name, dropping it and setting it as admin"
          kept=""
          for opt in $opts; do
            case "$opt" in
              "$rejected="*) dropped="$dropped $opt" ;;
              *) kept="$kept $opt" ;;
            esac
          done
          opts=$kept
          continue
        fi
        ;;
    esac
    echo "FAILED: search $name as $user: HTTP $HTTP_CODE $(server_message)" >&2
    SAVE_FAILURES="$SAVE_FAILURES $name"
    return 0
  done
  echo "ok: search $name owned by $user"
  if [ -n "$dropped" ]; then
    SESSION=$ADMIN_KEY
    # shellcheck disable=SC2086
    api POST "/servicesNS/$user/$APP/saved/searches/$name" $dropped
    if http_ok; then
      echo "ok: set$dropped on $name as admin"
    else
      echo "WARNING: could not set$dropped on $name as admin: HTTP $HTTP_CODE $(server_message). Without description, --cleanup skips this search." >&2
    fi
  fi
}

save_shared() {
  local spl="search=search index=$INDEX | stats count"
  SESSION=$ADMIN_KEY
  api GET "/servicesNS/nobody/$APP/saved/searches/$SHARED"
  if http_ok; then
    # Already shared by an earlier run, so only an admin may write it. Keeps its owner.
    api POST "/servicesNS/nobody/$APP/saved/searches/$SHARED" "$spl" dispatch.earliest_time=0 dispatch.latest_time=now
    if ! http_ok; then
      echo "FAILED: search $SHARED as admin: HTTP $HTTP_CODE $(server_message)" >&2
      SAVE_FAILURES="$SAVE_FAILURES $SHARED"
      return 0
    fi
    echo "ok: search $SHARED updated, still owned by $USER2"
  else
    local before=$SAVE_FAILURES
    save_search "$USER2" "$SHARED" "$spl" dispatch.earliest_time=0 dispatch.latest_time=now
    if [ "$SAVE_FAILURES" != "$before" ]; then return 0; fi
  fi
  SESSION=$ADMIN_KEY
  api POST "/servicesNS/$USER2/$APP/saved/searches/$SHARED/acl" sharing=app "owner=$USER2" \
    "perms.read=$ROLE1,$ROLE2,admin" perms.write=admin
  require_ok "$SHARED shared in the app"
  # shellcheck disable=SC2086
  api POST "/servicesNS/nobody/$APP/saved/searches/$SHARED" dispatchAs=owner $HIDDEN
  require_ok "$SHARED set to dispatchAs=owner as admin"
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

  refuse_foreign_objects

  SESSION=$ADMIN_KEY
  api GET "/services/data/indexes/$INDEX"
  if http_ok; then
    echo "ok: index $INDEX exists, created by an earlier run"
  else
    api POST /services/data/indexes "name=$INDEX"
    require_ok "index $INDEX"
  fi
  # Straight after creating the index, as its seed event is its evidence.
  seed_index

  EXTRA_CAPS=""
  SAVE_FAILURES=""
  ensure_role "$ROLE1" main
  ensure_role "$ROLE2" "$INDEX"
  ensure_user "$USER1" "$ROLE1"
  ensure_user "$USER2" "$ROLE2"

  login "$USER1" "$TEST_PW"; USER1_KEY=$LOGIN_KEY
  login "$USER2" "$TEST_PW"; USER2_KEY=$LOGIN_KEY

  save_search "$USER1" _so_spike_identity \
    'search=| rest /services/authentication/current-context splunk_server=local | fields username roles'
  save_search "$USER1" _so_spike_secret "search=search index=$INDEX | stats count" \
    dispatch.earliest_time=0 dispatch.latest_time=now
  save_search "$USER1" _so_spike_args \
    'search=| makeresults | eval v="$args.v$", literal="foo$", other="$unknown$"'
  save_search "$USER1" _so_spike_now 'search=| makeresults | addinfo | table info_min_time' \
    dispatch.earliest_time=-1d@d
  save_search "$USER1" _so_spike_loadjob 'search=| loadjob $args.sid$ | stats count'
  # CPU-bound and bounded: the job-cancel check needs a job still running when
  # it cancels. dispatch.max_time stops it even if the cancel fails.
  save_search "$USER1" _so_spike_long \
    'search=| makeresults count=50000 | eval x=mvrange(0,100) | mvexpand x | eval h=sha512(tostring(random())) | eventstats dc(h) AS d | stats count' \
    dispatch.max_time=120
  save_shared
  save_search "$USER1" _so_spike_wrapper "search=| savedsearch $SHARED" dispatch.earliest_time=0

  if [ -n "$SAVE_FAILURES" ]; then
    die "these searches were not saved:$SAVE_FAILURES. See the FAILED lines above. It's safe to re-run once fixed."
  fi

  if [ "$generated" = 1 ]; then
    echo "The generated test-user password was used and not kept. Re-running sets a new one."
  fi
  unset TEST_PW USER1_KEY USER2_KEY

  cat <<NEXT

Setup finished. The restricted test users $USER1 and $USER2 exist now, for
permission checks in the app. Log in as them with the password you entered; a
generated password was not kept, so re-run with a chosen one to log in.
(The Milestone 1 spike and its so_spike_results lookup were removed from the
app; there is nothing to restart for or wait on.)
When you are done, remove the test objects, while the app is still installed:
       scripts/m1_setup.sh --host $BASE_URL$( [ "$INSECURE" = 1 ] && printf ' --insecure' )$( [ "$ALLOW_HTTP" = 1 ] && printf ' --allow-http' ) --cleanup
NEXT
}

prompt_admin
if [ "$CLEANUP" = 1 ]; then
  run_cleanup
else
  run_setup
fi
unset ADMIN_KEY SESSION
