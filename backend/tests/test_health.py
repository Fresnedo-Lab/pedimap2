"""
/api/health identifies Pedimap's backend, and the backend runs on the port it
is given (PEDIMAP_PORT) even while another program holds 8765.
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

import api

BACKEND = os.path.join(os.path.dirname(__file__), "..", "api.py")


def test_health_identifies_pedimap_and_its_version():
    reply = api.health()
    assert reply["app"] == "pedimap2"
    assert reply["version"] == api.__version__ != "0.0.0"
    assert reply["status"] == "ok"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_backend_serves_on_another_port_while_8765_is_taken():
    # A dummy listener on 8765, like the other program seen on a user's Mac
    # (skipped binding if something already listens there: it is taken anyway).
    dummy = socket.socket()
    try:
        dummy.bind(("127.0.0.1", 8765))
        dummy.listen()
    except OSError:
        dummy.close()
        dummy = None
    port = _free_port()
    proc = subprocess.Popen([sys.executable, BACKEND], env={**os.environ, "PEDIMAP_PORT": str(port)},
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        deadline, reply = time.time() + 30, None
        while time.time() < deadline and reply is None:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as r:
                    reply = json.load(r)
            except OSError:
                assert proc.poll() is None, proc.stderr.read().decode()
                time.sleep(0.2)
        assert reply is not None, "backend did not answer"
        assert reply["app"] == "pedimap2" and reply["port"] == port
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        if dummy:
            dummy.close()
