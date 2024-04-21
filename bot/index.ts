import { 
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  MessageContextMenuCommandInteraction,
  MessageFlags,
  PermissionFlagsBits
} from "discord.js";
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
  GatewayIntentBits.DirectMessages,
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

async function handleCommandAutotranscribe(e: ChatInputCommandInteraction) {
  const subcommand = e.options.getSubcommand(true);

  switch (subcommand) {
    case "on": {
      await redis.hset(`guild.${e.guildId}.channel.${e.channelId}`, {
        "auto_transcribe_enabled": "true"
      });

      await e.reply(":white_check_mark: Enabled auto transcribe in this channel");

      break;
    }

    case "off": {
      await redis.hset(`guild.${e.guildId}.channel.${e.channelId}`, {
        "auto_transcribe_enabled": "false"
      });

      await e.reply(":white_check_mark: Disabled auto transcribe in this channel");

      break;
    }

    default: {
      await e.reply({
        content: ":x: Subcommand must either be `on` or `off`.",
        ephemeral: true,
      });
      break;
    }
  }
}

async function handleContextMenuTranscribe(e: MessageContextMenuCommandInteraction) {
  const message = e.targetMessage;

  const url = extractVoiceMessageUrl(message);

  if (url === null) {
    e.reply({
      content: ":x: This doesn't look like a voice message.",
      ephemeral: true
    });
    return;
  }

  console.log("Transcribing", message.id, "(context menu)");

  const replyMessage = await e.reply({
    content: ":writing_hand: Transcribing..",
    ephemeral: true
  });

  try {
    const transcribeResult = await transcribeFromUrl(url);

    console.log("Finished transcription for", message.id);

    if (transcribeResult.length < 3800) {
      await replyMessage.edit({
        content: "```\n" + transcribeResult + "\n```\n",
        allowedMentions: {
          repliedUser: false
        }
      });
    } else {
      await replyMessage.edit({
        content: "Transcription attached as file",
        files: [{
          attachment: Buffer.from(transcribeResult, "utf-8"),
          name: "transcription.txt"
        }],
        allowedMentions: {
          repliedUser: false
        }
      });
    }
  } catch (e) {
    console.warn("Error transcribing", message.id, e);
    replyMessage.edit({
      content: ":warning: Error transcribing: `" + e + "`",
      allowedMentions: {
        repliedUser: false
      }
    });
  }
}

async function handleAutoTranscribe(message: Message<true>) {
  const url = extractVoiceMessageUrl(message);

  if (url === null) return;

  console.log("Transcribing", message.id, "(auto)");

  const messageLink = `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;

  // check for permission to reply
  let canReply = false;
  const myself = message.guild?.members.me;

  if (!message.channel.isDMBased() && myself) {
    if (message.channel.permissionsFor(myself).has(PermissionFlagsBits.ReadMessageHistory)) {
      canReply = true;
    }
  }

  const prefix = canReply ? "" : `${messageLink}\n`;
  let replyMessage: Message;

  if (canReply) {
    replyMessage = await message.reply({
      content: ":writing_hand: Transcribing...",
      failIfNotExists: true,
      allowedMentions: {
        repliedUser: false
      }
    });
  } else {
    replyMessage = await message.channel.send({
      content: `${messageLink} :writing_hand: Transcribing...`,
    });
  }

  try {
    const transcribeResult = await transcribeFromUrl(url);

    console.log("Finished transcription for", message.id);

    if (transcribeResult.length < 3800) {
      await replyMessage.edit({
        content: prefix + "```\n" + transcribeResult + "\n```\n",
        allowedMentions: {
          repliedUser: false
        }
      });
    } else {
      await replyMessage.edit({
        content: prefix + "Transcription attached as file",
        files: [{
          attachment: Buffer.from(transcribeResult, "utf-8"),
          name: "transcription.txt"
        }],
        allowedMentions: {
          repliedUser: false
        }
      });
    }
  } catch (e) {
    console.warn("Error transcribing", message.id, e);
    replyMessage.edit({
      content: prefix + ":warning: Error transcribing: `" + e + "`",
      allowedMentions: {
        repliedUser: false
      }
    });
  }
}

function transcribeFromUrl(url: string): Promise<string> {
  return transcribeTask.applyAsync([url]).get();
}

function extractVoiceMessageUrl(message: Message): string | null {
  if (!message.flags.has(MessageFlags.IsVoiceMessage)) return null;
  
  for (const [name, attachment] of message.attachments) {
    // just return the first one we get, should be fine(??)
    return attachment.proxyURL;
  }
  
  return null;
}

client.on(Events.MessageCreate, async e => {
  if (!e.inGuild()) return;

  // check if this channel has autotranscribe enabled

  const enabled = (await redis.hget(`guild.${e.guildId}.channel.${e.channelId}`, "auto_transcribe_enabled") ?? "true") === "true";
  if (!enabled) return;

  handleAutoTranscribe(e);
});

client.on(Events.InteractionCreate, e => {
  if (e.isMessageContextMenuCommand()) {
    if (e.commandName == "Transcribe") {
      handleContextMenuTranscribe(e);
      return;
    }
  }
  
  if (e.isChatInputCommand()) {
    if (e.commandName == "autotranscribe") {
      handleCommandAutotranscribe(e);
      return;
    }
  }

  console.warn("Unhandled interaction?!", e);

  if (e.isRepliable()) {
    e.reply({
      content: ":x: An error occurred while handling this interaction.",
      ephemeral: true,
    });
  }
});

client.login(configJson.token);
