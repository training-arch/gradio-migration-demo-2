from __future__ import annotations
import os
from pathlib import Path
from fastapi.responses import FileResponse, Response
import os
import json


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
    if backend == "s3":
        return S3Storage()
    return LocalStorage()


class S3Storage(Storage):
    """
    Placeholder S3 storage that will return pre-signed URLs in the future.
    For now, it returns a 501 response with guidance when selected via STORAGE_BACKEND=s3.
    """

    def __init__(self) -> None:
        self.bucket = os.getenv("S3_BUCKET")
        self.region = os.getenv("S3_REGION")
        self._err = (
            "S3Storage selected but not yet implemented. Configure presigned URL generation "
            "(set S3_BUCKET/S3_REGION and add boto3 logic), or use STORAGE_BACKEND=local."
        )

    def result_download_response(self, path: Path, download_name: str) -> Response:
        payload = {
            "error": "S3 presigned URLs not implemented",
            "detail": self._err,
            "download_name": download_name,
            "source_path": str(path),
        }
        return Response(
            content=json.dumps(payload),
            media_type="application/json",
            status_code=501,
        )
