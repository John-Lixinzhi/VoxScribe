@echo off
setlocal
chcp 65001 >nul
if "%~1"=="" (
    echo 把音视频文件拖到这个 bat 上即可转写。
    echo 双击 VoxScribe.bat 可打开图形界面。
    pause
    exit /b 0
)
call "%~dp0VoxScribe.bat" %*
