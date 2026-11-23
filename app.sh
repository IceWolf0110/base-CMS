
#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# --------------------------------------------------
# Toolbx
# --------------------------------------------------

TOOLBOX_CONTAINER="node-env"

if [[ ! -f /run/.toolboxenv ]]; then
  if ! command -v toolbox >/dev/null 2>&1; then
    printf '[ERROR] toolbox is not installed.\n' >&2
    exit 1
  fi

  printf '[INFO] Entering Toolbx: %s\n' "$TOOLBOX_CONTAINER"

  exec toolbox run \
    --container "$TOOLBOX_CONTAINER" \
    "$ROOT_DIR/app.sh" "$@"
fi

# --------------------------------------------------
# Configuration
# --------------------------------------------------

FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

STATE_DIR="$ROOT_DIR/.app"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"

PORTLESS_TLD="app"
PORTLESS_STATE_DIR="${PORTLESS_STATE_DIR:-$HOME/.portless}"

PROXY_PID_FILE="$PORTLESS_STATE_DIR/proxy.pid"
PROXY_OWNED_FILE="$STATE_DIR/portless-proxy.pid"

FRONTEND_URL="https://tenma.app"
BACKEND_URL="https://api.tenma.app"

PORTLESS_BIN=""

APP_PIDS=()
APP_NAMES=()
TAIL_PID=""

export PORTLESS_TLD
export PORTLESS_STATE_DIR

# --------------------------------------------------
# Helpers
# --------------------------------------------------

info() {
  printf '\033[1;34m[INFO]\033[0m %s\n' "$1"
}

success() {
  printf '\033[1;32m[ OK ]\033[0m %s\n' "$1"
}

error() {
  printf '\033[1;31m[ERROR]\033[0m %s\n' "$1" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Required command not found: $1"
    exit 1
  fi
}

ensure_node_command() {
  if command -v node >/dev/null 2>&1; then
    return
  fi

  local node_bin

  node_bin="$(command -v node-26 || true)"

  if [[ -n "$node_bin" ]]; then
    mkdir -p "$HOME/.local/bin"

    ln -sfn "$node_bin" "$HOME/.local/bin/node"

    export PATH="$HOME/.local/bin:$PATH"

    info "Created node symlink: $node_bin"
    return
  fi

  error "Node.js is not installed."
  exit 1
}

check_environment() {
  ensure_node_command

  require_command node
  require_command pnpm
  require_command tail

  PORTLESS_BIN="$(command -v portless || true)"

  if [[ -z "$PORTLESS_BIN" ]]; then
    error "Portless is not installed."
    exit 1
  fi
}

check_projects() {
  for dir in "$FRONTEND_DIR" "$BACKEND_DIR"; do
    if [[ ! -f "$dir/package.json" ]]; then
      error "Missing package.json: $dir"
      exit 1
    fi
  done
}

create_directories() {
  mkdir -p "$PID_DIR" "$LOG_DIR" "$PORTLESS_STATE_DIR"

  touch "$LOG_DIR/frontend.log"
  touch "$LOG_DIR/backend.log"
}

# --------------------------------------------------
# Environment setup
# --------------------------------------------------

setup_env() {
  info "Setting up environment inside node-env..."

  check_environment
  check_projects
  create_directories

  info "Installing frontend dependencies..."

  (
    cd "$FRONTEND_DIR"
    pnpm install
  )

  info "Installing backend dependencies..."

  (
    cd "$BACKEND_DIR"
    pnpm install
  )

  info "Trusting Portless HTTPS certificate..."

  "$PORTLESS_BIN" trust

  success "Environment setup completed."
}

# --------------------------------------------------
# Portless
# --------------------------------------------------

start_portless_proxy() {
  local existing_pid=""

  if [[ -f "$PROXY_PID_FILE" ]]; then
    existing_pid="$(<"$PROXY_PID_FILE")"

    if [[ "$existing_pid" =~ ^[0-9]+$ ]] &&
       kill -0 "$existing_pid" 2>/dev/null; then

      info "Restarting existing Portless proxy..."

      "$PORTLESS_BIN" proxy stop >/dev/null 2>&1 || true

      for _ in {1..30}; do
        if ! kill -0 "$existing_pid" 2>/dev/null; then
          break
        fi

        sleep 0.1
      done
    fi
  fi

  info "Starting Portless proxy with .$PORTLESS_TLD..."

  "$PORTLESS_BIN" proxy start --https --tld "$PORTLESS_TLD"

  local new_pid=""

  for _ in {1..30}; do
    if [[ -f "$PROXY_PID_FILE" ]]; then
      new_pid="$(<"$PROXY_PID_FILE")"

      if [[ "$new_pid" =~ ^[0-9]+$ ]] &&
         kill -0 "$new_pid" 2>/dev/null; then

        printf '%s\n' "$new_pid" > "$PROXY_OWNED_FILE"

        success "Portless proxy started."
        return 0
      fi
    fi

    sleep 0.1
  done

  error "Could not verify Portless proxy startup."
  return 1
}

stop_owned_proxy() {
  [[ -f "$PROXY_OWNED_FILE" ]] || return 0

  local owned_pid
  local current_pid=""

  owned_pid="$(<"$PROXY_OWNED_FILE")"

  if [[ -f "$PROXY_PID_FILE" ]]; then
    current_pid="$(<"$PROXY_PID_FILE")"
  fi

  if [[ "$owned_pid" == "$current_pid" ]] &&
     [[ "$owned_pid" =~ ^[0-9]+$ ]] &&
     kill -0 "$owned_pid" 2>/dev/null; then

    info "Stopping Portless proxy..."

    "$PORTLESS_BIN" proxy stop >/dev/null 2>&1 || true
  fi

  rm -f "$PROXY_OWNED_FILE"
}

