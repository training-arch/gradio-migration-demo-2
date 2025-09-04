from __future__ import annotations
import os
from pathlib import Path
from fastapi.responses import FileResponse, Response


class Storage:
    def result_download_response(self, path: Path, download_name: str) -> Response:
        raise NotImplementedError


class LocalStorage(Storage):
    def result_download_response(self, path: Path, download_name: str) -> Response:
        return FileResponse(
            path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=download_name,
        )


def get_storage() -> Storage:
    backend = (os.getenv("STORAGE_BACKEND", "local").strip().lower())
    # only local for now; S3 can be added later with presigned URLs
    return LocalStorage()

