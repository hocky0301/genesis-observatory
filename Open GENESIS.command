#!/bin/zsh
cd -- "${0:A:h}"
print 'GENESIS — open http://127.0.0.1:5173'
print 'Keep this window open. Press Control-C to stop the local server.'
node serve.mjs
