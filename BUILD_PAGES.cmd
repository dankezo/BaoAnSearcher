# Rebuild static site into docs/ for GitHub Pages (branch /docs)
cd /d "%~dp0web"
call npm run build
cd ..
if exist docs rmdir /s /q docs
xcopy /e /i /y web\dist docs
echo Done. Commit docs/ and push.
