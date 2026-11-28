#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
STATE_DIR="$ROOT_DIR/.app"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"

# Local URLs:
# Frontend: https://tenma.app
# Backend:  https://api.tenma.app
export PORTLESS_TLD=app

PORTLESS_STATE_DIR="${PORTLESS_STATE_DIR:-$HOME/.portless}"
export PORTLESS_STATE_DIR

PORTLESS_BIN=""
PROXY_PID_FILE="$PORTLESS_STATE_DIR/proxy.pid"

mkdir -p "$PID_DIR" "$LOG_DIR"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Error: '$1' is required but was not found in PATH." >&2
    exit 1
  }
}

check_projects() {
  [[ -d "$FRONTEND_DIR" ]] || {
    echo "Error: missing directory: $FRONTEND_DIR" >&2
    exit 1
  }

  [[ -d "$BACKEND_DIR" ]] || {
    echo "Error: missing directory: $BACKEND_DIR" >&2
    exit 1
  }
}

get_portless_proxy_pid() {
  local pid
  local command_line

  [[ -r "$PROXY_PID_FILE" ]] || return 1

  IFS= read -r pid < "$PROXY_PID_FILE" || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1

  command_line="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$command_line" == *portless* ]] || return 1

  printf '%s\n' "$pid"
}

group_is_running() {
  local pgid="$1"

  [[ "$pgid" =~ ^[0-9]+$ ]] &&
    kill -0 -- "-$pgid" 2>/dev/null
}

# Start Portless with HTTPS and the .app TLD.
start_portless_proxy_command() {
  sudo env \
    PATH="$PATH" \
    PORTLESS_STATE_DIR="$PORTLESS_STATE_DIR" \
    PORTLESS_TLD=app \
    "$PORTLESS_BIN" proxy start --https --tld app
}

# Stop the proxy regardless of which state directory started it.
# Output is captured to avoid duplicate "Proxy is not running." messages.
stop_portless_proxy_command() {
  local output=""
  local command_status=0

  require_command sudo

  # First try the root-managed default state directory.
  if output="$(sudo env \
    -u PORTLESS_STATE_DIR \
    PATH="$PATH" \
    PORTLESS_TLD=app \
    "$PORTLESS_BIN" proxy stop 2>&1)"; then
    command_status=0
  else
    command_status=$?
  fi

  if [[ "$output" == *"Proxy stopped."* ]]; then
    echo "Proxy stopped."
    return 0
  fi

  # Only continue when the root-managed proxy is not running.
  if [[ "$output" != *"Proxy is not running."* ]]; then
    if [[ -n "$output" ]]; then
      printf '%s\n' "$output" >&2
    fi
    return "$command_status"
  fi

  # Next try the configured user's Portless state directory.
  if output="$(sudo env \
    PATH="$PATH" \
    PORTLESS_STATE_DIR="$PORTLESS_STATE_DIR" \
    PORTLESS_TLD=app \
    "$PORTLESS_BIN" proxy stop 2>&1)"; then
    command_status=0
  else
    command_status=$?
  fi

  if [[ "$output" == *"Proxy stopped."* ]]; then
    echo "Proxy stopped."
    return 0
  fi

  if [[ "$output" == *"Proxy is not running."* ]]; then
    echo "Portless proxy is already stopped."
    return 0
  fi

  # Handle unexpected output or an actual command failure.
  if [[ -n "$output" ]]; then
    printf '%s\n' "$output" >&2
  fi

  return "$command_status"
}

start_portless_proxy() {
  local previous_pid=""
  local current_pid=""
  local output=""
  local status=0

  if previous_pid="$(get_portless_proxy_pid)"; then
    echo "Detected an existing Portless proxy (PID: $previous_pid)."
  else
    echo "No Portless proxy detected in the configured state directory."
  fi

  echo "Starting Portless proxy with HTTPS and TLD .app..."

  if output="$(start_portless_proxy_command 2>&1)"; then
    [[ -z "$output" ]] || printf '%s\n' "$output"
  else
    status=$?

    # Detect an existing proxy with a conflicting configuration.
    if [[ "$output" == *"different config"* ]] ||
       [[ "$output" == *"running proxy is using"* ]]; then

      printf '%s\n' "$output"
      echo
      echo "The existing Portless proxy has a different configuration."
      echo "Stopping it and restarting with TLD .app..."

      if ! stop_portless_proxy_command; then
        echo "Error: could not stop the existing Portless proxy." >&2
        return 1
      fi

      echo
      echo "Starting Portless proxy with HTTPS and TLD .app..."

      if output="$(start_portless_proxy_command 2>&1)"; then
        [[ -z "$output" ]] || printf '%s\n' "$output"
      else
        status=$?
        printf '%s\n' "$output" >&2
        echo "Error: could not restart Portless proxy." >&2
        return "$status"
      fi
    else
      printf '%s\n' "$output" >&2
      return "$status"
    fi
  fi

  if current_pid="$(get_portless_proxy_pid)"; then
    echo "Portless proxy is running (PID: $current_pid)."
  else
    echo "Portless started, but its PID could not be verified."
  fi
}

