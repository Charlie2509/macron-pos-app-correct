@echo off
setlocal
pushd "%~dp0" || exit /b 1
where node >nul 2>&1 || goto :needsnode
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)" || goto :needsnode
node setup.mjs --check-cli
if errorlevel 1 goto :loadcli
node setup.mjs
goto :done
:loadcli
where npm >nul 2>&1 || goto :needsnode
echo Loading the official Shopify CLI 5.0.1...
call npm.cmd exec --yes --package=@shopify/cli@5.0.1 -- node "%~dp0setup.mjs"
goto :done
:needsnode
echo Install Node.js 24 LTS from https://nodejs.org and reopen this file.
echo Or open README.md to use the Shopify Flow editor.
pause
popd
exit /b 1
:done
set "mshstatus=%errorlevel%"
pause
popd
exit /b %mshstatus%
