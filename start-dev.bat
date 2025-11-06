@echo off
setlocal
set ROOT=%~dp0
if exist "%ROOT%\.venv\Scripts\python.exe" (
  set PYTHON="%ROOT%\.venv\Scripts\python.exe"
) else (
  set PYTHON=python
)
cd /d "%ROOT%"
%PYTHON% tools\dev.py
