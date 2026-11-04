@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   ==========================================
echo    糖果屋 · 打包成单个静态 HTML
echo   ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [x] 没找到 node。先装一个 Node.js 再回来：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo   node !NODEV!

if /i "%~1"=="nofont" (
  echo   模式：不内联字体（产物约 200KB，用系统字体回退）
  echo.
  node "tools\build-single.js" --no-font
) else (
  echo   模式：全内联（含 70 个像素字体分片，产物约 3MB）
  echo   想要小一点的：把 build.bat 拖到命令行，后面加 nofont
  echo.
  node "tools\build-single.js"
)

if errorlevel 1 (
  echo.
  echo   [x] 打包失败，看上面的报错。
  echo.
  pause
  exit /b 1
)

echo.
echo   完成。双击 dist\candy-house.html 就能玩，
echo   把这一个文件丢到任何静态托管（GitHub Pages / 对象存储 / nginx）也直接能跑。
echo.
if exist "dist" start "" "dist"
pause
