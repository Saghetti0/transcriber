import { Client, DiscordAPIError, Events, GatewayIntentBits, Message, PermissionFlagsBits } from "discord.js";
import configJson from "./config.json";
import { createClient } from "celery-node";
import process from "process";
import Redis from "ioredis";

const redis = new Redis(configJson.redis);

process
  .on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
  })
  .on('uncaughtException', err => {
    console.error(err, 'Uncaught Exception thrown');
    process.exit(1);
  });

const celeryClient = createClient(
  configJson.redis,
  configJson.redis,
);

const transcribeTask = celeryClient.createTask("transcriber.transcribe");

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
] });

client.on(Events.ShardError, error => {
	console.error('A websocket connection encountered an error:', error);
});

client.on(Events.Error, error => {
  console.error('Client encontered an error:', error);
})

client.once(Events.ClientReady, c => {
	console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (e) => {
  try {
    if (e.guildId == null) return;
  
    let url: string | undefined = undefined;
  
    // this breaks for more than one voice message
    // but that shouldn't be possible

    // TODO: check for voice message flags rather than just the filename
    // this code was written before the flags were documented
    e.attachments.forEach(i => {
      if (i.name == "voice-message.ogg") {
        url = i.url;
      }
    });
  
    if (url === undefined) {
      return;
    }
  
    // temporarily store data in redis to allow for resume after crash
    // TODO: actually implement this functionality...
    await redis.hset(`transcribe.${e.id}`, {
      message_id: e.id,
      channel_id: e.channelId,
      guild_id: e.guildId,
      url: url,
      state: "t_fast",
      started: new Date().toISOString()
    });
  
    // expire after 12h
    await redis.expire(`transcribe.${e.id}`, 60 * 60 * 12);
  
    console.log("Transcribing", e.id);

    const messageLink = `https://discord.com/channels/${e.guildId}/${e.channelId}/${e.id}`;
    let canReply = false;
    const myself = e.guild?.members.me;

    if (!e.channel.isDMBased() && myself) {
      if (e.channel.permissionsFor(myself).has(PermissionFlagsBits.ReadMessageHistory)) {
        canReply = true;
      }
    }

    const prefix = canReply ? "" : `${messageLink}\n`;
    let replyMessage: Message;

    if (canReply) {
      replyMessage = await e.reply({
        content: ":writing_hand: Transcribing...",
        failIfNotExists: true,
        allowedMentions: {
          repliedUser: false
        }
      });
    } else {
      replyMessage = await e.channel.send({
        content: `${messageLink} :writing_hand: Transcribing...`,
      });
    }
 
    try {
      transcribeTask.applyAsync([url]).get().then(async value => {
        await redis.hset(`transcribe.${e.id}`, {
          state: "done",
          result: value
        });
  
        console.log("Finished transcription for", e.id);

        if (value.length < 3800)
          return await replyMessage.edit({
            content: prefix + "```\n" + value + "\n```\n",
            allowedMentions: {
              repliedUser: false
            }
          });

        await replyMessage.edit({
          content: prefix + "Transcription attached as file",
          files: [{
            attachment: Buffer.from(value, "utf-8"),
            name: "transcription.txt"
          }],
          allowedMentions: {
            repliedUser: false
          }
        });
      }).catch(async err => {
        await redis.hset(`transcribe.${e.id}`, {
          state: "t_err"
        });
        console.log("Failed transcription for", e.id);
        await replyMessage.edit({
          content: prefix + ":warning: Error transcribing: `" + err + "`",
          allowedMentions: {
            repliedUser: false
          }
        });
      });
  
    } catch (err) {
      await redis.hset(`transcribe.${e.id}`, {
        state: "top_err"
      });
      replyMessage.edit(prefix + ":warning: Error transcribing: (tl) `" + err + "`");
    }
  } catch (e) {
    console.log("Top level execption", e);
  }
});

client.login(configJson.token);
