@echo off
set SRC=C:\Users\charl\yachtpics-portal\src
set DST=C:\Users\charl\OneDrive\Documents\GitHub\yachtpics-portal\src

copy /Y "%SRC%\lib\assertListingAccess.ts" "%DST%\lib\assertListingAccess.ts"
copy /Y "%SRC%\app\api\videos\delete\route.ts" "%DST%\app\api\videos\delete\route.ts"
copy /Y "%SRC%\app\api\documents\delete\route.ts" "%DST%\app\api\documents\delete\route.ts"
copy /Y "%SRC%\app\api\email\send-to-client\route.ts" "%DST%\app\api\email\send-to-client\route.ts"

mkdir "%DST%\app\api\listings\[id]" 2>nul
copy /Y "%SRC%\app\api\listings\[id]\route.ts" "%DST%\app\api\listings\[id]\route.ts"
copy /Y "%SRC%\app\dashboard\listings\[id]\edit\page.tsx" "%DST%\app\dashboard\listings\[id]\edit\page.tsx"

echo.
echo All 6 files copied. Open GitHub Desktop, review, commit and push.
pause
