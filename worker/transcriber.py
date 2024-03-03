from celery import Celery, states, Task
from celery.exceptions import Ignore
from celery.concurrency import asynpool
from celery.signals import worker_process_init, worker_process_shutdown
from celery.utils.log import get_task_logger
import json
import uuid
import requests
import os
import whisper

if not os.path.exists("temp"):
    os.mkdir("temp")

logger = get_task_logger(__name__)

class Transcriber:
    def __init__(self, model, device):
        self.model = whisper.load_model(model, device=device)

    def process(self, file_path):
        try:
            result = self.model.transcribe(file_path)
            return (True, result[0])
        except Exception as e:
            return (False, str(e))

    def close(self):
        pass

asynpool.PROC_ALIVE_TIMEOUT = 60.0

with open("config.json", "r") as fh:
    config = json.load(fh)

tr_instance = None
app = Celery(__name__, broker=config["redis"], backend=config["redis"])

@worker_process_init.connect()
def configure_worker(signal=None, sender=None, **kwargs):
    global tr_instance
    tr_instance = Transcriber(
        config["model"],
        config["device"]
    )

@worker_process_shutdown.connect()
def shutdown_worker(signal=None, sender=None, **kwargs):
    print("Handling shutdown")
    tr_instance.close()

@app.task(bind=True)
def transcribe(self, url):
    def progress_callback(progress):
        self.update_state(state=states.STARTED, meta={"action": "transcribe", "detail": progress})

    tr_instance.progress_callback = progress_callback

    file_id = str(uuid.uuid4())

    try:
        self.update_state(state=states.STARTED, meta={"action": "fetch_file"})

        resp = requests.get(url)
        resp.raise_for_status()

        with open(f"temp/{file_id}.ogg", "wb") as fh:
            fh.write(resp.content)
        
        self.update_state(state=states.STARTED, meta={"action": "ffmpeg_decompress"})

        ffmpeg_ret = os.system(f"ffmpeg -i temp/{file_id}.ogg -ac 1 -ar 16000 -c:a pcm_s16le temp/{file_id}.wav")

        if ffmpeg_ret != 0:
            raise ChildProcessError(f"ffmpeg exited with {ffmpeg_ret}")

        ok, data = tr_instance.process(f"temp/{file_id}.wav")

        if not ok:
            raise Exception("whisper error in " + data); 

        return data
    finally:
        if os.path.exists(f"temp/{file_id}.ogg"): os.remove(f"temp/{file_id}.ogg")
        if os.path.exists(f"temp/{file_id}.wav"): os.remove(f"temp/{file_id}.wav")
