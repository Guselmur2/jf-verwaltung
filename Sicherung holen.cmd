@echo off
rem Doppelklick genuegt: holt eine Datensicherung vom Pi auf diesen Rechner.
rem Beim ersten Start fragt das Skript einmal nach Passwort und Zielordner.
title Datensicherung Jugendfeuerwehr
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sicherung-holen.ps1" %*
echo.
pause
