import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"


def _resolve_executable(env_key: str, default: str) -> str:
    override = os.getenv(env_key)
    if override:
        candidate = Path(override)
        if candidate.exists():
            return str(candidate)
        resolved = shutil.which(override)
        if resolved:
            return resolved
        raise FileNotFoundError(f"Unable to locate executable from {env_key}={override}")
    resolved_default = shutil.which(default)
    if not resolved_default:
        raise FileNotFoundError(
            f"Command '{default}' was not found. Install it or set {env_key} to its path."
        )
    return resolved_default


def build_backend_cmd() -> list[str]:
    python_exe = sys.executable
    return [
        python_exe,
        "-m",
        "uvicorn",
        "backend.main:app",
        "--host",
        "0.0.0.0",
        "--port",
        os.getenv("BACKEND_PORT", "8000"),
        "--reload",
    ]


def build_frontend_cmd() -> list[str]:
    npm_executable = _resolve_executable("NPM_BIN", "npm")
    return [
        npm_executable,
        "run",
        "dev",
        "--",
        "--host",
        "0.0.0.0",
        "--port",
        os.getenv("FRONTEND_PORT", "5173"),
    ]


def terminate(processes: list[subprocess.Popen]) -> None:
    for process in processes:
        if process.poll() is not None:
            continue
        try:
            if os.name == "nt":
                process.terminate()
            else:
                process.send_signal(signal.SIGINT)
        except Exception:
            continue
    for process in processes:
        try:
            process.wait(timeout=5)
        except Exception:
            continue


def main() -> None:
    processes: list[subprocess.Popen] = []

    try:
        backend_cmd = build_backend_cmd()
        frontend_cmd = build_frontend_cmd()
    except FileNotFoundError as exc:
        print(f"[dev] {exc}")
        sys.exit(1)

    env = os.environ.copy()
    env.setdefault("FORCE_COLOR", "1")

    backend = subprocess.Popen(backend_cmd, cwd=ROOT, env=env)
    processes.append(backend)

    frontend = subprocess.Popen(frontend_cmd, cwd=FRONTEND_DIR, env=env)
    processes.append(frontend)

    def handle_signal(signum, frame):  # noqa: ANN001
        terminate(processes)
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        while True:
            for process in processes:
                ret = process.poll()
                if ret is not None:
                    terminate(processes)
                    if process is backend:
                        sys.exit(ret)
                    sys.exit(ret if ret is not None else 0)
            time.sleep(0.5)
    except KeyboardInterrupt:
        terminate(processes)


if __name__ == "__main__":
    main()
