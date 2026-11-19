import asyncio
import json
import os
import secrets
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from faster_whisper import WhisperModel
from pydantic import BaseModel, Field

app = FastAPI(title='VoxScribe ASR Service', version='1.0.0')
security = HTTPBearer(auto_error=False)

MAX_FILE_BYTES = int(os.getenv('MAX_FILE_BYTES', str(200 * 1024 * 1024)))
MODELS_DIR = Path(os.getenv('MODELS_DIR', './models')).resolve()
MODELS_DIR.mkdir(parents=True, exist_ok=True)
DEVICE = os.getenv('WHISPER_DEVICE', 'auto')
COMPUTE_TYPE = os.getenv('WHISPER_COMPUTE_TYPE', 'auto')

JOBS: dict[str, dict] = {}
BACKGROUND_TASKS: set[asyncio.Task] = set()
MODEL_CACHE: dict[str, WhisperModel] = {}
MODEL_LOCK = threading.Lock()


class CreateTranscriptionRequest(BaseModel):
    sourceUrl: str = Field(min_length=8, max_length=8192)
    fileName: str = Field(min_length=1, max_length=255)
    language: Literal['auto', 'zh', 'en', 'ja', 'ko'] = 'auto'
    model: Literal['small', 'medium'] = 'small'
    withSrt: bool = True


def require_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> None:
    expected = os.getenv('ASR_SERVICE_TOKEN', '')
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='ASR_SERVICE_TOKEN 尚未配置',
        )
    if (
        credentials is None
        or credentials.scheme.lower() != 'bearer'
        or not secrets.compare_digest(credentials.credentials, expected)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='无效的服务访问令牌',
        )


def public_job(job: dict) -> dict:
    return {
        'id': job['id'],
        'status': job['status'],
        'progress': job['progress'],
        'error': job.get('error'),
        'result': job.get('result'),
    }


def update_job(job_id: str, **changes) -> None:
    JOBS[job_id].update(changes)


def format_srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f'{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}'


def build_srt(segments: list[dict]) -> str:
    blocks = []
    for index, segment in enumerate(segments, start=1):
        start = format_srt_timestamp(segment['start'])
        end = format_srt_timestamp(segment['end'])
        blocks.append(f"{index}\n{start} --> {end}\n{segment['text'].strip()}")
    return '\n\n'.join(blocks) + ('\n' if blocks else '')


def get_model(model_name: str) -> WhisperModel:
    with MODEL_LOCK:
        if model_name not in MODEL_CACHE:
            MODEL_CACHE[model_name] = WhisperModel(
                model_name,
                device=DEVICE,
                compute_type=COMPUTE_TYPE,
                download_root=str(MODELS_DIR),
            )
        return MODEL_CACHE[model_name]


def transcribe_file(job_id: str, media_path: Path, language: str, model_name: str, with_srt: bool) -> dict:
    model = get_model(model_name)
    segments_iterator, info = model.transcribe(
        str(media_path),
        language=None if language == 'auto' else language,
        beam_size=5,
        vad_filter=True,
    )
    segments = []
    total_duration = float(info.duration or 0)
    for segment in segments_iterator:
        item = {
            'start': round(float(segment.start), 3),
            'end': round(float(segment.end), 3),
            'text': segment.text.strip(),
        }
        segments.append(item)
        if total_duration > 0:
            progress = min(95, max(8, round(item['end'] / total_duration * 95)))
            update_job(job_id, progress=progress)

    duration = total_duration or (segments[-1]['end'] if segments else 0)
    if duration <= 0:
        raise ValueError('无法确定媒体时长')
    detected_language = info.language or language
    text = ''.join(segment['text'] for segment in segments).strip()
    result_json = json.dumps(
        {'language': detected_language, 'duration': duration, 'segments': segments},
        ensure_ascii=False,
        indent=2,
    )
    return {
        'text': text,
        'srt': build_srt(segments) if with_srt else '',
        'json': result_json,
        'duration': duration,
        'language': detected_language,
    }


async def download_media(source_url: str, destination: Path) -> None:
    parsed = urlparse(source_url)
    if parsed.scheme != 'https':
        raise ValueError('媒体地址必须使用 HTTPS')
    timeout = httpx.Timeout(connect=20, read=300, write=60, pool=20)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        async with client.stream('GET', source_url) as response:
            response.raise_for_status()
            if response.url.scheme != 'https':
                raise ValueError('媒体重定向地址必须使用 HTTPS')
            content_length = int(response.headers.get('content-length', '0') or 0)
            if content_length > MAX_FILE_BYTES:
                raise ValueError('媒体文件超过 200 MB 限制')
            downloaded = 0
            with destination.open('wb') as output:
                async for chunk in response.aiter_bytes(1024 * 1024):
                    downloaded += len(chunk)
                    if downloaded > MAX_FILE_BYTES:
                        raise ValueError('媒体文件超过 200 MB 限制')
                    output.write(chunk)
            if downloaded == 0:
                raise ValueError('下载到的媒体文件为空')


async def process_job(job_id: str, request: CreateTranscriptionRequest) -> None:
    suffix = Path(request.fileName).suffix.lower()
    try:
        update_job(job_id, status='processing', progress=3)
        with tempfile.TemporaryDirectory(prefix='voxscribe_') as temp_dir:
            media_path = Path(temp_dir) / f'source{suffix}'
            await download_media(request.sourceUrl, media_path)
            update_job(job_id, progress=8)
            result = await asyncio.to_thread(
                transcribe_file,
                job_id,
                media_path,
                request.language,
                request.model,
                request.withSrt,
            )
        update_job(job_id, status='completed', progress=100, result=result, error=None)
    except Exception as error:
        update_job(job_id, status='failed', error=str(error) or '转写失败', result=None)
        print(f'[ASR] 任务 {job_id} 失败: {error}', flush=True)


@app.get('/healthz')
async def healthz() -> dict:
    return {'status': 'ok', 'modelsLoaded': sorted(MODEL_CACHE)}


@app.post('/v1/transcriptions', status_code=status.HTTP_202_ACCEPTED)
async def create_transcription(
    request: CreateTranscriptionRequest,
    _: None = Depends(require_token),
) -> dict:
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {
        'id': job_id,
        'status': 'queued',
        'progress': 0,
        'error': None,
        'result': None,
    }
    task = asyncio.create_task(process_job(job_id, request))
    BACKGROUND_TASKS.add(task)
    task.add_done_callback(BACKGROUND_TASKS.discard)
    return public_job(JOBS[job_id])


@app.get('/v1/transcriptions/{job_id}')
async def get_transcription(job_id: str, _: None = Depends(require_token)) -> dict:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='转写任务不存在')
    return public_job(job)
