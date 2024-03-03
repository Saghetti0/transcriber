#!/bin/sh

python3 -m celery -A transcriber worker --loglevel=INFO -c 1