# --------------------------------------------------
# Applications
# --------------------------------------------------

build_projects() {
  info "Building frontend..."

  (
    cd "$FRONTEND_DIR"
    pnpm run build
  )

  success "Frontend build completed."

  info "Building backend..."

  (
    cd "$BACKEND_DIR"
    pnpm run build
  )

  success "Backend build completed."
}

start_service() {
  local label="$1"
  local app_name="$2"
  local app_dir="$3"
  local script="$4"
  local log_file="$5"

  info "Starting $label..."

  (
    cd "$app_dir"

    exec "$PORTLESS_BIN" "$app_name" pnpm run "$script"
  ) >> "$log_file" 2>&1 &

  local pid=$!

  APP_PIDS+=("$pid")
  APP_NAMES+=("$label")

  printf '%s\n' "$pid" > "$PID_DIR/$label.pid"

  success "$label started (PID: $pid)."
}

start_applications() {
  local mode="$1"

  local frontend_script
  local backend_script

  case "$mode" in
    dev)
      frontend_script="dev"
      backend_script="start:dev"
      ;;
    prod)
      frontend_script="start"
      backend_script="start:prod"
      ;;
    *)
      error "Unknown mode: $mode"
      exit 1
      ;;
  esac

  check_environment
  check_projects
  create_directories

  if [[ "$mode" == "prod" ]]; then
    build_projects
  fi

  start_portless_proxy

  tail -n 0 -F \
    "$LOG_DIR/frontend.log" \
    "$LOG_DIR/backend.log" &

  TAIL_PID=$!

  start_service \
    "frontend" \
    "tenma" \
    "$FRONTEND_DIR" \
    "$frontend_script" \
    "$LOG_DIR/frontend.log"

  start_service \
    "backend" \
    "api.tenma" \
    "$BACKEND_DIR" \
    "$backend_script" \
    "$LOG_DIR/backend.log"

  printf '\n'

  success "Tenma is running in $mode mode."

  printf '\n'
  printf 'Frontend: %s\n' "$FRONTEND_URL"
  printf 'Backend:  %s\n' "$BACKEND_URL"

  printf '\n'

  info "Press any key to stop all applications..."

  monitor_applications
}

# --------------------------------------------------
# Cleanup
# --------------------------------------------------

stop_tail() {
  if [[ -n "$TAIL_PID" ]]; then
    kill "$TAIL_PID" 2>/dev/null || true
    wait "$TAIL_PID" 2>/dev/null || true

    TAIL_PID=""
  fi
}

stop_applications() {
  local pid
  local any_alive

  if [[ ${#APP_PIDS[@]} -eq 0 ]]; then
    return
  fi

  info "Stopping applications..."

  for pid in "${APP_PIDS[@]}"; do
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      kill -INT "$pid" 2>/dev/null || true
    fi
  done

  for ((attempt = 0; attempt < 50; attempt++)); do
    any_alive=0

    for pid in "${APP_PIDS[@]}"; do
      if [[ "$pid" =~ ^[0-9]+$ ]] &&
         kill -0 "$pid" 2>/dev/null; then
        any_alive=1
      fi
    done

    if (( any_alive == 0 )); then
      break
    fi

    sleep 0.1
  done

  for pid in "${APP_PIDS[@]}"; do
    if [[ "$pid" =~ ^[0-9]+$ ]] &&
       kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done

  sleep 1

  for pid in "${APP_PIDS[@]}"; do
    if [[ "$pid" =~ ^[0-9]+$ ]] &&
       kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi

    wait "$pid" 2>/dev/null || true
  done

  APP_PIDS=()
  APP_NAMES=()

  rm -f "$PID_DIR"/*.pid
}

cleanup() {
  local status=$?

  trap - EXIT INT TERM

  stop_tail
  stop_applications
  stop_owned_proxy

  exit "$status"
}

# --------------------------------------------------
# Monitor
# --------------------------------------------------

monitor_applications() {
  local index
  local pid
  local status

  while true; do
    if IFS= read -r -s -n 1 -t 0.2 _; then
      printf '\n'
      info "Stop requested."
      return 0
    fi

    for index in "${!APP_PIDS[@]}"; do
      pid="${APP_PIDS[$index]}"

      [[ -n "$pid" ]] || continue

      if ! kill -0 "$pid" 2>/dev/null; then
        if wait "$pid"; then
          status=0
          info "${APP_NAMES[$index]} exited."
        else
          status=$?
          error "${APP_NAMES[$index]} exited with status $status."
        fi

        APP_PIDS[$index]=""

        return "$status"
      fi
    done
  done
}

# --------------------------------------------------
# Main
# --------------------------------------------------

usage() {
  cat <<EOF
Usage:

  ./app.sh start dev
  ./app.sh start prod
  ./app.sh set up env

Press any key while running to stop all applications.
EOF
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case "${1:-}" in
  start)
    if [[ "$#" -ne 2 ]]; then
      usage
      exit 1
    fi

    if [[ ! -t 0 ]]; then
      error "Start this script from an interactive terminal."
      exit 1
    fi

    case "$2" in
      dev|prod)
        start_applications "$2"
        ;;
      *)
        error "Unknown mode: $2"
        usage
        exit 1
        ;;
    esac
    ;;

  set)
    if [[ "${2:-}" == "up" && "${3:-}" == "env" && "$#" -eq 3 ]]; then
      setup_env
    else
      usage
      exit 1
    fi
    ;;

  *)
    usage
    exit 1
    ;;
esac
