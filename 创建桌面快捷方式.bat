@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "EXE=%ROOT%VoxScribe.exe"
if not exist "%EXE%" set "EXE=%ROOT%release\VoxScribe\VoxScribe.exe"
if not exist "%EXE%" (
    echo [错误] 未找到打包后的 VoxScribe.exe
    echo 请先运行 python build_assets\make_exe.py 完成打包。
    pause
    exit /b 1
)
set "VOXSCRIBE_EXE=%EXE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$exe=$env:VOXSCRIBE_EXE; $root=Split-Path $exe; $desktop=[Environment]::GetFolderPath('Desktop'); $lnk=Join-Path $desktop 'VoxScribe.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath=$exe; $s.WorkingDirectory=$root; $s.IconLocation=$exe+',0'; $s.Description='本地音视频转文字'; $s.Save()"
echo 桌面快捷方式已创建：VoxScribe.lnk
pause
