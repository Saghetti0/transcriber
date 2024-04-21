import { REST, Routes } from "discord.js";
import configJson from "./config.json";

const commandDefs = [
  {
    "name": "autotranscribe",
    "type": 1,
    "default_member_permissions": 16,
    "contexts": [0],
    "description": "Configures automatic transcription for this channel",
    "options": [
      {
        "type": 1,
        "name": "on",
        "description": "Enable automatic transcription in this channel",
        "options": []
      },
      {
        "type": 1,
        "name": "off",
        "description": "Disable automatic transcription in this channel",
        "options": []
      }
    ]
  },
  {
    "name": "howto",
    "type": 1,
    "integration_types": [0, 1],
    "contexts": [0, 1, 2],
    "description": "Send information about how to use Transcriber"
  },
  {
    "name": "Transcribe",
    "type": 3,
    "integration_types": [0, 1],
    "contexts": [0, 1, 2]
  }
];

const rest = new REST().setToken(configJson.token);

(async () => {
  const myself = await rest.get(Routes.currentApplication());

  // this is dumb idc

  if (myself === null || typeof myself !== "object")
    throw Error("expected object on /applications/@me");

  if (!("id" in myself)) 
    throw Error("expected property 'id' on /applications/@me");

  const myId = myself.id;

  if (typeof myId !== "string")
    throw Error("expected property 'id' to be of type string on /applications/@me");

  await rest.put(
    Routes.applicationCommands(myId),
    { body: commandDefs },
  );
})();  
