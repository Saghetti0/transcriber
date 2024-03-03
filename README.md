# transcriber

A Discord bot that transcribes voice messages.

- [Bot Invite](https://discord.com/api/oauth2/authorize?client_id=1096877566595452978&permissions=379968&scope=bot)
- [Support Server](https://discord.gg/EBEVZDZzPC)

## Structure

The bot is split into two parts:
- `bot/` handles the connection to Discord's gateway and API, and communicates with the workers over Redis. 
- `worker/` handles the transcription jobs, sending results to the "front-end". This component can be independently scaled to as many machines as needed, and jobs will be split across them equally.

## To-do

- [ ] Properly handle messages longer than 2000 characters (right now it just crashes...).
- [ ] Use [message flags](https://discord.com/developers/docs/resources/channel#message-object-message-flags) to determine voice messages, rather than the name of the file.
- [ ] Add a context menu action to transcribe voice messages.
- [ ] (long term) Migrate off of [Celery](https://docs.celeryq.dev/en/stable/) to a more robust task management system, probably something custom-built. This involves a rewrite of the bot.

## History

The original version of this bot used [whisper.cpp](https://github.com/ggerganov/whisper.cpp) and ran on the CPU. This worked, but was pretty slow, as CPU inference typically is. The solution I came up with for this was to have a two-pass system, where the bot processed messages with the `base` model first, and then `medium` for higher quality. Eventually, I was able to upgrade the host machine with a GPU, and configured it to use that instead. However, due to bugs in whisper.cpp's CUDA implementation, it hallucinated a *lot*, to the point at which the outputs were near unusuable. I eventually just switched to the [official implementation](https://github.com/openai/whisper), which was fast enough to get rid of the two-pass system. I tried to clean up the code to remove a lot of the two-pass weirdness, but things are still a bit messy.