# Always stop the proxy, even if app.sh did not start it.
stop_portless_proxy() {
  echo "Stopping Portless proxy..."

  if stop_portless_proxy_command; then
    rm -f "$PROXY_PID_FILE"
  else
    echo "Error: failed to stop Portless proxy." >&2
    return 1
  fi
}

stop_one() {
  local name="$1"
  local pid_file="$PID_DIR/$name.pid"
  local pgid

  if [[ ! -f "$pid_file" ]]; then
    echo "$name: not running (no PID file)."
    return 0
  fi

  pgid="$(<"$pid_file")"

  if group_is_running "$pgid"; then
    echo "Stopping $name (process group $pgid)..."

    kill -TERM -- "-$pgid" 2>/dev/null || true

    for _ in {1..50}; do
      group_is_running "$pgid" || break
      sleep 0.1
    done

    if group_is_running "$pgid"; then
      echo "$name did not exit; sending SIGKILL..."
      kill -KILL -- "-$pgid" 2>/dev/null || true
    fi
  else
    echo "$name: process group is already stopped."
  fi

  rm -f "$pid_file"
}

stop_all() {
  local failed=0

  stop_one frontend || failed=1
  stop_one backend || failed=1
  stop_portless_proxy || failed=1

  echo

  if (( failed == 0 )); then
    echo "Tenma processes stopped."
  else
    echo "Some processes could not be stopped." >&2
  fi

  return "$failed"
}

start_one() {
  local service_name="$1"
  local project_dir="$2"
  local portless_name="$3"
  local pnpm_script="$4"

  local pid_file="$PID_DIR/$service_name.pid"
  local log_file="$LOG_DIR/$service_name.log"
  local pid

  if [[ -f "$pid_file" ]]; then
    pid="$(<"$pid_file")"

    if group_is_running "$pid"; then
      echo "Error: $service_name is already running (process group $pid)." >&2
      return 1
    fi

    rm -f "$pid_file"
  fi

  echo "Starting $service_name at https://$portless_name.app..."

  (
    cd "$project_dir"
    exec setsid "$PORTLESS_BIN" "$portless_name" pnpm run "$pnpm_script"
  ) >>"$log_file" 2>&1 </dev/null &

  pid=$!
  printf '%s\n' "$pid" > "$pid_file"

  sleep 1

  if ! group_is_running "$pid"; then
    rm -f "$pid_file"

    echo "Error: $service_name failed to start. Recent log output:" >&2
    tail -n 40 "$log_file" >&2 || true

    return 1
  fi
}

check_not_already_running() {
  local name
  local pid_file
  local pid

  for name in frontend backend; do
    pid_file="$PID_DIR/$name.pid"

    if [[ -f "$pid_file" ]]; then
      pid="$(<"$pid_file")"

      if group_is_running "$pid"; then
        echo "Error: $name is already running (process group $pid)." >&2
        echo "Run '$0 stop' first." >&2
        exit 1
      fi

      rm -f "$pid_file"
    fi
  done
}

build_projects() {
  echo
  echo "================================"
  echo " Building Tenma"
  echo "================================"

  echo
  echo "[1/2] Building frontend..."
  (
    cd "$FRONTEND_DIR"
    pnpm run build
  )

  echo
  echo "[2/2] Building backend..."
  (
    cd "$BACKEND_DIR"
    pnpm run build
  )

  echo
  echo "Both projects built successfully."
}

start_all() {
  local mode="$1"
  local frontend_script
  local backend_script

  check_projects

  require_command pnpm
  require_command portless
  require_command setsid
  require_command ps
  require_command sudo

  PORTLESS_BIN="$(command -v portless)"

  check_not_already_running

  case "$mode" in
    dev)
      frontend_script=dev
      backend_script=start:dev
      ;;

    prod)
      frontend_script=start
      backend_script=start:prod

      # Build both projects before starting either application.
      build_projects
      ;;

    *)
      echo "Usage: $0 start {dev|prod} | stop" >&2
      exit 2
      ;;
  esac

  start_portless_proxy

  if ! start_one frontend "$FRONTEND_DIR" tenma "$frontend_script"; then
    stop_all || true
    return 1
  fi

  if ! start_one backend "$BACKEND_DIR" api.tenma "$backend_script"; then
    stop_all || true
    return 1
  fi

  echo
  echo "================================"
  echo " Tenma is running ($mode)"
  echo "================================"
  echo
  echo "Frontend: https://tenma.app"
  echo "Backend:  https://api.tenma.app"
  echo
  echo "Logs:"
  echo "  Frontend: $LOG_DIR/frontend.log"
  echo "  Backend:  $LOG_DIR/backend.log"
  echo
  echo "Stop everything with: $0 stop"
}

case "${1:-}" in
  start)
    if [[ $# -ne 2 ]]; then
      echo "Usage: $0 start {dev|prod}" >&2
      exit 2
    fi

    start_all "$2"
    ;;

  stop)
    if [[ $# -ne 1 ]]; then
      echo "Usage: $0 stop" >&2
      exit 2
    fi

    require_command portless
    require_command sudo

    PORTLESS_BIN="$(command -v portless)"

    stop_all
    ;;

  *)
    echo "Usage:"
    echo "  $0 start dev"
    echo "  $0 start prod"
    echo "  $0 stop"
    exit 2
    ;;
esac
