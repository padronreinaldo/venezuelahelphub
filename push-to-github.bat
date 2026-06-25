@echo off
REM ============================================================
REM  Sube Venezuela Relief Hub a GitHub.
REM  Doble clic para ejecutar. Requiere Git instalado:
REM  https://git-scm.com/download/win  (incluye el login por navegador)
REM ============================================================
cd /d "%~dp0"

echo.
echo === Inicializando repositorio ===
git init

echo.
echo === Agregando archivos ===
git add .

echo.
echo === Commit ===
git commit -m "Venezuela Relief Hub - MVP inicial"

echo.
echo === Rama principal: main ===
git branch -M main

echo.
echo === Conectando con GitHub ===
git remote remove origin 2>nul
git remote add origin https://github.com/padronreinaldo/venezuelahelphub.git

echo.
echo === Subiendo (puede abrirse el navegador para iniciar sesion) ===
git push -u origin main

echo.
echo ============================================================
echo  Listo. Si pidio login, completa en el navegador y reintenta.
echo ============================================================
pause
