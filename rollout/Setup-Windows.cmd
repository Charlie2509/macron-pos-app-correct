@echo off
setlocal
pushd "%~dp0" || exit /b 1
if not exist "rollout\prepare-draft.mjs" if exist "prepare-draft.mjs" cd ..
where node >nul 2>&1 || goto :needsnode
where npm >nul 2>&1 || goto :needsnode
node -e "const [m,n]=process.versions.node.split('.').map(Number);process.exit(m>22||(m===22&&n>=12)?0:1)" || goto :needsnode
node rollout\prepare-draft.mjs --check-package || goto :failed
call npm.cmd ci --no-audit --no-fund || goto :failed
node rollout\prepare-draft.mjs || goto :failed
pause
popd
exit /b 0
:needsnode
echo Install Node.js 24 LTS from https://nodejs.org and reopen Setup-Windows.cmd.
:failed
echo Setup stopped. See the message above. Check the MSH app drafts and Flow before trying again.
pause
popd
exit /b 1
