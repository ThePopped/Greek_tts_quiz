import subprocess
from collections.abc import Callable

import pytest

MakeMp3 = Callable[[str, float], bytes]


@pytest.fixture(scope="session")
def make_mp3() -> MakeMp3:
    """Build a synthetic MP3 from an ffmpeg ``aevalsrc`` expression in ``t``."""

    def build(expr: str, seconds: float) -> bytes:
        return subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", f"aevalsrc='{expr}':d={seconds}:s=24000",
                "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1",
            ],
            capture_output=True,
            check=True,
        ).stdout

    return build
