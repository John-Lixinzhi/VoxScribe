@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0"
set "HF_HOME=%ROOT%cache\hf"
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

rem 优先使用项目内 runtime；没有就复用系统 PATH 中的 Python。
set "PY="
if exist "%ROOT%runtime\Scripts\python.exe" set "PY=%ROOT%runtime\Scripts\python.exe"
if not defined PY (
    for /f "delims=" %%i in ('where python 2^>nul') do if not defined PY set "PY=%%i"
)
if not defined PY (
    echo [错误] 没有找到 Python，请先安装 Python 3.12 并勾选 Add to PATH。
    pause
    exit /b 1
)

"%PY%" -c "import faster_whisper, av, numpy, tkinterdnd2" >nul 2>&1
if errorlevel 1 (
    echo [错误] 依赖未安装，请在本目录执行：
    echo "%PY%" -m pip install -r requirements.txt
    pause
    exit /b 1
)

if "%~1"=="" (
    if exist "%ROOT%VoxScribe.exe" (
        start "" "%ROOT%VoxScribe.exe"
        exit /b 0
    )
    set "PYW=%PY:python.exe=pythonw.exe%"
    if not exist "%PYW%" set "PYW=%PY%"
    start "" "%PYW%" "%ROOT%app\voxscribe_gui.py"
    exit /b 0
)

"%PY%" "%ROOT%app\voxscribe.py" %*
echo.
pause
