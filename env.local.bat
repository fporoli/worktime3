@echo off
if not exist "%~dp0.env.local" (
  echo Missing .env file: "%~dp0.env.local" 1>&2
  exit /b 1
)

for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0.env.local") do set "%%A=%%B"

rem psql itself reads PG* names rather than POSTGRES_*.
set "PGHOST=%POSTGRES_HOST%"
set "PGPORT=%POSTGRES_PORT%"
set "PGUSER=%POSTGRES_USER%"
set "PGPASSWORD=%POSTGRES_PASSWORD%"
set "PGDATABASE=%POSTGRES_DB%"
