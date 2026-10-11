"""Bounded, no-effect adapter to the pinned published Python validators.

Only imports the reviewed standalone source and calls pure validation/projection
helpers. It never invokes main, a ledger, a native CLI, a collector or a network.
Inputs are JSON data on stdin; neither inputs nor generated code are executed.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

EXPECTED = {
    "session_peer.py": "d36d83f3d6f59eb20c958aac530ca6d5d988a99f6ceabf2704c7c51db1fe524f",
    "session_peer_core/handoff.py": "138115b9cc8ee73c77ad1099625f2b6cc2e0a6bd343e864a6b5219328735a808",
}


def main():
    root = Path(sys.argv[1])
    for relative, digest in EXPECTED.items():
        if hashlib.sha256((root / relative).read_bytes()).hexdigest() != digest:
            raise ValueError("pinned_python_source_mismatch")
    raw = sys.stdin.buffer.read(1048577)
    if len(raw) > 1048576:
        raise ValueError("fixture_input_too_large")
    cases = json.loads(raw.decode("utf-8", errors="strict"))
    if type(cases) is not list or len(cases) > 256:
        raise ValueError("fixture_case_limit")
    spec = importlib.util.spec_from_file_location("pinned_handoff_reference", root / "session_peer.py")
    if spec is None or spec.loader is None:
        raise ValueError("pinned_python_import_unavailable")
    peer = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = peer
    spec.loader.exec_module(peer)
    if peer.__version__ != "1.1.0":
        raise ValueError("pinned_python_version_mismatch")
    results = []
    for case in cases:
        if type(case) is not dict or set(case) not in ({"kind", "value"}, {"kind", "value", "record"}):
            raise ValueError("fixture_case_shape")
        try:
            kind = case["kind"]
            if kind == "public":
                value = peer.handoff_validate_public(case["value"])
            elif kind == "native":
                peer.handoff_validate_native(case["value"], case["record"])
                value = case["value"]
            elif kind == "projection":
                value = peer.handoff_public(case["value"], case["record"])
            else:
                raise ValueError("fixture_case_kind")
            results.append({"valid": True, "value": value})
        except peer.CcPeerError as error:
            results.append({"valid": False, "reason": error.details.get("reason")})
    json.dump({"version": peer.__version__, "sourceHashes": EXPECTED, "results": results}, sys.stdout, ensure_ascii=True, allow_nan=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
