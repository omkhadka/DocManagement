#!/bin/sh
# Concatenates the front-end sources into assets/app.js (run after editing assets/js/*.js)
cd "$(dirname "$0")/assets/js" && cat core.js shell.js drafting.js mfa.js library.js upload.js doc.js pages.js admin.js ocr.js toto.js map.js zz-main.js > ../app.js && echo "assets/app.js built"
