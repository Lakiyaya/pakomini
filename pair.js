const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { sms } = require("./msg");
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FileType = require('file-type');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  downloadContentFromMessage,
  proto,
  DisconnectReason
} = require('baileys');
// ---------------- CONFIG ----------------

const BOT_NAME_FANCY = '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'true',
  AUTO_LIKE_EMOJI: ['☘️','💗','🫂','🙈','🍁','🙃','🧸','😘','🏴‍☠️','👀','❤️‍🔥'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/EYP9pelctSe7To7levRi0j',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/xyeod7.jpeg',
  NEWSLETTER_JID: '120363419758690313@newsletter',
  OTP_EXPIRY: 300000,
  WORK_TYPE: 'public',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '94785316830',
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb7NcUw2phHR4mDZJ51g',
  BOT_NAME: '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥',
  BOT_VERSION: '2.0.0V',
  OWNER_NAME: 'Yasas Dileepa',
  IMAGE_PATH: 'https://files.catbox.moe/paap2h.jpg',
  BOT_FOOTER: '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥',
  BUTTON_IMAGES: { ALIVE: 'https://files.catbox.moe/xyeod7.jpeg' }
};

// ---------------- MONGO SETUP ----------------

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://pakayek:yasas@cluster0.6z7klks.mongodb.net/';
const MONGO_DB = process.env.MONGO_DB || 'DTEC_MINI';

let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;

async function initMongo() {
  try {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected && mongoClient.topology.isConnected()) return;
  } catch(e){}
  mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await mongoClient.connect();
  mongoDB = mongoClient.db(MONGO_DB);

  sessionsCol = mongoDB.collection('sessions');
  numbersCol = mongoDB.collection('numbers');
  adminsCol = mongoDB.collection('admins');
  newsletterCol = mongoDB.collection('newsletter_list');
  configsCol = mongoDB.collection('configs');
  newsletterReactsCol = mongoDB.collection('newsletter_reacts');

  await sessionsCol.createIndex({ number: 1 }, { unique: true });
  await numbersCol.createIndex({ number: 1 }, { unique: true });
  await newsletterCol.createIndex({ jid: 1 }, { unique: true });
  await newsletterReactsCol.createIndex({ jid: 1 }, { unique: true });
  await configsCol.createIndex({ number: 1 }, { unique: true });
  console.log('✅ Mongo initialized and collections ready');
}

// ---------------- Mongo helpers ----------------

async function saveCredsToMongo(number, creds, keys = null) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
    await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
    console.log(`Saved creds to Mongo for ${sanitized}`);
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await sessionsCol.findOne({ number: sanitized });
    return doc || null;
  } catch (e) { console.error('loadCredsFromMongo error:', e); return null; }
}

async function removeSessionFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
    console.log(`Removed session from Mongo for ${sanitized}`);
  } catch (e) { console.error('removeSessionToMongo error:', e); }
}

async function addNumberToMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
    console.log(`Added number ${sanitized} to Mongo numbers`);
  } catch (e) { console.error('addNumberToMongo', e); }
}

async function removeNumberFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.deleteOne({ number: sanitized });
    console.log(`Removed number ${sanitized} from Mongo numbers`);
  } catch (e) { console.error('removeNumberFromMongo', e); }
}

async function getAllNumbersFromMongo() {
  try {
    await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
  try {
    await initMongo();
    const docs = await adminsCol.find({}).toArray();
    return docs.map(d => d.jid || d.number).filter(Boolean);
  } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function addAdminToMongo(jidOrNumber) {
  try {
    await initMongo();
    const doc = { jid: jidOrNumber };
    await adminsCol.updateOne({ jid: jidOrNumber }, { $set: doc }, { upsert: true });
    console.log(`Added admin ${jidOrNumber}`);
  } catch (e) { console.error('addAdminToMongo', e); }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    await initMongo();
    await adminsCol.deleteOne({ jid: jidOrNumber });
    console.log(`Removed admin ${jidOrNumber}`);
  } catch (e) { console.error('removeAdminFromMongo', e); }
}

async function addNewsletterToMongo(jid, emojis = []) {
  try {
    await initMongo();
    const doc = { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date() };
    await newsletterCol.updateOne({ jid }, { $set: doc }, { upsert: true });
    console.log(`Added newsletter ${jid} -> emojis: ${doc.emojis.join(',')}`);
  } catch (e) { console.error('addNewsletterToMongo', e); throw e; }
}

async function removeNewsletterFromMongo(jid) {
  try {
    await initMongo();
    await newsletterCol.deleteOne({ jid });
    console.log(`Removed newsletter ${jid}`);
  } catch (e) { console.error('removeNewsletterFromMongo', e); throw e; }
}

async function listNewslettersFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    await initMongo();
    const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
    if (!mongoDB) await initMongo();
    const col = mongoDB.collection('newsletter_reactions_log');
    await col.insertOne(doc);
    console.log(`Saved reaction ${emoji} for ${jid}#${messageId}`);
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('setUserConfigInMongo', e); }
}

async function loadUserConfigFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await configsCol.findOne({ number: sanitized });
    return doc ? doc.config : null;
  } catch (e) { console.error('loadUserConfigFromMongo', e); return null; }
}

// -------------- newsletter react-config helpers --------------

async function addNewsletterReactConfig(jid, emojis = []) {
  try {
    await initMongo();
    await newsletterReactsCol.updateOne({ jid }, { $set: { jid, emojis, addedAt: new Date() } }, { upsert: true });
    console.log(`Added react-config for ${jid} -> ${emojis.join(',')}`);
  } catch (e) { console.error('addNewsletterReactConfig', e); throw e; }
}

async function removeNewsletterReactConfig(jid) {
  try {
    await initMongo();
    await newsletterReactsCol.deleteOne({ jid });
    console.log(`Removed react-config for ${jid}`);
  } catch (e) { console.error('removeNewsletterReactConfig', e); throw e; }
}

async function listNewsletterReactsFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterReactsCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

async function getReactConfigForJid(jid) {
  try {
    await initMongo();
    const doc = await newsletterReactsCol.findOne({ jid });
    return doc ? (Array.isArray(doc.emojis) ? doc.emojis : []) : null;
  } catch (e) { console.error('getReactConfigForJid', e); return null; }
}

// ---------------- basic utils ----------------

function formatMessage(title, content, footer) {
  return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp(){ return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();

const socketCreationTime = new Map();

const otpStore = new Map();

// ---------------- helpers kept/adapted ----------------

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`*🔐 𝐎𝚃𝙿 𝐕𝙴𝚁𝙸𝙵𝙸𝙲𝙰𝚃𝙸𝙾𝙽 — ${BOT_NAME_FANCY}*`, `*𝐘𝙾𝚄𝚁 𝐎𝚃𝙿 𝐅𝙾𝚁 𝐂𝙾𝙽𝙵𝙸𝙶 𝐔𝙿𝙳𝙰𝚃𝙴 𝐈𝚂:* *${otp}*\n𝐓𝙷𝙸𝚂 𝐎𝚃𝙿 𝐖𝙸𝙻𝙻 𝐄𝚇𝙿𝙸𝚁𝙴 𝐈𝙽 5 𝐌𝙸𝙽𝚄𝚃𝙴𝚂.\n\n*𝐍𝚄𝙼𝙱𝙴𝚁:* ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ---------------- handlers (newsletter + reactions) ----------------
async function setupNewsletterHandlers(socket, sessionNumber) {
  // rrPointers අවශ්‍ය නැත, අපි Random ක්‍රමය භාවිතා කරමු

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;

    try {
      const followedDocs = await listNewslettersFromMongo(); // array of {jid, emojis}
      const reactConfigs = await listNewsletterReactsFromMongo(); // [{jid, emojis}]
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

      const followedJids = followedDocs.map(d => d.jid);
      if (!followedJids.includes(jid) && !reactMap.has(jid)) return;

      let emojis = reactMap.get(jid) || null;
      if ((!emojis || emojis.length === 0) && followedDocs.find(d => d.jid === jid)) {
        emojis = (followedDocs.find(d => d.jid === jid).emojis || []);
      }
      
      // Default Emoji එක සෙට් කිරීම
      if (!emojis || emojis.length === 0) {
          // config.AUTO_LIKE_EMOJI එක string එකක් නම් array එකක් කරගන්න
          const defaultEmo = config.AUTO_LIKE_EMOJI;
          emojis = Array.isArray(defaultEmo) ? defaultEmo : [defaultEmo];
      }

      // ============================================================
      // CHANGE: Random Selection (මෙතනින් තමයි වෙනස් කළේ)
      // ලිස්ට් එකේ තියෙන ඉමෝජි වලින් අහඹු එකක් තෝරා ගනී.
      // බොට්ලා කිහිප දෙනෙක් හිටියත් මේ නිසා වෙනස් ඉමෝජි වැටේ.
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      // ============================================================

      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;

      let retries = 3;
      while (retries-- > 0) {
        try {
          if (typeof socket.newsletterReactMessage === 'function') {
            await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
          } else {
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
          }
          
          // Console එකට session number එකත් එක්කම log වෙන්න හදමු
          console.log(`[Session ${sessionNumber}] Reacted to ${jid} with ${emoji}`);
          
          await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
          break;
        } catch (err) {
          console.warn(`Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
          await new Promise(r => setTimeout(r, 1500)); // පොඩි delay එකක් (1.2s -> 1.5s)
        }
      }

    } catch (error) {
      console.error('Newsletter reaction handler error:', error?.message || error);
    }
  });
}

// ---------------- status + revocation + resizing ----------------

async function setupStatusHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
    
    try {
      // Load user-specific config from MongoDB
      let userEmojis = config.AUTO_LIKE_EMOJI; // Default emojis
      let autoViewStatus = config.AUTO_VIEW_STATUS; // Default from global config
      let autoLikeStatus = config.AUTO_LIKE_STATUS; // Default from global config
      let autoRecording = config.AUTO_RECORDING; // Default from global config
      
      if (sessionNumber) {
        const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
        
        // Check for emojis in user config
        if (userConfig.AUTO_LIKE_EMOJI && Array.isArray(userConfig.AUTO_LIKE_EMOJI) && userConfig.AUTO_LIKE_EMOJI.length > 0) {
          userEmojis = userConfig.AUTO_LIKE_EMOJI;
        }
        
        // Check for auto view status in user config
        if (userConfig.AUTO_VIEW_STATUS !== undefined) {
          autoViewStatus = userConfig.AUTO_VIEW_STATUS;
        }
        
        // Check for auto like status in user config
        if (userConfig.AUTO_LIKE_STATUS !== undefined) {
          autoLikeStatus = userConfig.AUTO_LIKE_STATUS;
        }
        
        // Check for auto recording in user config
        if (userConfig.AUTO_RECORDING !== undefined) {
          autoRecording = userConfig.AUTO_RECORDING;
        }
      }

      // Use auto recording setting (from user config or global)
      if (autoRecording === 'true') {
        await socket.sendPresenceUpdate("recording", message.key.remoteJid);
      }
      
      // Use auto view status setting (from user config or global)
      if (autoViewStatus === 'true') {
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try { 
            await socket.readMessages([message.key]); 
            break; 
          } catch (error) { 
            retries--; 
            await delay(1000 * (config.MAX_RETRIES - retries)); 
            if (retries===0) throw error; 
          }
        }
      }
      
      // Use auto like status setting (from user config or global)
      if (autoLikeStatus === 'true') {
        const randomEmoji = userEmojis[Math.floor(Math.random() * userEmojis.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(message.key.remoteJid, { 
              react: { text: randomEmoji, key: message.key } 
            }, { statusJidList: [message.key.participant] });
            break;
          } catch (error) { 
            retries--; 
            await delay(1000 * (config.MAX_RETRIES - retries)); 
            if (retries===0) throw error; 
          }
        }
      }

    } catch (error) { 
      console.error('Status handler error:', error); 
    }
  });
}


async function handleMessageRevocation(socket, number) {
  socket.ev.on('messages.delete', async ({ keys }) => {
    if (!keys || keys.length === 0) return;
    const messageKey = keys[0];
    const userJid = jidNormalizedUser(socket.user.id);
    const deletionTime = getSriLankaTimestamp();
    const message = formatMessage('*🗑️ 𝐌𝙴𝚂𝚂𝙰𝙶𝙴 𝐃𝙴𝙻𝙴𝚃𝙴𝙳*', `A message was deleted from your chat.\n*📋 𝐅𝚁𝙾𝙼:* ${messageKey.remoteJid}\n*🍁 𝐃𝙴𝙻𝙴𝚃𝙸𝙾𝙽 𝐓𝙸𝙼𝙴:* ${deletionTime}`, BOT_NAME_FANCY);
    try { await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: message }); }
    catch (error) { console.error('Failed to send deletion notification:', error); }
  });
}


async function resize(image, width, height) {
  let oyy = await Jimp.read(image);
  return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}

// ---------------- command handlers ---------------

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    const type = getContentType(msg.message);
    if (!msg.message) return;
    msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

    const from = msg.key.remoteJid;
    const sender = from;
    const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
    const senderNumber = (nowsender || '').split('@')[0];
    const developers = `${config.OWNER_NUMBER}`;
    const botNumber = socket.user.id.split(':')[0];
    const isbot = botNumber.includes(senderNumber);
    const isOwner = isbot ? isbot : developers.includes(senderNumber);
    const isGroup = from.endsWith("@g.us");


 const m = sms(socket, msg);                                               
const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
              ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
              : [];
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
                ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
                ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
                ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
                ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
                ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.text) 
            : (type === 'viewOnceMessage') 
                ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
                ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
            : '';

    if (!body || typeof body !== 'string') return;

    const prefix = config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
    const args = body.trim().split(/ +/).slice(1);

    // helper: download quoted media into buffer
    async function downloadQuotedMedia(quoted) {
      if (!quoted) return null;
      const qTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) return null;
      const messageType = qType.replace(/Message$/i, '').toLowerCase();
      const stream = await downloadContentFromMessage(quoted[qType], messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return {
        buffer,
        mime: quoted[qType].mimetype || '',
        caption: quoted[qType].caption || quoted[qType].fileName || '',
        ptt: quoted[qType].ptt || false,
        fileName: quoted[qType].fileName || ''
      };
    }

    if (!command) return;

    try {

      // Load user config for work type restrictions
      const sanitized = (number || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      
// ========== ADD WORK TYPE RESTRICTIONS HERE ==========
// Apply work type restrictions for non-owner users
if (!isOwner) {
  // Get work type from user config or fallback to global config
  const workType = userConfig.WORK_TYPE || 'public'; // Default to public if not set
  
  // If work type is "private", only owner can use commands
  if (workType === "private") {
    console.log(`Command blocked: WORK_TYPE is private for ${sanitized}`);
    return;
  }
  
  // If work type is "inbox", block commands in groups
  if (isGroup && workType === "inbox") {
    console.log(`Command blocked: WORK_TYPE is inbox but message is from group for ${sanitized}`);
    return;
  }
  
  // If work type is "groups", block commands in private chats
  if (!isGroup && workType === "groups") {
    console.log(`Command blocked: WORK_TYPE is groups but message is from private chat for ${sanitized}`);
    return;
  }
  
  // If work type is "public", allow all (no restrictions needed)
}
// ========== END WORK TYPE RESTRICTIONS ==========

      switch (command) {
      case 'sketch':
case 'drawing': {
    const axios = require('axios');
    const FormData = require('form-data');
    const { downloadContentFromMessage } = require('baileys');
    let q = msg.quoted ? msg.quoted : msg;
    let mime = (q.msg || q).mimetype || '';
    
    if (!mime.startsWith('image/')) {
        return await socket.sendMessage(sender, { 
            text: "🚫 *Please reply to an image or send an image with the command.*" 
        }, { quoted: msg });
    }

    let loadingKey; 

    try {
        const sentMsg = await socket.sendMessage(sender, { text: "🎨 *Converting to Sketch...*" }, { quoted: msg });
        loadingKey = sentMsg.key;
        let media = await q.download();
        await socket.sendMessage(sender, { text: "⬆️ *Uploading to Cloud...*", edit: loadingKey });
        
        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", media, "image.jpg");

        const uploadRes = await axios.post("https://catbox.moe/user/api.php", form, {
            headers: form.getHeaders()
        });
        
        const imageUrl = uploadRes.data.trim();
        await socket.sendMessage(sender, { text: "✏️ *Drawing the Sketch...*", edit: loadingKey });

        // API Request (JSON Response බලාපොරොත්තුවෙන්)
        const apiUrl = `https://www.movanest.xyz/v2/sketch?image_url=${encodeURIComponent(imageUrl)}`;
        
        // මුලින්ම JSON එක ගන්නවා
        const apiResponse = await axios.get(apiUrl);
        
        // JSON එක ඇතුලේ තියෙන ෆොටෝ ලින්ක් එක ගන්නවා
        if(apiResponse.data && apiResponse.data.status && apiResponse.data.results && apiResponse.data.results.resultUrl) {
            const finalImageUrl = apiResponse.data.results.resultUrl;

            // දැන් ඒ ලින්ක් එකෙන් ෆොටෝ එක ඩවුන්ලෝඩ් කරනවා
            const sketchImage = await axios.get(finalImageUrl, { responseType: 'arraybuffer' });

            await socket.sendMessage(sender, { 
                image: sketchImage.data, 
                caption: "✅ *Sketch Created Successfully!*\n\n> 🤖 DTEC MINI V2" 
            }, { quoted: msg });

            await socket.sendMessage(sender, { text: "✨ *Process Completed!*", edit: loadingKey });
        } else {
            throw new Error("API Response Error");
        }

    } catch (err) {
        console.error(err);
        if (loadingKey) {
            await socket.sendMessage(sender, { text: `❌ *Error:* ${err.message}`, edit: loadingKey });
        } else {
            await socket.sendMessage(sender, { text: "❌ *Error Occurred!*" }, { quoted: msg });
        }
    }
    break;
}
	
case 'setting': {
  await socket.sendMessage(sender, { react: { text: '🏹', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    // Permission check - only session owner or bot owner can change settings
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETTING1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change settings.' }, { quoted: shonux });
    }

    // Get current settings from MongoDB
    const currentConfig = await loadUserConfigFromMongo(sanitized) || {};
    const botName = currentConfig.botName || BOT_NAME_FANCY;
    const prefix = currentConfig.PREFIX || config.PREFIX;

    const settingOptions = {
      name: 'single_select',
      paramsJson: JSON.stringify({
        title: `🔧 ${botName} SETTINGS`,
        sections: [
          {
            title: '◉ ᴛʏᴘᴇ  ᴏꜰ ᴡᴏʀᴋ',
            rows: [
              { title: '𝐏𝚄𝙱𝙻𝙸𝙲', description: '', id: `${prefix}wtype public` },
              { title: '𝐎𝙽𝙻𝚈 𝐆𝚁𝙾𝚄𝙿', description: '', id: `${prefix}wtype groups` },
              { title: '𝐎𝙽𝙻𝚈 𝐈𝙽𝙱𝙾𝚇', description: '', id: `${prefix}wtype inbox` },
              { title: '𝐎𝙽𝙻𝚈 𝐏𝚁𝙸𝚅𝙰𝚃𝙴', description: '', id: `${prefix}wtype private` },
            ],
          },
          {
            title: '◉ ꜰᴀᴋᴇ ᴛʏᴘɪɴɢ',
            rows: [
              { title: '𝐀𝚄𝚃𝙾 𝐓𝚈𝙿𝙸𝙽𝙶 𝐎𝐍', description: '', id: `${prefix}autotyping on` },
              { title: '𝐀𝚄𝚃𝙾 𝐓𝚈𝙿𝙸𝙽𝙶 𝐎𝐅𝐅', description: '', id: `${prefix}autotyping off` },
            ],
          },
          {
            title: '◉ ꜰᴀᴋᴇ ʀᴇᴄᴏʀᴅɪɴɢ',
            rows: [
              { title: '𝐀𝚄𝚃𝙾 𝐑𝙴𝙲𝙾𝚁𝙳𝙸𝙽𝙶 𝐎𝐍', description: '', id: `${prefix}autorecording on` },
              { title: '𝐀𝚄𝚃𝙾 𝐑𝙴𝙲𝙾𝚁𝙳𝙸𝙽𝙶 𝐎𝐅𝐅', description: '', id: `${prefix}autorecording off` },
            ],
          },
          {
            title: '◉ ᴀʟʟᴡᴀʏꜱ ᴏɴʟɪɴᴇ',
            rows: [
              { title: '𝐀𝙻𝙻𝚆𝙰𝚈𝚂 𝐎𝙽𝙻𝙸𝙽𝙴 𝐎𝙽', description: '', id: `${prefix}botpresence online` },
              { title: '𝐀𝙻𝙻𝚆𝙰𝚈𝚂 𝐎𝙽𝙻𝙸𝙽𝙴 𝐎𝙵𝙵', description: '', id: `${prefix}botpresence offline` },
            ],
          },
          {
            title: '◉ ᴀᴜᴛᴏ ꜱᴇᴇɴ ꜱᴛᴀᴛᴜꜱ',
            rows: [
              { title: '𝐒𝚃𝙰𝚃𝚄𝚂 𝐒𝙴𝙴𝙽 𝐎𝙽', description: '', id: `${prefix}rstatus on` },
              { title: '𝐒𝚃𝙰𝚃𝚄𝚂 𝐒𝙴𝙴𝙽 𝐎𝙵𝙵', description: '', id: `${prefix}rstatus off` },
            ],
          },
          {
            title: '◉ ᴀᴜᴛᴏ ʀᴇᴀᴄᴛ ꜱᴛᴀᴛᴜꜱ',
            rows: [
              { title: '𝐒𝚃𝙰𝚃𝚄𝚂 𝐑𝙴𝙰𝙲𝚃 𝐎𝙽', description: '', id: `${prefix}arm on` },
              { title: '𝐒𝚃𝙰𝚃𝚄𝚂 𝐑𝙴𝙰𝙲𝚃 𝐎𝙵𝙵', description: '', id: `${prefix}arm off` },
            ],
          }, 
          {
            title: '◉ ᴀᴜᴛᴏ ʀᴇᴊᴇᴄᴛ ᴄᴀʟʟꜱ',
            rows: [
              { title: '𝐀𝚄𝚃𝙾 𝐑𝙴𝙹𝙴𝙲𝚃 𝐂𝙰𝙻𝙻 𝐎𝙽', description: '', id: `${prefix}creject on` },
              { title: '𝐀𝚄𝚃𝙾 𝐑𝙴𝙹𝙴𝙲𝚃 𝐂𝙰𝙻𝙻 𝐎𝙵𝙵', description: '', id: `${prefix}creject off` },
            ],
          },
          {
            title: '◉ ᴀᴜᴛᴏ ʀᴇᴀᴅ ᴍᴇꜱꜱᴀɢᴇꜱ',
            rows: [
              { title: '𝐑𝙴𝙰𝙳 𝐀𝙻𝙻 𝐌𝙰𝚂𝚂𝙰𝙶𝙴𝚂', description: '', id: `${prefix}mread all` },
              { title: '𝐑𝙴𝙰𝙳 𝐀𝙻𝙻 𝐌𝙰𝚂𝚂𝙰𝙶𝙴𝚂 𝐂𝙾𝙼𝙼𝙰𝙽𝙳𝚂', description: '', id: `${prefix}mread cmd` },
              { title: '𝐃𝙾𝙽𝚃 𝐑𝙴𝙰𝙳 𝐀𝙽𝚈 𝐌𝙰𝚂𝚂𝙰𝙶𝙴', description: '', id: `${prefix}mread off` },
            ],
          },
        ],
      }),
    };

    await socket.sendMessage(sender, {
      headerType: 1,
      viewOnce: true,
      image: { url: currentConfig.logo || config.RCD_IMAGE_PATH },
      caption: `╭───〔 🛠️ 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒 🛠️ 〕───╮
│
│🔹 𝐖ᴏʀᴋ 𝐓𝐲ᴘᴇ : ${currentConfig.WORK_TYPE || 'public'}
│🔹 𝐏ʀᴇꜱᴇɴᴄᴇ : ${currentConfig.PRESENCE || 'available'}
│
│👁️ 𝐒ᴛᴀᴛᴜꜱ 𝐒ᴇᴇɴ : ${currentConfig.AUTO_VIEW_STATUS || 'true'}
│❤️ 𝐒ᴛᴀᴛᴜꜱ 𝐋ɪᴋᴇ : ${currentConfig.AUTO_LIKE_STATUS || 'true'}
│
│🚫 𝐀ɴᴛɪ 𝐂ᴀʟʟ : ${currentConfig.ANTI_CALL || 'off'}
│📖 𝐀ᴜᴛᴏ 𝐑ᴇᴀᴅ : ${currentConfig.AUTO_READ_MESSAGE || 'off'}
│
│🎤 𝐀ᴜᴛᴏ 𝐑ᴇᴄ : ${currentConfig.AUTO_RECORDING || 'false'}
│⌨️ 𝐀ᴜᴛᴏ 𝐓ʏᴘᴇ : ${currentConfig.AUTO_TYPING || 'false'}
│
╰─────────────────────╯`,
      buttons: [
        {
          buttonId: 'settings_action',
          buttonText: { displayText: '⚙️ 𝐂𝙾𝙽𝙵𝙸𝙶𝚄𝚁𝙴 𝐒𝙴𝚃𝚃𝙸𝙽𝙶𝚂' },
          type: 4,
          nativeFlowInfo: settingOptions,
        },
      ],
      footer: botName,
    }, { quoted: msg });
  } catch (e) {
    console.error('Setting command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETTING2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error loading settings!*" }, { quoted: shonux });
  }
  break;
}

case 'wtype': {
  await socket.sendMessage(sender, { react: { text: '🛠️', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_WTYPE1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change work type.' }, { quoted: shonux });
    }
    
    let q = args[0];
    const settings = {
      groups: "groups",
      inbox: "inbox", 
      private: "private",
      public: "public"
    };
    
    if (settings[q]) {
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      userConfig.WORK_TYPE = settings[q];
      await setUserConfigInMongo(sanitized, userConfig);
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_WTYPE2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: `✅ *Your Work Type updated to: ${settings[q]}*` }, { quoted: shonux });
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_WTYPE3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: "❌ *Invalid option!*\n\nAvailable options:\n- public\n- groups\n- inbox\n- private" }, { quoted: shonux });
    }
  } catch (e) {
    console.error('Wtype command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_WTYPE4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your work type!*" }, { quoted: shonux });
  }
  break;
}

case 'botpresence': {
  await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PRESENCE1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change bot presence.' }, { quoted: shonux });
    }
    
    let q = args[0];
    const settings = {
      online: "available",
      offline: "unavailable"
    };
    
    if (settings[q]) {
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      userConfig.PRESENCE = settings[q];
      await setUserConfigInMongo(sanitized, userConfig);
      
      // Apply presence immediately
      await socket.sendPresenceUpdate(settings[q]);
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PRESENCE2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: `✅ *Your Bot Presence updated to: ${q}*` }, { quoted: shonux });
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PRESENCE3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: "❌ *Invalid option!*\n\nAvailable options:\n- online\n- offline" }, { quoted: shonux });
    }
  } catch (e) {
    console.error('Botpresence command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PRESENCE4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your bot presence!*" }, { quoted: shonux });
  }
  break;
}

case 'autotyping': {
  await socket.sendMessage(sender, { react: { text: '⌨️', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_TYPING1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change auto typing.' }, { quoted: shonux });
    }
    
    let q = args[0];
    const settings = { on: "true", off: "false" };
    
    if (settings[q]) {
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      userConfig.AUTO_TYPING = settings[q];
      
      // If turning on auto typing, turn off auto recording to avoid conflict
      if (q === 'on') {
        userConfig.AUTO_RECORDING = "false";
      }
      
      await setUserConfigInMongo(sanitized, userConfig);
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_TYPING2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: `✅ *Auto Typing ${q === 'on' ? 'ENABLED' : 'DISABLED'}*` }, { quoted: shonux });
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_TYPING3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: "❌ *Options:* on / off" }, { quoted: shonux });
    }
  } catch (e) {
    console.error('Autotyping error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_TYPING4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating auto typing!*" }, { quoted: shonux });
  }
  break;
}

case 'rstatus': {
  await socket.sendMessage(sender, { react: { text: '👁️', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RSTATUS1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change status seen setting.' }, { quoted: shonux });
    }
    
    let q = args[0];
    const settings = { on: "true", off: "false" };
    
    if (settings[q]) {
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      userConfig.AUTO_VIEW_STATUS = settings[q];
      await setUserConfigInMongo(sanitized, userConfig);
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RSTATUS2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: `✅ *Your Auto Status Seen ${q === 'on' ? 'ENABLED' : 'DISABLED'}*` }, { quoted: shonux });
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RSTATUS3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: "❌ *Invalid option!*\n\nAvailable options:\n- on\n- off" }, { quoted: shonux });
    }
  } catch (e) {
    console.error('Rstatus command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RSTATUS4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your status seen setting!*" }, { quoted: shonux });
  }
  break;
}

case 'creject': {
  await socket.sendMessage(sender, { react: { text: '📞', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CREJECT1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change call reject setting.' }, { quoted: shonux });
    }
    
    let q = args[0];
    const settings = { on: "on", off: "off" };
    
    if (settings[q]) {
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      userConfig.ANTI_CALL = settings[q];
      await setUserConfigInMongo(sanitized, userConfig);
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CREJECT2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: `✅ *Your Auto Call Reject ${q === 'on' ? 'ENABLED' : 'DISABLED'}*` }, { quoted: shonux });
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CREJECT3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: "❌ *Invalid option!*\n\nAvailable options:\n- on\n- off" }, { quoted: shonux });
    }
  } catch (e) {
    console.error('Creject command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CREJECT4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your call reject setting!*" }, { quoted: shonux });
  }
  break;
}

case 'arm': {
  await socket.sendMessage(sender, { react: { text: '❤️', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ARM1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change status react setting.' }, { quoted: shonux });
    }
    
    let q = args[0];
    const settings = { on: "true", off: "false" };
    
    if (settings[q]) {
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      userConfig.AUTO_LIKE_STATUS = settings[q];
      await setUserConfigInMongo(sanitized, userConfig);
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ARM2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: `✅ *Your Auto Status React ${q === 'on' ? 'ENABLED' : 'DISABLED'}*` }, { quoted: shonux });
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ARM3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: "❌ *Invalid option!*\n\nAvailable options:\n- on\n- off" }, { quoted: shonux });
    }
  } catch (e) {
    console.error('Arm command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ARM4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your status react setting!*" }, { quoted: shonux });
  }
  break;
}

case 'mread': {
  await socket.sendMessage(sender, { react: { text: '📖', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_MREAD1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change message read setting.' }, { quoted: shonux });
    }
    
    let q = args[0];
    const settings = { all: "all", cmd: "cmd", off: "off" };
    
    if (settings[q]) {
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      userConfig.AUTO_READ_MESSAGE = settings[q];
      await setUserConfigInMongo(sanitized, userConfig);
      
      let statusText = "";
      switch (q) {
        case "all":
          statusText = "READ ALL MESSAGES";
          break;
        case "cmd":
          statusText = "READ ONLY COMMAND MESSAGES"; 
          break;
        case "off":
          statusText = "DONT READ ANY MESSAGES";
          break;
      }
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_MREAD2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: `✅ *Your Auto Message Read: ${statusText}*` }, { quoted: shonux });
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_MREAD3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: "❌ *Invalid option!*\n\nAvailable options:\n- all\n- cmd\n- off" }, { quoted: shonux });
    }
  } catch (e) {
    console.error('Mread command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_MREAD4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your message read setting!*" }, { quoted: shonux });
  }
  break;
}

case 'autorecording': {
  await socket.sendMessage(sender, { react: { text: '🎥', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RECORDING1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change auto recording.' }, { quoted: shonux });
    }
    
    let q = args[0];
    
    if (q === 'on' || q === 'off') {
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      userConfig.AUTO_RECORDING = (q === 'on') ? "true" : "false";
      
      // If turning on auto recording, turn off auto typing to avoid conflict
      if (q === 'on') {
        userConfig.AUTO_TYPING = "false";
      }
      
      await setUserConfigInMongo(sanitized, userConfig);
      
      // Immediately stop any current recording if turning off
      if (q === 'off') {
        await socket.sendPresenceUpdate('available', sender);
      }
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RECORDING2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: `✅ *Auto Recording ${q === 'on' ? 'ENABLED' : 'DISABLED'}*` }, { quoted: shonux });
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RECORDING3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: "❌ *Invalid! Use:* .autorecording on/off" }, { quoted: shonux });
    }
  } catch (e) {
    console.error('Autorecording error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RECORDING4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating auto recording!*" }, { quoted: shonux });
  }
  break;
}
 case 'removebg':
case 'rmbg': {
    const axios = require('axios');
    const FormData = require('form-data');
    const { downloadContentFromMessage } = require('baileys');
    let q = msg.quoted ? msg.quoted : msg;
    let mime = (q.msg || q).mimetype || '';
    
    if (!mime.startsWith('image/')) {
        return await socket.sendMessage(sender, { 
            text: "🚫 *Please reply to an image or send an image with the command.*" 
        }, { quoted: msg });
    }

    let loadingKey; 

    try {
        const sentMsg = await socket.sendMessage(sender, { text: "🖌️ *Analyzing Image...*" }, { quoted: msg });
        loadingKey = sentMsg.key;
        let media = await q.download();
        await socket.sendMessage(sender, { text: "⬆️ *Uploading to Cloud...*", edit: loadingKey });
        
        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", media, "image.jpg");

        const uploadRes = await axios.post("https://catbox.moe/user/api.php", form, {
            headers: form.getHeaders()
        });
        
        const imageUrl = uploadRes.data.trim();
        await socket.sendMessage(sender, { text: "✂️ *Removing Background...*", edit: loadingKey });

        const apiUrl = `https://www.movanest.xyz/v2/removebg?image_url=${encodeURIComponent(imageUrl)}`;
        
        const rbgResponse = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        await socket.sendMessage(sender, { 
            image: rbgResponse.data, 
            caption: "✅ *Background Removed Successfully!*\n\n> 🤖 DTEC MINI V2" 
        }, { quoted: msg });
        await socket.sendMessage(sender, { text: "✨ *Process Completed!*", edit: loadingKey });

    } catch (err) {
        console.error(err);
        if (loadingKey) {
            await socket.sendMessage(sender, { text: `❌ *Error:* ${err.message}`, edit: loadingKey });
        } else {
            await socket.sendMessage(sender, { text: "❌ *Error Occurred!*" }, { quoted: msg });
        }
    }
    break;
}
case 'prefix': {
  await socket.sendMessage(sender, { react: { text: '🔣', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PREFIX1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change prefix.' }, { quoted: shonux });
    }
    
    let newPrefix = args[0];
    if (!newPrefix || newPrefix.length > 2) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PREFIX2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: "❌ *Invalid prefix!*\nPrefix must be 1-2 characters long." }, { quoted: shonux });
    }
    
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    userConfig.PREFIX = newPrefix;
    await setUserConfigInMongo(sanitized, userConfig);
    
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PREFIX3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `✅ *Your Prefix updated to: ${newPrefix}*` }, { quoted: shonux });
  } catch (e) {
    console.error('Prefix command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PREFIX4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your prefix!*" }, { quoted: shonux });
  }
  break;
}

case 'settings': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETTINGS1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can view settings.' }, { quoted: shonux });
    }

    const currentConfig = await loadUserConfigFromMongo(sanitized) || {};
    const botName = currentConfig.botName || BOT_NAME_FANCY;
    
    const settingsText = `
*╭─「 𝗖𝚄𝚁𝚁𝙴𝙽𝚃 𝗦𝙴𝚃𝚃𝙸𝙽𝙶𝚂 」─●●➤*  
*│ 🔧  𝐖𝙾𝚁𝙺 𝐓𝚈𝙿𝙴:* ${currentConfig.WORK_TYPE || 'public'}
*│ 🎭  𝐏𝚁𝙴𝚂𝙴𝙽𝚂𝙴:* ${currentConfig.PRESENCE || 'available'}
*│ 👁️  𝐀𝚄𝚃𝙾 𝐒𝚃𝙰𝚃𝚄𝚂 𝐒𝙴𝙴𝙽:* ${currentConfig.AUTO_VIEW_STATUS || 'true'}
*│ ❤️  𝐀𝚄𝚃𝙾 𝐒𝚃𝙰𝚃𝚄𝚂 𝐑𝙴𝙰𝙲𝚃:* ${currentConfig.AUTO_LIKE_STATUS || 'true'}
*│ 📞  𝐀𝚄𝚃𝙾 𝐑𝙴𝙹𝙴𝙲𝚃 𝐂𝙰𝙻𝙻:* ${currentConfig.ANTI_CALL || 'off'}
*│ 📖  𝐀𝚄𝚃𝙾 𝐑𝙴𝙰𝙳 𝐌𝙴𝚂𝚂𝙰𝙶𝙴:* ${currentConfig.AUTO_READ_MESSAGE || 'off'}
*│ 🎥  𝐀𝚄𝚃𝙾 𝐑𝙾𝙲𝙾𝚁𝙳𝙸𝙽𝙶:* ${currentConfig.AUTO_RECORDING || 'false'}
*│ ⌨️  𝐀𝚄𝚃𝙾 𝐓𝚈𝙿𝙸𝙽𝙶:* ${currentConfig.AUTO_TYPING || 'false'}
*│ 🔣  𝐏𝚁𝙴𝙵𝙸𝚇:* ${currentConfig.PREFIX || '.'}
*│ 🎭  𝐒𝚃𝙰𝚃𝚄𝚂 𝐄𝙼𝙾𝙹𝙸𝚂:* ${(currentConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI).join(' ')}
*╰──────────────●●➤*

*𝐔se ${currentConfig.PREFIX || '.'}𝐒etting 𝐓o 𝐂hange 𝐒ettings 𝐕ia 𝐌enu*
    `;

    await socket.sendMessage(sender, {
      image: { url: currentConfig.logo || config.RCD_IMAGE_PATH },
      caption: settingsText
    }, { quoted: msg });
    
  } catch (e) {
    console.error('Settings command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETTINGS2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error loading settings!*" }, { quoted: shonux });
  }
  break;
}


case 'emojis': {
  await socket.sendMessage(sender, { react: { text: '🎭', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    // Permission check - only session owner or bot owner can change emojis
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change status reaction emojis.' }, { quoted: shonux });
    }
    
    let newEmojis = args;
    
    if (!newEmojis || newEmojis.length === 0) {
      // Show current emojis if no args provided
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      const currentEmojis = userConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI;
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      
      return await socket.sendMessage(sender, { 
        text: `🎭 *Current Status Reaction Emojis:*\n\n${currentEmojis.join(' ')}\n\nUsage: \`.emojis 😀 😄 😊 🎉 ❤️\`` 
      }, { quoted: shonux });
    }
    
    // Validate emojis (basic check)
    const invalidEmojis = newEmojis.filter(emoji => !/\p{Emoji}/u.test(emoji));
    if (invalidEmojis.length > 0) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { 
        text: `❌ *Invalid emojis detected:* ${invalidEmojis.join(' ')}\n\nPlease use valid emoji characters only.` 
      }, { quoted: shonux });
    }
    
    // Get user-specific config from MongoDB
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    
    // Update ONLY this user's emojis
    userConfig.AUTO_LIKE_EMOJI = newEmojis;
    
    // Save to MongoDB
    await setUserConfigInMongo(sanitized, userConfig);
    
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    
    await socket.sendMessage(sender, { 
      text: `✅ *Your Status Reaction Emojis Updated!*\n\nNew emojis: ${newEmojis.join(' ')}\n\nThese emojis will be used for your automatic status reactions.` 
    }, { quoted: shonux });
    
  } catch (e) {
    console.error('Emojis command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS5" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your status reaction emojis!*" }, { quoted: shonux });
  }
  break;
}
 
case 'menu': {
  try { await socket.sendMessage(sender, { react: { text: "💎", key: msg.key } }); } catch(e){}

  try {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // load per-session config (logo, botName)
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; }
    catch(e){ console.warn('menu: failed to load config', e); userCfg = {}; }

    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥';

    // 🔹 Fake contact for Meta AI mention
    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: true,
            id: "META_AI_FAKE_ID_MENU"
        },
        message: {
            contactMessage: {
                displayName: title,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };
	  const date = new Date();
    const slstDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
    const formattedTime = slstDate.toLocaleTimeString();
    const hour = slstDate.getHours();
    const greetings = hour < 12 ? 'ɢᴏᴏᴅ ᴍᴏʀɴɪɴɢ..🌅' :
                      hour < 17 ? 'ɢᴏᴏᴅ ᴀꜰᴛᴇʀɴᴏᴏɴ..🌞' :
                      hour < 20 ? 'ɢᴏᴏᴅ ᴇᴠᴇɴɪɴɢ..🌆' : 'ɢᴏᴏᴅ ɴɪɢʜᴛ..🌙';
	const nuroweb = 'yasasdileepa.site/mini';
    const text = `
╭───〔 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥 〕───
┃👋 HI DTEC MINI BOT USER
╰──────────────────────
╭──「 ✨ 𝐁𝐎𝐓 𝐈𝐍𝐅𝐎 ✨ 」──
┃🤖 ɴᴀᴍᴇ : 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥
┃👑 ᴏᴡɴᴇʀ : YASAS DILEEPA
┃👋 ɢʀᴇᴇᴛ : ${greetings}
╰──────────────────────
╭──「 📅 𝐃𝐀𝐓𝐄 & 𝐓𝐈𝐌𝐄 ⌚ 」──
┃📆 ᴅᴀᴛᴇ : ${slstDate}
┃🕜 ᴛɪᴍᴇ : ${formattedTime}
╰──────────────────────
🌍 ᴡᴇʙ : ${nuroweb}
> *🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥*
`.trim();
	  
	  /*let vpsOptions = [
        { title: "📥 DOWNLOAD MENU", description: "© ɢᴇᴛ ᴅᴏᴡɴʟᴏᴀᴅ ᴍᴇɴᴜ", buttonId: `${config.PREFIX}download` },
		  { title: "🛠️ TOOL MENU", description: "© ɢᴇᴛ ᴛᴏᴏʟ ᴍᴇɴᴜ", buttonId: `${config.PREFIX}tool` },
		  { title: "🚀 OTHER MENU", description: "© ɢᴇᴛ ᴏᴛʜᴇʀᴇ ᴍᴇɴᴜ", buttonId: `${config.PREFIX}other` },
		  { title: "⚙️ SETTINGS MENU", description: "© ɢᴇᴛ ꜱᴇᴛᴛɪɴɢꜱ ᴍᴇɴᴜ", buttonId: `${config.PREFIX}settings` },
        { title: "👑 OWNER", description: "© ɢᴇᴛ ᴏᴡɴᴇʀ", buttonId: `${config.PREFIX}owner` }
    ];*/
	  let rows = [

  {
    title: "JOIN CHANNEL",
    description: "Follow our WhatsApp Channel",
    id: "https://whatsapp.com/channel/0029Vb7NcUw2phHR4mDZJ51g"
  },
  {
    title: "📥 𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳 𝙼𝙴𝙽𝚄",
    description: "DOWANLOAD",
    id: `${config.PREFIX}download`
  },
  {
    title: "🛠️ ᴛᴏᴏʟ ᴍᴇɴᴜ",
    description: "TOOLS",
    id: `${config.PREFIX}tool`
  },
  {
    title: "🚀 𝙾𝚃𝙷𝙴𝚁 𝙼𝙴𝙽𝚄",
    description: ".OTHER MENU",
    id: `${config.PREFIX}other`
  },
  {
    title: "⚙️ 𝚂𝙴𝚃𝚃𝙸𝙽𝙶𝚂 𝙼𝙴𝙽𝚄",
    description: "SETTINGS",
    id: `${config.PREFIX}settings`
  },
  {
    title: "👑 OWNER",
    description: "OWNER",
    id: `${config.PREFIX}owner`
  }
];

   let buttonSections = [
        {
            title: "ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 ᴍᴇɴᴜ ᴄᴏᴍᴍᴀɴᴅꜱ",
            highlight_label: "ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2",
            rows: rows
        }
    ];

    let buttons = [
        {
            buttonId: "action",
            buttonText: { displayText: "Sᴇʟᴇᴄᴛ Mᴇɴᴜ" },
            type: 4,
            nativeFlowInfo: {
                name: "single_select",
                paramsJson: JSON.stringify({
                    title: "ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2",
                    sections: buttonSections
                })
            }
        },
    ];
    const MenuImg = 'https://files.catbox.moe/xyeod7.jpeg';
    const useLogo = userCfg.logo || MenuImg;

    await socket.sendMessage(sender, {
        buttons,
        headerType: 1,
        viewOnce: true,
        caption: text,
        image:{ url:MenuImg },
        contextInfo: {
            mentionedJid: [sender], 
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363419758690313@newsletter',
                newsletterName: 'Yasas Dileepa',
                serverMessageId: 143
            }
        }
    }, { quoted: shonux });
  } catch (err) {
    console.error('menu command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show menu.'+err }, { quoted: msg }); } catch(e){}
  }
  break;
}

// ==================== DOWNLOAD MENU (100PB Style) ====================
case 'download': {
    try { 
        // 1. React to the message
        await socket.sendMessage(sender, { react: { text: "📂", key: msg.key } }); 
    } catch(e){}

    try {

        let userCfg = {};
        try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
        const botName = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥';
        const fakeFileContent = Buffer.from("🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥 \n\n📂 SIZE: 100PB \n👤 ACCESS: GRANTED\n📅 DATE: " + new Date().toLocaleString(), 'utf-8');
        const fakeFileSize = "99999999999999999"; 
        const menuText = `
╭═══〔 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥 〕═══
┃
┃👤 𝐔𝐬𝐞𝐫: @${sender.split('@')[0]}
┃
╰══════════════════════════
╭───〔 🎵 𝐌𝐔𝐒𝐈𝐂 𝐙𝐎𝐍𝐄 〕───
┃🎧 ${config.PREFIX}song [song name]
┃🎧 ${config.PREFIX}csong [song name <jid>]
┃🎼 ${config.PREFIX}ytmp3 [url]
┃🔔 ${config.PREFIX}ringtone [name]
╰─────────────────────
╭───〔 🎬 𝐕𝐈𝐃𝐄𝐎 𝐙𝐎𝐍𝐄 〕───
┃📽️ ${config.PREFIX}video [name]
┃🎞️ ${config.PREFIX}ytmp4 [url]
┃📱 ${config.PREFIX}tiktok [url]
┃📘 ${config.PREFIX}fb [url]
┃📸 ${config.PREFIX}ig [url]
┃🔞 ${config.PREFIX}xnxx [search]
┃🔞 ${config.PREFIX}xham [search]
┃🔞 ${config.PREFIX}xvideo [search]
╰─────────────────────
╭───〔 📦 𝐀𝐏𝐏 & 𝐅𝐈𝐋𝐄𝐒 〕───
┃📱 ${config.PREFIX}apk [app name]
┃☁️ ${config.PREFIX}gdrive [url]
┃📁 ${config.PREFIX}mediafire [url]
╰─────────────────────
> 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥
`.trim();

     
        await socket.sendMessage(sender, {
            document: fakeFileContent, 
            mimetype: 'application/vnd.rar',
            fileName: 'ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2.pdf', 
            fileLength: fakeFileSize, 
            pageCount: 2025, 
            caption: menuText, 
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                externalAdReply: {
                    title: "🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥",
                    body: "ᴄʟɪᴄᴋ ᴛᴏ ᴊᴏɪɴ ᴏᴜʀ ᴄʜᴀɴɴᴇʟ",
                    thumbnailUrl: "https://files.catbox.moe/xyeod7.jpeg",
                    sourceUrl: "https://whatsapp.com/channel/0029Vb7NcUw2phHR4mDZJ51g", 
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

    } catch (err) {
        console.error('Download menu error:', err);
        try { await socket.sendMessage(sender, { text: '❌ Failed to load menu.' }, { quoted: msg }); } catch(e){}
    }
    break;
}

// ==================== TOOL MENU (100PB Style - Updated) ====================
case 'tool': {
    try { 
        // 1. React with an emoji
        await socket.sendMessage(sender, { react: { text: "🛠️", key: msg.key } }); 
    } catch(e){}

    try {
        // --- CONFIGURATION ---
        let userCfg = {};
        try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
        const botName = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥';

        // 2. 100PB FILE TRICK
        const fakeFileSize = "999999999999999"; 
        const fakeFileContent = Buffer.from("🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥 \n\n📂 SIZE: 100PB\n📅 UPDATED: " + new Date().toLocaleString(), 'utf-8');

        // 3. MENU DESIGN
        const menuText = `
╭═══〔 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥 〕═══
┃
┃👤 𝐔𝐬𝐞𝐫: @${sender.split('@')[0]}
┃
╰══════════════════════════
╭───〔 🤖 𝐀𝐈 & 𝐂𝐇𝐀𝐓 𝐁𝐎𝐓 〕───
┃🧠 ${config.PREFIX}ai [message]
┃🎨 ${config.PREFIX}aiimg [prompt]
┃🖼️ ${config.PREFIX}aiimg2 [prompt]
╰─────────────────────
╭───〔 🎨 𝐅𝐀𝐍𝐂𝐘 & 𝐒𝐓𝐘𝐋𝐄 〕───
┃✍️ ${config.PREFIX}font [text]
╰─────────────────────
╭───〔 👤 𝐔𝐒𝐄𝐑 𝐓𝐎𝐎𝐋𝐒 〕───
┃🖼️ ${config.PREFIX}getdp [number]
┃💾 ${config.PREFIX}save [reply status]
┃💾 ${config.PREFIX}vv [reply view once massage]
┃📍 ${config.PREFIX}ping
╰─────────────────────
> 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥
`.trim();

        // 4. SEND THE DOCUMENT MESSAGE WITH YOUR LINKS
        await socket.sendMessage(sender, {
            document: fakeFileContent, 
            mimetype: 'application/zip', 
            fileName: 'ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2.pdf', 
            fileLength: fakeFileSize, 
            pageCount: 2025, 
            caption: menuText, 
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                externalAdReply: {
                    title: "🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥", // ඔයා දුන්න Title එක
                    body: "ᴄʟɪᴄᴋ ᴛᴏ ᴊᴏɪɴ ᴏᴜʀ ᴄʜᴀɴɴᴇʟ", // ඔයා දුන්න Body එක
                    thumbnailUrl: "https://files.catbox.moe/xyeod7.jpeg", // ඔයා දුන්න Image එක
                    sourceUrl: "https://whatsapp.com/channel/0029Vb7NcUw2phHR4mDZJ51g", // ඔයා දුන්න Channel Link එක
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

    } catch (err) {
        console.error('Tool command error:', err);
        try { await socket.sendMessage(sender, { text: '❌ Failed to show tool menu.' }, { quoted: msg }); } catch(e){}
    }
    break;
}
// ==================== OTHER MENU (100PB Style) ====================
case 'other': {
    try { 
        // 1. React with an emoji
        await socket.sendMessage(sender, { react: { text: "⚙️", key: msg.key } }); 
    } catch(e){}

    try {
        // --- CONFIGURATION ---
        let userCfg = {};
        try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
        const botName = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥';

        // 2. 100PB FILE TRICK
        const fakeFileSize = "999999999999999"; 
        const fakeFileContent = Buffer.from("🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥 \n\n📂 SIZE: 100PB\n📅 UPDATED: " + new Date().toLocaleString(), 'utf-8');

        // 3. MENU DESIGN
        const menuText = `
╭═══〔 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥 〕═══
┃
┃👤 𝐔𝐬𝐞𝐫: @${sender.split('@')[0]}
┃
╰══════════════════════════
╭───〔 ℹ️ 𝐈𝐍𝐅𝐎 𝐙𝐎𝐍𝐄 〕───
┃🆔 ${config.PREFIX}jid
┃📢 ${config.PREFIX}cid [channel-link]
┃💻 ${config.PREFIX}system
╰─────────────────────
╭───〔 👥 𝐆𝐑𝐎𝐔𝐏 𝐙𝐎𝐍𝐄 〕───
┃📢 ${config.PREFIX}tagall [message]
┃📢 ${config.PREFIX}hidetag [message]
┃📢 ${config.PREFIX}link
┃🟢 ${config.PREFIX}online
╰─────────────────────
╭───〔 📰 𝐍𝐄𝐖𝐒 𝐙𝐎𝐍𝐄 〕───
┃🗞️ ${config.PREFIX}adanews
┃📺 ${config.PREFIX}sirasanews
┃📝 ${config.PREFIX}lankadeepanews
┃🌦️ ${config.PREFIX}gagananews
╰─────────────────────
╭───〔 ⚙️ 𝐔𝐒𝐄𝐑 & 𝐒𝐄𝐓𝐓𝐈𝐍𝐆𝐒 〕───
┃🚫 ${config.PREFIX}block / unblock
┃🔑 ${config.PREFIX}prefix
┃🎤 ${config.PREFIX}autorecording
┃📖 ${config.PREFIX}mread
┃📞 ${config.PREFIX}creject
┃⌨️ ${config.PREFIX}wtype
┃🤖 ${config.PREFIX}arm
┃👀 ${config.PREFIX}rstatus
┃👀 ${config.PREFIX}emoji
┃👻 ${config.PREFIX}botpresence
╰─────────────────────
╭───〔 🔍 𝐒𝐄𝐀𝐑𝐂𝐇 & 𝐂𝐇𝐄𝐂𝐊 〕───
┃🖼️ ${config.PREFIX}img [query]
┃🌐 ${config.PREFIX}google [query]
┃📶 ${config.PREFIX}ping
┃⚡ ${config.PREFIX}alive
╰─────────────────────
> 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥
`.trim();

        // 4. SEND THE DOCUMENT MESSAGE
        await socket.sendMessage(sender, {
            document: fakeFileContent, 
            mimetype: 'application/zip', // ZIP ෆයිල් එකක් වගේ පෙන්වන්න
            fileName: 'ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2.zip', 
            fileLength: fakeFileSize, 
            pageCount: 2025, 
            caption: menuText, 
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                externalAdReply: {
                    title: "🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥",
                    body: "ᴄʟɪᴄᴋ ᴛᴏ ᴊᴏɪɴ ᴏᴜʀ ᴄʜᴀɴɴᴇʟ",
                    thumbnailUrl: "https://files.catbox.moe/xyeod7.jpeg",
                    sourceUrl: "https://whatsapp.com/channel/0029Vb7NcUw2phHR4mDZJ51g",
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

    } catch (err) {
        console.error('Other command error:', err);
        try { await socket.sendMessage(sender, { text: '❌ Failed to show other menu.' }, { quoted: msg }); } catch(e){}
    }
    break;
}


        case 'ts': {
    const axios = require('axios');

    // මැසේජ් එකෙන් වචන ගන්න විදිය (Standard Way)
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    let query = q.replace(/^[.\/!]ts\s*/i, '').trim();

    if (!query) {
        return await socket.sendMessage(sender, {
            text: '❌ *කරුණාකර සෙවුම් වචනයක් ලබා දෙන්න.*\nExample: .ts sri lanka'
        }, { quoted: msg });
    }

    // 🔹 Bot Name Load Logic
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'Dtec Mini Bot'; // Default Name

    try {
        // 1. Text යවන්නෙ නැතුව React කරනවා (Professional Look)
        await socket.sendMessage(sender, { react: { text: '🔎', key: msg.key } });

        // 2. API Call
        const searchParams = new URLSearchParams({ keywords: query, count: '10', cursor: '0', HD: '1' });
        const response = await axios.post("https://tikwm.com/api/feed/search", searchParams, {
            headers: { 'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8", 'Cookie': "current_language=en", 'User-Agent': "Mozilla/5.0" }
        });

        const videos = response.data?.data?.videos;
        if (!videos || videos.length === 0) {
            return await socket.sendMessage(sender, { text: '⚠️ කිසිදු වීඩියෝවක් හමු නොවීය.' }, { quoted: msg });
        }

        // Limit Results (වැඩිය යවන්න එපා, 3-5 හොඳයි)
        const limit = 5; 
        const results = videos.slice(0, limit);

        // 3. වීඩියෝ යැවීම (No "Downloading..." text)
        for (let i = 0; i < results.length; i++) {
            const v = results[i];
            const videoUrl = v.play || v.download || null;
            
            if (!videoUrl) continue;

            // Caption එක ලස්සනට හදමු
            const desc = `
🔥 *TIKTOK SEARCH* 📝 *Title:* ${v.title || 'Unknown'}
👤 *Author:* ${v.author?.nickname || 'Unknown'}
❤️ *Likes:* ${v.digg_count || 0}
⏱️ *Duration:* ${v.duration}s

> ${botName}`;

            await socket.sendMessage(sender, {
                video: { url: videoUrl },
                caption: desc,
                // මේකෙන් තමයි ලස්සනට පේන්නෙ (External Ad Reply)
                contextInfo: {
                    externalAdReply: {
                        title: v.title || "TikTok Search",
                        body: botName,
                        thumbnailUrl: v.cover, // වීඩියෝ එකේ කවර් එක
                        mediaType: 1,
                        renderLargerThumbnail: true,
                        sourceUrl: "https://tiktok.com" 
                    }
                }
            }, { quoted: msg });
        }
        
        // ඉවර වුනාම හරි ලකුණක්
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('TikTok Search Error:', err);
        await socket.sendMessage(sender, { text: `❌ Error: ${err.message}` }, { quoted: msg });
    }

    break;
}
// ==================== MAIN ADVICE SELECTION ====================
case 'help':
case 'rules': {
  try { await socket.sendMessage(sender, { react: { text: "⚖️", key: msg.key } }); } catch(e){}

  try {
    // Config & Time
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '© 𝐃𝐓𝐄𝐂 𝐌𝐈𝐍𝐈 𝐕𝟏';

    const curHr = new Date().getHours();
    const greetings = curHr < 12 ? '𝐆𝐨𝐨𝐝 𝐌𝐨𝐫𝐧𝐢𝐧𝐠 ⛅' : curHr < 18 ? '𝐆𝐨𝐨𝐝 𝐀𝐟𝐭𝐞𝐫𝐧𝐨𝐨𝐧 🌞' : '𝐆𝐨𝐨𝐝 𝐄𝐯𝐞𝐧𝐢𝐧𝐠 🌙';

    // Fake Contact
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_INTRO" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nEND:VCARD` } }
    };

    // Intro Text
    const text = `
👋 ${greetings}

╭───❮ ⚖️ 𝐁𝐎𝐓 𝐈𝐍𝐓𝐑𝐎𝐃𝐔𝐂𝐓𝐈𝐎𝐍 ❯───╮
│
│ 🤖 *DTEC MINI* is a multi-functional
│ WhatsApp User Bot designed to make
│ your daily tasks easier.
│
│ 🚀 𝐅𝐞𝐚𝐭𝐮𝐫𝐞𝐬:
│ ➜ Song & Video Downloading
│ ➜ Social Media Downloaders
│ ➜ Group Management Tools
│ ➜ AI Chat Capabilities
│
╰───────────────────────💠

📢 *Please select your language to read the Usage Policy & Rules:*
📢 *කරුණාකර නීති කියවීමට ඔබගේ භාෂාව තෝරන්න:*

> *𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐃𝐓𝐄𝐂 𝐌𝐈𝐍𝐈 𝐕𝟏*
`.trim();

    // Language Buttons
    const buttons = [
      { buttonId: `${config.PREFIX}rule_sinhala`, buttonText: { displayText: "🇱🇰 𝐒𝐈𝐍𝐇𝐀𝐋𝐀" }, type: 1 },
      { buttonId: `${config.PREFIX}rule_tamil`, buttonText: { displayText: "🇮🇳 𝐓𝐀𝐌𝐈𝐋" }, type: 1 },
      { buttonId: `${config.PREFIX}rule_english`, buttonText: { displayText: "🇬🇧 𝐄𝐍𝐆𝐋𝐈𝐒𝐇" }, type: 1 }
    ];

    // Image
    const defaultImg = 'https://files.catbox.moe/ir37re.png'; 
    const useLogo = userCfg.logo || defaultImg;
    let imagePayload = String(useLogo).startsWith('http') ? { url: useLogo } : fs.readFileSync(useLogo);

    await socket.sendMessage(sender, {
      document: imagePayload,
      mimetype: 'application/pdf',
      fileName: `𝐃𝐓𝐄𝐂 𝐈𝐍𝐓𝐑𝐎𝐃𝐔𝐂𝐓𝐈𝐎𝐍 ⚖️`,
      pageCount: 1,
      caption: text,
      contextInfo: {
          externalAdReply: {
              title: "⚖️ 𝐒𝐄𝐋𝐄𝐂𝐓 𝐋𝐀𝐍𝐆𝐔𝐀𝐆𝐄",
              body: "Select language to view rules",
              sourceUrl: 'https://yasasdileepa.zone.id',
              mediaType: 1,
              renderLargerThumbnail: true,
              thumbnailUrl: useLogo 
          }
      },
      buttons,
      headerType: 6
    }, { quoted: shonux });

  } catch (err) {
    console.error('advice main error:', err);
  }
  break;
}
// ==================== SINHALA RULES ====================
case 'rule_sinhala': {
  try { await socket.sendMessage(sender, { react: { text: "🇱🇰", key: msg.key } }); } catch(e){}
  
  const text = `
╭───❮ 🇱🇰 භාවිතා කිරී
මේ නීති ❯───╮
│
│ 🛑 බොට් නම්බර් එකට ඇමතුම් (Voice/Video)
│ ගැනීමෙන් වලකින්න.
│
│ 🛑 විධානයන් (Commands) එක දිගට Spam
│ කිරීමෙන් වලකින්න.
│
│ 🛑 18+ දේවල් හෝ නීති විරෝධී දේවල් සෙවීමට
│ මෙම බොට් භාවිතා නොකරන්න.
│
│ 🛑 යම් දෝෂයක් (Error) ආවොත් පමණක්
│ හිමිකරු (Owner) අමතන්න.
│
│ 🛑 මෙය නොමිලේ දෙන සේවාවක් බැවින්
│ ඕනෑම වෙලාවක නැවතීමට ඉඩ ඇත.
│
╰───────────────────────💠

> 💡 *නීති ගරුකව භාවිතා කරන්න!*
`.trim();

  const buttons = [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 𝐌𝐀𝐈𝐍 𝐌𝐄𝐍𝐔" }, type: 1 }];

  // Reuse image/config loading logic if needed, or keep it simple
  await socket.sendMessage(sender, {
      image: { url: 'https://files.catbox.moe/ir37re.png' }, // Simple Image msg for sub-menu or use Document if preferred
      caption: text,
      buttons,
      headerType: 1 // Image header
  }, { quoted: msg });
  break;
}
// ==================== TAMIL RULES ====================
case 'rule_tamil': {
  try { await socket.sendMessage(sender, { react: { text: "🇮🇳", key: msg.key } }); } catch(e){}

  const text = `
╭───❮ 🇮🇳 போட் விதிமுறைகள் ❯───╮
│
│ 🛑 போட் எண்ணை அழைக்க வேண்டாம்
│ (Voice/Video Call).
│
│ 🛑 கட்டளைகளை (Commands) தொடர்ந்து
│ ஸ்பேம் (Spam) செய்ய வேண்டாம்.
│
│ 🛑 18+ அல்லது சட்டவிரோத நடவடிக்கைகளுக்கு
│ இதைப் பயன்படுத்த வேண்டாம்.
│
│ 🛑 ஏதேனும் பிழை (Error) இருந்தால் மட்டும்
│ உரிமையாளரைத் தொடர்பு கொள்ளவும்.
│
│ 🛑 இது இலவச சேவையாகும், எப்போது
│ வேண்டுமானாலும் நிறுத்தப்படலாம்.
│
╰───────────────────────💠

> 💡 *விதிமுறைகளைப் பின்பற்றவும்!*
`.trim();

  const buttons = [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 𝐌𝐀𝐈𝐍 𝐌𝐄𝐍𝐔" }, type: 1 }];

  await socket.sendMessage(sender, {
      image: { url: 'https://files.catbox.moe/ir37re.png' },
      caption: text,
      buttons,
      headerType: 1
  }, { quoted: msg });
  break;
}
// ==================== ENGLISH RULES ====================
case 'rule_english': {
  try { await socket.sendMessage(sender, { react: { text: "🇬🇧", key: msg.key } }); } catch(e){}

  const text = `
╭───❮ 🇬🇧 𝐔𝐒𝐀𝐆𝐄 𝐏𝐎𝐋𝐈𝐂𝐘 ❯───╮
│
│ 🛑 Do not Voice/Video call the bot number.
│ (You will be Auto-Blocked).
│
│ 🛑 Do not SPAM commands repeatedly.
│ Wait for the response.
│
│ 🛑 Do not use this bot for 18+ content
│ or illegal activities.
│
│ 🛑 Contact the owner ONLY for bug reports
│ or technical issues.
│
│ 🛑 This service is free and may be
│ stopped at any time without notice.
│
╰───────────────────────💠

> 💡 *Use the bot wisely!*
`.trim();

  const buttons = [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 𝐌𝐀𝐈𝐍 𝐌𝐄𝐍𝐔" }, type: 1 }];

  await socket.sendMessage(sender, {
      image: { url: 'https://files.catbox.moe/ir37re.png' },
      caption: text,
      buttons,
      headerType: 1
  }, { quoted: msg });
  break;
}
case 'weather':
    try {
        // 1. Auto React (Searching...) - බොට් හොයන බව පෙන්නන්න
        await socket.sendMessage(sender, { react: { text: "🔍", key: msg.key } });

        if (!args || args.length === 0) {
            await socket.sendMessage(sender, { text: "❗ *Please provide a city name!*\nExample: `.weather Colombo`" });
            return;
        }

        const apiKey = '2d61a72574c11c4f36173b627f8cb177'; 
        const city = args.join(" ");
        const url = `http://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`;

        const { data } = await axios.get(url);

        // 2. Data Formatting (වෙලාවන් සහ විස්තර ලස්සනට හදාගැනීම)
        const sunrise = new Date(data.sys.sunrise * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const sunset = new Date(data.sys.sunset * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const weatherIcon = `https://openweathermap.org/img/wn/${data.weather[0].icon}@4x.png`;
        
        // 3. Status Emojis (කාලගුණය අනුව වෙනස් වන ඉමෝජි)
        let statusEmoji = "🌤️";
        const mainWeather = data.weather[0].main.toLowerCase();
        if (mainWeather.includes("rain")) statusEmoji = "🌧️";
        else if (mainWeather.includes("cloud")) statusEmoji = "☁️";
        else if (mainWeather.includes("clear")) statusEmoji = "☀️";
        else if (mainWeather.includes("snow")) statusEmoji = "❄️";
        else if (mainWeather.includes("thunder")) statusEmoji = "⚡";

        // 4. The Advanced Caption (ලස්සනම ඩිසයින් එක)
        const weatherInfo = `
┏━━━━━━━━━━━━━━━━━━━━━━┓
┃ 🌦️ *D-TEC WEATHER HUB* 🌦️
┗━━━━━━━━━━━━━━━━━━━━━━┛
 
🛑 *LOCATION INFO*
> 🗺️ *City:* ${data.name}, ${data.sys.country}
> 📍 *Lat/Lon:* ${data.coord.lat} / ${data.coord.lon}

🛑 *TEMPERATURE*
> 🌡️ *Current:* ${data.main.temp}°C
> 🤒 *Feels Like:* ${data.main.feels_like}°C
> 📉 *Min:* ${data.main.temp_min}°C | 📈 *Max:* ${data.main.temp_max}°C

🛑 *ATMOSPHERE*
> ${statusEmoji} *Condition:* ${data.weather[0].main} (${data.weather[0].description})
> 💧 *Humidity:* ${data.main.humidity}%
> 💨 *Wind:* ${data.wind.speed} m/s
> ☁️ *Clouds:* ${data.clouds.all}%
> 👁️ *Visibility:* ${(data.visibility / 1000).toFixed(1)} km

🛑 *ASTRONOMY*
> 🌅 *Sunrise:* ${sunrise}
> 🌇 *Sunset:* ${sunset}
> ⏱️ *Pressure:* ${data.main.pressure} hPa

────────────────────────
> 🐦‍🔥 *POWERED BY D-TEC MINI* 🐦‍🔥
`;

        // 5. Send Message
        await socket.sendMessage(sender, {
            image: { url: weatherIcon },
            caption: weatherInfo
        }, { quoted: msg }); // Quoted message එකක් විදිහට යැවීම

        // 6. Success React (වැඩේ හරි ගියාම)
        await socket.sendMessage(sender, { react: { text: statusEmoji, key: msg.key } });

    } catch (e) {
        console.log(e);
        // Error React
        await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });

        if (e.response && e.response.status === 404) {
            await socket.sendMessage(sender, { text: "🚫 *City not found!* \nPlease check the spelling." });
        } else {
            await socket.sendMessage(sender, { text: "⚠️ *System Error!* \nTry again later." });
        }
    }
    break;
case 'ss': {
    try {
        const url = args.join(" "); // User දෙන ලින්ක් එක
        if (!url) return await socket.sendMessage(sender, { text: '❌ Give me a URL. Ex: .ss google.com' }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: "📸", key: msg.key } });

        // Smooth & Free API logic
        const ssUrl = `https://image.thum.io/get/width/1900/crop/1000/fullpage/https://${url.replace('https://', '').replace('http://', '')}`;

        await socket.sendMessage(sender, { 
            image: { url: ssUrl }, 
            caption: `📸 Screenshot of: ${url}` 
        }, { quoted: msg });

    } catch (e) {
        console.error('ss error', e);
        await socket.sendMessage(sender, { text: '❌ Failed to take screenshot.' }, { quoted: msg });
    }
    break;
}
case 'tts': {
    try {
        const text = args.join(" ");
        if (!text) return await socket.sendMessage(sender, { text: '❌ මට කියවන්න වචනයක් දෙන්න. Ex: .tts Hello World' }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: "🗣️", key: msg.key } });

        // Google Translate TTS API (No Key Needed)
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(text)}`;

        await socket.sendMessage(sender, { 
            audio: { url: url }, 
            mimetype: 'audio/mp4', 
            ptt: true // මේක true නිසා voice note එකක් වගේ යන්නේ
        }, { quoted: msg });

    } catch (e) {
        console.error('tts error', e);
        await socket.sendMessage(sender, { text: '❌ Error generating audio.' }, { quoted: msg });
    }
    break;
}

case 'setalivevideo': {
    const fs = require('fs');
    const axios = require('axios');
    const FormData = require('form-data');
    const { downloadContentFromMessage } = require('baileys');

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

    // 1. Permission Check
    if (senderNum !== sanitized && senderNum !== ownerNum) {
        return await socket.sendMessage(sender, { text: '❌ Permission denied.' }, { quoted: msg });
    }

    // 2. Upload Function
    const uploadToCatbox = async (filePath) => {
        if (!fs.existsSync(filePath)) throw new Error("File not found");
        const fileStream = fs.createReadStream(filePath);
        const formData = new FormData();
        formData.append('reqtype', 'fileupload');
        formData.append('fileToUpload', fileStream);
        const response = await axios.post('https://catbox.moe/user/api.php', formData, { headers: { ...formData.getHeaders() } });
        return response.data;
    };

    try {
        let finalUrl = "";
        const quoted = msg.quoted ? msg.quoted : msg;
        const mime = (quoted.msg || quoted).mimetype || '';

        if (/video/.test(mime)) {
            await socket.sendMessage(sender, { react: { text: "⬆️", key: msg.key } });
            
            const stream = await downloadContentFromMessage(quoted.msg || quoted, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            
            const tempPath = `./temp_alive_${Date.now()}.mp4`;
            fs.writeFileSync(tempPath, buffer);

            try {
                finalUrl = await uploadToCatbox(tempPath);
                fs.unlinkSync(tempPath);
            } catch (err) {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                throw err;
            }
        } else {
            const urlArgs = args.join(' ').trim();
            if (urlArgs && urlArgs.startsWith('http')) finalUrl = urlArgs;
            else return await socket.sendMessage(sender, { text: '❗ Reply to a video with `.setalivevideo`' }, { quoted: msg });
        }

        // 3. Save to MongoDB (aliveVideo කියලා වෙනම save කරනවා)
        if (finalUrl) {
            let cfg = await loadUserConfigFromMongo(sanitized) || {};
            cfg.aliveVideo = finalUrl.trim(); // Saving specifically for ALIVE
            await setUserConfigInMongo(sanitized, cfg);

            await socket.sendMessage(sender, { text: '✅ Alive Video updated successfully!' }, { quoted: msg });
        }

    } catch (e) {
        console.error('setalivevideo error', e);
        await socket.sendMessage(sender, { text: `❌ Failed: ${e.message}` }, { quoted: msg });
    }
    break;
}
			  case 'alive': {
    try {
        const os = require('os');
        const { performance } = require('perf_hooks');

        await socket.sendMessage(sender, { react: { text: "👾", key: msg.key } });

        // Config Loading
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const cfg = await loadUserConfigFromMongo(sanitized) || {};
        
        const botName = cfg.botName || "D-TEC MINI BOT";
        const ownerName = config.OWNER_NAME || 'YASAS';
        const logo = cfg.logo || config.RCD_IMAGE_PATH || 'https://i.ibb.co/7Nqpq1R/rules.jpg'; 
        
        // 🔥 ALIVE VIDEO LOGIC 🔥
        // Default එකට වෙන එකක් දැම්මා (Menu එකත් එක්ක පැටලෙන්නේ නැති වෙන්න)
        const defaultAliveVideo = 'https://files.catbox.moe/38w5lk.mp4'; 
        // මෙතන ගන්නේ 'aliveVideo' එක විතරයි
        const useVideo = cfg.aliveVideo || defaultAliveVideo; 

        // Calculations
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const formatSize = (bytes) => (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        const ping = (performance.now() - performance.now()).toFixed(3); // Just dummy calc for speed
        
        const uptimeSeconds = process.uptime();
        const days = Math.floor(uptimeSeconds / (24 * 3600));
        const hours = Math.floor((uptimeSeconds % (24 * 3600)) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);

        // 1. Send Video Note (PTV) - Separate Video
        await socket.sendMessage(sender, { 
            video: { url: useVideo }, 
            ptv: true, 
            caption: `*👋 I Am Alive Now*` 
        }, { quoted: msg });

        // 2. Send Document
        const aliveMessage = `
╭━━━〔 *👾 SYSTEM ONLINE* 〕━━━┈
┃
┃🤖 *Bot Name:* ${botName}
┃👑 *Owner:* ${ownerName}
┃⚡ *Speed:* ${ping} ms
┃⏳ *Uptime:* ${days}d ${hours}h ${minutes}m
┃
┃📟 *RAM Usage:*
┃➥ Used: ${formatSize(usedMem)}
┃➥ Total: ${formatSize(totalMem)}
┃
┃💻 *Host:* ${os.hostname()}
┃☁️ *Platform:* ${os.platform()}
┃
╰━━━━━━━━━━━━━━━━━━┈
> 🐦‍🔥 *POWERED BY D-TEC MINI* 🐦‍🔥`;

        await socket.sendMessage(sender, {
            document: Buffer.from("System Hacked... Virus Detected..."),
            fileName: "📂 ᴅ-ᴛᴇᴄ 10ᴘʙ ꜱʏꜱᴛᴇᴍ ᴅᴀᴛᴀ.ᴅᴏᴄx", 
            mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            fileLength: 99999999999999, 
            pageCount: 1000, 
            caption: aliveMessage,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                externalAdReply: {
                    title: `👋 ${botName} IS ALIVE!`,
                    body: "Click here to join our WhatsApp Channel",
                    thumbnailUrl: logo, 
                    sourceUrl: "https://whatsapp.com/channel/0029Vb7NcUw2phHR4mDZJ51g",
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

    } catch (e) {
        console.error('alive error', e);
        await socket.sendMessage(sender, { text: '❌ System Error.' }, { quoted: msg });
    }
    break;
}
		
			   case 'cfooter': {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETDESC" },
        message: { contactMessage: { displayName: "DTEC MINI V1", vcard: `BEGIN:VCARD\nVERSION:3.0\nN:Bot;;;;\nFN:Bot\nEND:VCARD` } }
    };

    if (senderNum !== sanitized && senderNum !== ownerNum) {
        await socket.sendMessage(sender, { text: '❌ Permission denied. Only the owner can change the description.' }, { quoted: shonux });
        break;
    }
    const descText = args.join(' ').trim();
    if (!descText) {
        return await socket.sendMessage(sender, { text: '❗ Provide a description/footer text.\nExample: `.setdesc 🐦‍🔥 My Official song Channel`' }, { quoted: shonux });
    }
    try {
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        cfg.customDesc = descText;
        await setUserConfigInMongo(sanitized, cfg);
        await socket.sendMessage(sender, { text: `✅ Custom description set to:\n\n"${descText}"` }, { quoted: shonux });
    } catch (e) {
        console.error('setdesc error', e);
        await socket.sendMessage(sender, { text: `❌ Failed to set description: ${e.message || e}` }, { quoted: shonux });
    }
    break;
}

case 'csong':
case 'csend': {
    const yts = require('yt-search');
    const axios = require('axios');
    const fs = require('fs');
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('ffmpeg-static');
    
    // ffmpeg පාත් එක සෙට් කිරීම
    ffmpeg.setFfmpegPath(ffmpegPath);

    // Headers
    const AXIOS_DEFAULTS = { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } 
    };

    // 🔥 FIX: මෙන්න මේ variable එක කලින් තිබුනේ නෑ. ඒකයි error ආවේ.
    const number = sender.split('@')[0]; 
    const sanitized = number.replace(/[^0-9]/g, ''); 

    // Query එක ගන්න විදිය
    const query = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || '';
    
    // Command එක අයින් කරලා ඉතුරු ටික ගන්නවා
    const q = query.replace(/^\.(?:csend|send4|csong)\s+/i, '').trim();
    
    if (!q) {
        await socket.sendMessage(sender, { text: "Need query & JID! Example: .csend songname 947xxxxx@newsletter" }, { quoted: msg });
        break;
    }

    // JID සහ Song වෙන් කරගැනීම
    const parts = q.split(' ');
    if (parts.length < 2) {
        await socket.sendMessage(sender, { text: "Need JID & Song Name!" }, { quoted: msg });
        break;
    }

    const jid = parts.pop(); // අන්තිම කෑල්ල JID එක විදියට ගන්නවා
    const songQuery = parts.join(' '); // ඉතුරු ටික සින්දුවේ නම

    // Valid JID Check...
    if (!jid.includes('@s.whatsapp.net') && !jid.includes('@g.us') && !jid.includes('@newsletter')) {
         await socket.sendMessage(sender, { text: "Invalid JID format!" }, { quoted: msg });
         break;
    }

    await socket.sendMessage(sender, { react: { text: '🔎', key: msg.key } });

    // Video Details
    let videoData = null;
    const isUrl = (url) => url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(.+)/g);

    try {
        if (isUrl(songQuery)) {
            const videoId = songQuery.split('v=')[1] || songQuery.split('/').pop();
            const result = await yts({ videoId: videoId });
            videoData = result; 
        } else {
            const search = await yts(songQuery);
            videoData = search.videos[0];
        }
    } catch (e) {
        console.log("Search Error:", e);
    }
    
    if (!videoData) {
        await socket.sendMessage(sender, { text: "❌ Video Not found!" }, { quoted: msg });
        break;
    }

    await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
    
    // Download URL ලබා ගැනීම (APIs කිහිපයක් උත්සාහ කරයි)
    let downloadUrl = null;
    const tryRequest = async (fn) => {
        try { return await fn(); } catch (e) { return null; }
    };

    // Try API 1
    if (!downloadUrl) {
         const api = `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(videoData.url)}&format=mp3`;
        const res = await tryRequest(() => axios.get(api, AXIOS_DEFAULTS));
        if (res?.data?.result?.download) downloadUrl = res.data.result.download;
    }
    
    // Try API 2
    if (!downloadUrl) {
         const api = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(videoData.url)}`;
        const res = await tryRequest(() => axios.get(api, AXIOS_DEFAULTS));
        if (res?.data?.dl) downloadUrl = res.data.dl;
    }

    // Try API 3 (Fallback)
    if (!downloadUrl) {
         const specificQuery = `${videoData.title} ${videoData.author?.name || ''}`;
        const api = `https://izumiiiiiiii.dpdns.org/downloader/youtube-play?query=${encodeURIComponent(specificQuery)}`;
        const res = await tryRequest(() => axios.get(api, AXIOS_DEFAULTS));
        if (res?.data?.result?.download) downloadUrl = res.data.result.download;
    }

    if (!downloadUrl) {
        await socket.sendMessage(sender, { text: '❌ Download APIs Failed.' }, { quoted: msg });
        break;
    }

    // Buffer Download
    let songBuffer = null;
    try {
        const buffRes = await axios.get(downloadUrl, { responseType: 'arraybuffer', headers: AXIOS_DEFAULTS.headers });
        songBuffer = buffRes.data;
    } catch (e) {
        await socket.sendMessage(sender, { text: '❌ Buffer Download Error' }, { quoted: msg });
        break;
    }

    // MP3 to OGG Conversion
    const tempMp3 = `./${Date.now()}.mp3`;
    const tempOgg = `./${Date.now()}.ogg`;

    try {
        fs.writeFileSync(tempMp3, songBuffer);

        await new Promise((resolve, reject) => {
            ffmpeg(tempMp3)
                .audioCodec('libopus')
                .toFormat('ogg')
                .save(tempOgg)
                .on('end', () => resolve())
                .on('error', (err) => reject(err));
        });

        const oggBuffer = fs.readFileSync(tempOgg);

        // Custom Wadan Logic (Safe check added)
        let customFooter = '> *© Powerd By Dtec Mini V1 *'; 
        try {
            if(typeof loadUserConfigFromMongo !== 'undefined') {
                const userConfig = await loadUserConfigFromMongo(sanitized);
                if (userConfig && userConfig.customDesc) customFooter = userConfig.customDesc;
            }
        } catch (dbErr) {
             // Ignore error
        }

        let desc = `
*\`${customFooter}\`*

*☘️  \`Tɪᴛʟᴇ\` : ${videoData.title}*
*📅  \`Aɢᴏ\`   : ${videoData.ago}*
*⏱️  \`Tɪᴍᴇ\`  : ${videoData.timestamp}*
*🔗  \`Uʀʟ\`   : ${videoData.url}*

${customFooter}
`;
        await socket.sendMessage(jid, {
            image: { url: videoData.thumbnail },
            caption: desc
        });

        await socket.sendMessage(jid, {
            audio: oggBuffer,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true
        });

        await socket.sendMessage(sender, { text: `✅ Sent Song to Channel: ${videoData.title}` }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error("Conversion Error:", err);
        await socket.sendMessage(sender, { text: "❌ Error converting/sending audio!" }, { quoted: msg });
    } finally {
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
        if (fs.existsSync(tempOgg)) fs.unlinkSync(tempOgg);
    }
    break;
}

case 'checkjid': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CHECKJID1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can use this command.' }, { quoted: shonux });
    }

    const target = args[0] || sender;
    let targetJid = target;

    if (!target.includes('@')) {
      if (target.includes('-')) {
        targetJid = target.endsWith('@g.us') ? target : `${target}@g.us`;
      } else if (target.length > 15) {
        targetJid = target.endsWith('@newsletter') ? target : `${target}@newsletter`;
      } else {
        targetJid = target.endsWith('@s.whatsapp.net') ? target : `${target}@s.whatsapp.net`;
      }
    }

    let type = 'Unknown';
    if (targetJid.endsWith('@g.us')) {
      type = 'Group';
    } else if (targetJid.endsWith('@newsletter')) {
      type = 'Newsletter';
    } else if (targetJid.endsWith('@s.whatsapp.net')) {
      type = 'User';
    } else if (targetJid.endsWith('@broadcast')) {
      type = 'Broadcast List';
    } else {
      type = 'Unknown';
    }

    const responseText = `🔍 *JID INFORMATION*\n\n📌 *Type:* ${type}\n🆔 *JID:* ${targetJid}\n\n╰──────────────────────`;

    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: responseText
    }, { quoted: msg });

  } catch (error) {
    console.error('Checkjid command error:', error);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CHECKJID2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error checking JID information!*" }, { quoted: shonux });
  }
  break;
}

case 'emojis': {
  await socket.sendMessage(sender, { react: { text: '🎭', key: msg.key } });
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    
    // Permission check - only session owner or bot owner can change emojis
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change status reaction emojis.' }, { quoted: shonux });
    }
    
    let newEmojis = args;
    
    if (!newEmojis || newEmojis.length === 0) {
      // Show current emojis if no args provided
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      const currentEmojis = userConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI;
      
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      
      return await socket.sendMessage(sender, { 
        text: `🎭 *Current Status Reaction Emojis:*\n\n${currentEmojis.join(' ')}\n\nUsage: \`.emojis 😀 😄 😊 🎉 ❤️\`` 
      }, { quoted: shonux });
    }
    
    // Validate emojis (basic check)
    const invalidEmojis = newEmojis.filter(emoji => !/\p{Emoji}/u.test(emoji));
    if (invalidEmojis.length > 0) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS3" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { 
        text: `❌ *Invalid emojis detected:* ${invalidEmojis.join(' ')}\n\nPlease use valid emoji characters only.` 
      }, { quoted: shonux });
    }
    
    // Get user-specific config from MongoDB
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    
    // Update ONLY this user's emojis
    userConfig.AUTO_LIKE_EMOJI = newEmojis;
    
    // Save to MongoDB
    await setUserConfigInMongo(sanitized, userConfig);
    
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    
    await socket.sendMessage(sender, { 
      text: `✅ *Your Status Reaction Emojis Updated!*\n\nNew emojis: ${newEmojis.join(' ')}\n\nThese emojis will be used for your automatic status reactions.` 
    }, { quoted: shonux });
    
  } catch (e) {
    console.error('Emojis command error:', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_EMOJIS5" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: "*❌ Error updating your status reaction emojis!*" }, { quoted: shonux });
  }
  break;
}
			
case 'xham': {
    const metaQuote = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_MEDIA" },
        message: { contactMessage: { displayName: "DTEC XHAM GENERATOR", vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:MovaNest\nORG:Xham Service\nEND:VCARD` } }
    };

  
    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || 
                 msg.message?.videoMessage?.caption || '';

  
    const query = text.replace(/^\S+\s+/, '').trim() || 'random';

    if (!query) {
        return await socket.sendMessage(sender, { text: '❌ *Please provide a query.*' }, { quoted: metaQuote });
    }

    try {
        const searchResponse = await axios.get(`https://movanest.xyz/v2/xhamsearch?query=${encodeURIComponent(query)}`);
        const { results } = searchResponse.data;

        if (!results || results.length === 0) {
            await socket.sendMessage(sender, { text: '❌ *No results found.*' }, { quoted: metaQuote });
            break;
        }

        const randomItem = results[Math.floor(Math.random() * results.length)];
        const { title, duration, url } = randomItem; 

      
        const payloadNormal = JSON.stringify({ u: url, t: title.substring(0, 30), type: 'n' });
        const payloadDoc = JSON.stringify({ u: url, t: title.substring(0, 30), type: 'd' });

        const caption = `🔥 *Xham Search: ${query}*\n\n📖 *Title:* ${title}\n⏱️ *Duration:* ${duration}\n\nPowered by MovaNest API\n\n*Choose delivery method:*`;

        const buttons = [
            { buttonId: `${config.PREFIX}xham-dl ${payloadNormal}`, buttonText: { displayText: "▶️ View Normally" }, type: 1 },
            { buttonId: `${config.PREFIX}xham-dl ${payloadDoc}`, buttonText: { displayText: "📥 DL as Document" }, type: 1 }
        ];
        
        await socket.sendMessage(sender, { 
            text: caption, 
            buttons, 
            headerType: 1 
        }, { quoted: metaQuote });

    } catch (e) {
        console.error(e);
        await socket.sendMessage(sender, { text: '❌ *Error fetching Xham list.*' });
    }
    break;
}

case 'xham-dl': {
    try {
        const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId || 
                         msg.message?.templateButtonReplyMessage?.selectedId || 
                         msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                         msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || '';
        const jsonStartIndex = buttonId.indexOf('{');
        
        if (jsonStartIndex === -1) {
            console.log("Error: JSON not found in Button ID");
            break; 
        }

        const jsonStr = buttonId.slice(jsonStartIndex);
        const data = JSON.parse(jsonStr);
        const { u: pageUrl, t: title, type } = data;

        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });

        const detailResponse = await axios.get(`https://movanest.xyz/v2/xhamdetail?url=${encodeURIComponent(pageUrl)}`);
        const { results: detailResult } = detailResponse.data;

        if (!detailResult || !detailResult.videoUrl) {
            await socket.sendMessage(sender, { text: '❌ *Failed to fetch video source.*' }, { quoted: msg });
            break;
        }

        const videoUrl = detailResult.videoUrl;
        const caption = `🔥 *Xham: ${title}*\n\nPowered by MovaNest API`;

        if (type === 'n') {
            await socket.sendMessage(sender, { video: { url: videoUrl }, caption: caption }, { quoted: msg });
        } else {
            const cleanTitle = (title || 'video').replace(/[^a-zA-Z0-9]/g, '_');
            await socket.sendMessage(sender, { document: { url: videoUrl }, mimetype: 'video/mp4', fileName: `${cleanTitle}.mp4`, caption: caption }, { quoted: msg });
        }

    } catch (e) {
        console.error("Xham Download Error:", e);
        await socket.sendMessage(sender, { text: '❌ *Error downloading video.*' }, { quoted: msg });
    }
    break;
}
case 'xnxx': {
    const metaQuote = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_MEDIA" },
        message: { contactMessage: { displayName: "DTEC XNXX GENERATOR", vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:MovaNest\nORG:XNXX Service\nEND:VCARD` } }
    };

    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || 
                 msg.message?.videoMessage?.caption || '';
    const query = text.replace(/^\S+\s+/, '').trim() || 'random';

    if (!query) {
        return await socket.sendMessage(sender, { text: '❌ *Please provide a query. Example: .xnxx mom*' }, { quoted: metaQuote });
    }

    try {
   
        const response = await axios.get(`https://movanest.xyz/v2/xnxx?query=${encodeURIComponent(query)}`);
        const { result } = response.data;

        if (!result || result.length === 0) {
            await socket.sendMessage(sender, { text: '❌ *No results found.*' }, { quoted: metaQuote });
            break;
        }

    
        const randomItem = result[Math.floor(Math.random() * result.length)];
        const { title, info, link } = randomItem; 

        const cleanTitle = title.substring(0, 30);

        const caption = `🔥 *XNXX Search: ${query}*\n\n📖 *Title:* ${title}\n📊 *Info:* ${info}\n\n*Select Quality & Type:*\nPowered by MovaNest API`;

        const buttons = [

            { buttonId: `${config.PREFIX}xnxx-dl ${JSON.stringify({ u: link, t: cleanTitle, type: 'n', q: 'h' })}`, buttonText: { displayText: "▶️ Normal High" }, type: 1 },
            { buttonId: `${config.PREFIX}xnxx-dl ${JSON.stringify({ u: link, t: cleanTitle, type: 'n', q: 'l' })}`, buttonText: { displayText: "▶️ Normal Low" }, type: 1 },
            { buttonId: `${config.PREFIX}xnxx-dl ${JSON.stringify({ u: link, t: cleanTitle, type: 'd', q: 'h' })}`, buttonText: { displayText: "📥 Doc High" }, type: 1 },
            { buttonId: `${config.PREFIX}xnxx-dl ${JSON.stringify({ u: link, t: cleanTitle, type: 'd', q: 'l' })}`, buttonText: { displayText: "📥 Doc Low" }, type: 1 }
        ];
        
        await socket.sendMessage(sender, { 
            text: caption, 
            buttons, 
            headerType: 1 
        }, { quoted: metaQuote });

    } catch (e) {
        console.error(e);
        await socket.sendMessage(sender, { text: '❌ *Error fetching XNXX list.*' });
    }
    break;
}


case 'xnxx-dl': {
    try {
        
        const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId || 
                         msg.message?.templateButtonReplyMessage?.selectedId || 
                         msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                         msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || '';

  
        const jsonStartIndex = buttonId.indexOf('{');
        
        if (jsonStartIndex === -1) {
             console.log("Invalid Button Response: No JSON found");
             break;
        }

        const jsonStr = buttonId.slice(jsonStartIndex);
        const data = JSON.parse(jsonStr);
        const { u: pageUrl, t: title, type, q: quality } = data;

        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });


        const dlResponse = await axios.get(`https://movanest.xyz/v2/xnxx?url=${encodeURIComponent(pageUrl)}`);
        const dlResult = dlResponse.data.result;

        if (!dlResult || !dlResult.files) {
            await socket.sendMessage(sender, { text: '❌ *Failed to fetch download links.*' }, { quoted: msg });
            break;
        }

    
        const videoUrl = (quality === 'h') ? dlResult.files.high : dlResult.files.low;

        if (!videoUrl) {
            await socket.sendMessage(sender, { text: '❌ *Selected quality not available.*' }, { quoted: msg });
            break;
        }

        const caption = `🔥 *XNXX: ${title}*\n\n📺 *Quality:* ${quality === 'h' ? 'High' : 'Low'}\nPowered by MovaNest API`;


        if (type === 'n') {
            
            await socket.sendMessage(sender, {
                video: { url: videoUrl },
                caption: caption
            }, { quoted: msg });
        } else {
           
            const cleanTitleName = (title || 'video').replace(/[^a-zA-Z0-9]/g, '_');
            await socket.sendMessage(sender, {
                document: { url: videoUrl },
                mimetype: 'video/mp4',
                fileName: `${cleanTitleName}.mp4`,
                caption: caption
            }, { quoted: msg });
        }

    } catch (e) {
        console.error("XNXX Download Error:", e);
        await socket.sendMessage(sender, { text: '❌ *Error downloading video. Link might be expired.*' }, { quoted: msg });
    }
    break;
}
case 'ai':
case 'chat':
case 'gpt': {
    try {
        // 1. Text එක ගන්න විදිය
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption || '';
                     
        const q = text.replace(/^[.\/!](ai|chat|gpt)\s*/i, '').trim();

        if (!q) {
            return await socket.sendMessage(sender, { 
                text: '⁉️ *මට මැසේජ් එකක් දෙන්න.* (E.g: .ai Who is iron man?)' 
            }, { quoted: msg });
        }

        // 2. Bot Name Load Logic
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'Dtec AI';

        // 3. Fake Typing Effect (Human Look)
        await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });
        await socket.sendPresenceUpdate('composing', sender); 

        // 4. API Request (Free No-Key API: Hercai / DarkYasiya)
        // මේක Free දෙන API එකක්. Key ඕන නෑ.
        const response = await axios.get(`https://hercai.onrender.com/v3/hercai?question=${encodeURIComponent(q)}`);
        
        const aiReply = response.data?.reply;

        if (!aiReply) {
            await socket.sendMessage(sender, { text: '❌ AI Response Error.' }, { quoted: msg });
            return;
        }

        // 5. Custom Persona Logic (API එකෙන් එන උත්තරේ පොඩ්ඩක් වෙනස් කරනවා)
        // කවුරුහරි "Who made you" ඇහුවොත් අර API එකෙන් එන උත්තරේ අයින් කරලා අපේ එක දානවා.
        let finalReply = aiReply;
        if (q.toLowerCase().includes('who created you') || q.toLowerCase().includes('හැදුවේ කවුද')) {
            finalReply = "මාව හැදුවේ චතුක අයියා.";
        }

        // 6. Final Message
        await socket.sendMessage(sender, {
            text: finalReply,
            contextInfo: {
                externalAdReply: {
                    title: `${botName} Assistant`,
                    body: "Powered by Open AI",
                    thumbnailUrl: "https://telegra.ph/file/a754b2d5f3080d85a538d.jpg", // කැමති ෆොටෝ එකක් දාගන්න
                    mediaType: 1,
                    sourceUrl: "https://chatgpt.com/",
                    renderLargerThumbnail: false
                }
            }
        }, { quoted: msg });

    } catch (err) {
        console.error("AI Error:", err);
        await socket.sendMessage(sender, { text: '❌ AI සර්වර් එකේ පොඩි අවුලක්. ටිකකින් බලන්න.' });
    }
    break;
}
	  
case 'aiimg':
case 'aiimg2': {
    const axios = require('axios');
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)); // Sleep function එක

    // 1. Text එක ගන්න විදිය
    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || 
                 msg.message?.videoMessage?.caption || '';

    // Command එක අයින් කරලා prompt එක විතරක් ගන්නවා
    const prompt = text.replace(/^[.\/!](aiimg|aiimg2)\s*/i, '').trim();

    if (!prompt) {
        return await socket.sendMessage(sender, {
            text: '🎨 *Please provide a prompt.* (Example: .aiimg cat)'
        }, { quoted: msg });
    }

    try {
        // 2. Load Bot Name
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'Dtec AI';

        // 3. START PROCESSING MESSAGE (මේක තමයි edit වෙවී යන්නේ)
        // මුලින්ම මැසේජ් එක යවනවා, ඊට පස්සේ ඒකේ key එක save කරගන්නවා
        let { key } = await socket.sendMessage(sender, { text: "🖌️ *Initializing AI Engine...*" }, { quoted: msg });

        // --- Fake Loading Animation ---
        await sleep(500);
        await socket.sendMessage(sender, { text: "🎨 *Generating Image... 20%*", edit: key });
        
        await sleep(1000);
        await socket.sendMessage(sender, { text: "🎨 *Generating Image... 60%*", edit: key });

        // 4. Determine API URL
        // ඔයා දීපු API දෙකම මෙතනට සෙට් කළා
        let apiUrl = '';
        if (text.toLowerCase().includes('aiimg2')) {
            apiUrl = `https://api.siputzx.my.id/api/ai/magicstudio?prompt=${encodeURIComponent(prompt)}`;
        } else {
            apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
        }

        // 5. Call AI API
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

        await socket.sendMessage(sender, { text: "🎨 *Uploading Image... 100%*", edit: key });

        if (!response || !response.data) {
             await socket.sendMessage(sender, { text: "❌ *Generation Failed!*", edit: key });
             return;
        }

        const imageBuffer = Buffer.from(response.data, 'binary');

        // 6. Send Final Image
        await socket.sendMessage(sender, {
            image: imageBuffer,
            caption: `🎨 *AI GENERATED IMAGE*\n\n🖌️ *Prompt:* ${prompt}\n\n> 🤖 Generated by ${botName}`,
            // ලස්සනට පේන්න Context Info (External Ad) එකක් දාමු
            contextInfo: {
                externalAdReply: {
                    title: `${botName} Image Generator`,
                    body: "Artificial Intelligence",
                    thumbnailUrl: "https://telegra.ph/file/a754b2d5f3080d85a538d.jpg", // මෙතනට කැමති ලින්ක් එකක් දාන්න
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

        // 7. Finish the Loading Message
        // වැඩේ ඉවර වුනාම අර උඩින් වැටුනු මැසේජ් එක Successful කියලා වෙනස් කරනවා
        await socket.sendMessage(sender, { text: "✅ *Image Generated Successfully!*", edit: key });

    } catch (err) {
        console.error('AI Image Error:', err);
        // Error එකක් ආවොත් Loading මැසේජ් එක Error එකක් විදියට වෙනස් කරනවා
        await socket.sendMessage(sender, { text: `❌ *Error:* ${err.message}`, edit: key });
    }
    break;
}
			  case 'sticker':
case 's': {
    const fs = require('fs');
    const { exec } = require('child_process');

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const mime = msg.message?.imageMessage?.mimetype || 
                 msg.message?.videoMessage?.mimetype || 
                 quoted?.imageMessage?.mimetype || 
                 quoted?.videoMessage?.mimetype;

    if (!mime) return await socket.sendMessage(sender, { text: '❌ Reply to an image or video!' }, { quoted: msg });

    try {
        // Download Media
        let media = await downloadQuotedMedia(msg.message?.imageMessage ? msg.message : quoted);
        let buffer = media.buffer;

        // Paths
        let ran = generateOTP(); // Random ID
        let pathIn = `./${ran}.${mime.split('/')[1]}`;
        let pathOut = `./${ran}.webp`;

        fs.writeFileSync(pathIn, buffer);

        // FFmpeg Conversion (Local)
        let ffmpegCmd = '';
        if (mime.includes('image')) {
            ffmpegCmd = `ffmpeg -i ${pathIn} -vcodec libwebp -filter:v fps=fps=20 -lossless 1 -loop 0 -preset default -an -vsync 0 -s 512:512 ${pathOut}`;
        } else {
            ffmpegCmd = `ffmpeg -i ${pathIn} -vcodec libwebp -filter:v fps=fps=15 -lossless 1 -loop 0 -preset default -an -vsync 0 -s 512:512 ${pathOut}`;
        }

        exec(ffmpegCmd, async (err) => {
            fs.unlinkSync(pathIn); // Delete input file

            if (err) {
                console.error(err);
                return await socket.sendMessage(sender, { text: '❌ Error converting media.' });
            }

            // Send Sticker
            await socket.sendMessage(sender, { 
                sticker: fs.readFileSync(pathOut) 
            }, { quoted: msg });

            fs.unlinkSync(pathOut); // Delete output file
        });

    } catch (e) {
        console.error(e);
        await socket.sendMessage(sender, { text: '❌ Failed to create sticker.' });
    }
    break;
}
			 
			 case 'link':
case 'grouplink': {
    if (!isGroup) return await socket.sendMessage(sender, { text: '❌ Groups only!' });
    
    try {
        // බොට් ඇඩ්මින් දැයි තහවුරු කරගන්න
        const code = await socket.groupInviteCode(from);
        const link = `https://chat.whatsapp.com/${code}`;

        // Copy Button එක සහිත පණිවිඩය සකස් කිරීම
        const msgContent = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header: {
                            title: "🔗 Group Link Generated",
                            hasMediaAttachment: false
                        },
                        body: {
                            text: `Group Link:\n${link}`
                        },
                        footer: {
                            text: "© Dtec Mini v1"
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "cta_copy",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "Copy Link", // බටන් එකේ පෙනෙන නම
                                        id: "12345",
                                        copy_code: link // කොපි විය යුතු ලින්ක් එක
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        // පණිවිඩය යැවීම (relayMessage භාවිතා කළ යුතුය)
        await socket.relayMessage(from, msgContent, { quoted: msg });

    } catch (e) {
        console.error(e);
        await socket.sendMessage(sender, { text: '❌ Failed. Make sure I am Admin.' });
    }
    break;
}
             case 'pair': {
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    // අංකය ලබා ගැනීම
    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair 947XXXXXXX'
        }, { quoted: msg });
    }

    try {
        // ✅ API Call
        const url = `https://dtecminiwhabot-437ae374ad9f.herokuapp.com/code?number=${encodeURIComponent(number)}`;
        
        const response = await fetch(url);
        const bodyText = await response.text();

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: `❌ Failed to retrieve pairing code.\nReason: ${result?.message || 'Check the number format'}`
            }, { quoted: msg });
        }

        const pCode = result.code;

        // React sending
        await socket.sendMessage(sender, { react: { text: '🔑', key: msg.key } });

        // 🛠️ COPY BUTTON MESSAGE (Native Flow)
        // මේකෙන් තමයි Copy Button එක හැදෙන්නේ
        let msgParams = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2,
                    },
                    interactiveMessage: {
                        body: {
                            // මෙතන මැසේජ් එක කෙටි කරලා තියෙන්නේ
                            text: `*✅ 𝐏𝐀𝐈𝚁 𝐂𝐎𝐃𝐄 𝐆𝐄𝐍𝐄𝐑𝐀𝐓𝐄𝐃*\n\n👤 *User:* ${number}\n🔑 *Code:* ${pCode}\n\n_Click the button below to copy the code_ 👇`
                        },
                        footer: {
                            text: "🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1"
                        },
                        header: {
                            title: "",
                            subtitle: "",
                            hasMediaAttachment: false
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "cta_copy",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "COPY CODE", // බටන් එකේ නම
                                        id: "copy_code_btn",
                                        copy_code: pCode // මෙතනට එන එක තමයි කොපි වෙන්නේ
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        // Send Message using relayMessage (for buttons)
        await socket.relayMessage(sender, msgParams, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request.'
        }, { quoted: msg });
    }

    break;
}
  case 'cricket':
    try {
        console.log('Fetching cricket news from API...');
        
        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
        console.log(`API Response Status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        console.log('API Response Data:', JSON.stringify(data, null, 2));

       
        if (!data.status || !data.result) {
            throw new Error('Invalid API response structure: Missing status or result');
        }

        const { title, score, to_win, crr, link } = data.result;
        if (!title || !score || !to_win || !crr || !link) {
            throw new Error('Missing required fields in API response: ' + JSON.stringify(data.result));
        }

       
        console.log('Sending message to user...');
        await socket.sendMessage(sender, {
            text: formatMessage(
                '🏏 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥 MINI CEICKET NEWS🏏',
                `📢 *${title}*\n\n` +
                `🏆 *mark*: ${score}\n` +
                `🎯 *to win*: ${to_win}\n` +
                `📈 *now speed*: ${crr}\n\n` +
                `🌐 *link*: ${link}`,
                '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥'
            )
        });
        console.log('Message sent successfully.');
    } catch (error) {
        console.error(`Error in 'news' case: ${error.message}`);
        await socket.sendMessage(sender, {
            text: '⚠️ දැන්නම් හරි යන්නම ඕන 🙌.'
        });
    }
                    break;
			
case 'tr':
case 'translate': {
    const axios = require('axios');

    // Load Config for Meta Look
    const sanitized = (sender || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const lang = args[0] || 'si';
    const text = args.slice(1).join(' ') || 
                 msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation;

    if (!text) return await socket.sendMessage(sender, { text: '❌ *Usage:* .tr si Hello' });

    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await axios.get(url);
        const trans = res.data[0][0][0];

        // Meta Contact Card
        const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_TR" },
            message: { contactMessage: { displayName: "Google Translator", vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Translator\nORG:Google API\nEND:VCARD` } }
        };

        const caption = `
╭───❰ *♻️ TRANSLATOR* ❱───╮
│
│ 🔤 *Original:* ${text}
│ 🔀 *To:* ${lang.toUpperCase()}
│
│ 🗣️ *Result:*
│ 📝 _${trans}_
│
╰─────────────────────╯
> ${botName}`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                externalAdReply: {
                    title: `Translated to ${lang.toUpperCase()}`,
                    body: "Google Translate API",
                    thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/d/d7/Google_Translate_logo.png",
                    sourceUrl: "https://translate.google.com",
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: metaQuote });

    } catch (e) {
        await socket.sendMessage(sender, { text: '❌ Error translating.' });
    }
    break;
}

case 'calc': {
    // Load Config
    const sanitized = (sender || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const expr = args.join(' ');
    if (!expr) return await socket.sendMessage(sender, { text: '❌ *Usage:* .calc 2+2*5' });

    try {
        // Safe evaluation
        const result = new Function('return ' + expr)();
        
        // Meta Quote
        const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_CALC" },
            message: { contactMessage: { displayName: "Calculator Tool", vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Math Tool\nORG:Scientific\nEND:VCARD` } }
        };

        const txt = `
╭───❰ *🧮 CALCULATOR* ❱───╮
│
│ 📝 *Question:* │ \`${expr}\`
│
│ 💡 *Answer:* │ *${result}*
│
╰─────────────────────╯
> ${botName}`;

        await socket.sendMessage(sender, { 
            text: txt,
            contextInfo: {
                externalAdReply: {
                    title: "Mathematics Solved ✅",
                    body: `Result: ${result}`,
                    thumbnailUrl: "https://cdn-icons-png.flaticon.com/512/2374/2374370.png",
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: metaQuote });

    } catch (e) {
        await socket.sendMessage(sender, { text: '❌ Invalid Math Expression.' });
    }
    break;
}

case 'short': {
    const axios = require('axios');
    // args define කරලා නැත්නම් හෝ link එක නැත්නම්, message body එකෙන් ගන්න
    const link = args[0] || msg.body.split(' ')[1];

    if (!link) return await socket.sendMessage(sender, { text: '❌ *Give me a link to shorten.*' }, { quoted: msg });

    try {
        // Link Shortening Request
        const res = await axios.get(`https://tinyurl.com/api-create.php?url=${link}`);
        const shortLink = res.data;

        // Native Flow Message (Button Message)
        let msgParams = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2,
                    },
                    interactiveMessage: {
                        header: {
                            title: "🔗 LINK SHORTENER",
                            hasMediaAttachment: false
                        },
                        body: {
                            text: `🌍 *Original:* ${link}\n\n🚀 *Shortened:* ${shortLink}\n\n_Select an action below_ 👇`
                        },
                        footer: {
                            text: "© Dtec Mini Tools"
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    // 1. COPY BUTTON
                                    name: "cta_copy",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "📋 COPY LINK",
                                        id: "copy_short_link",
                                        copy_code: shortLink // මේක තමයි කොපි වෙන්නේ
                                    })
                                },
                                {
                                    // 2. OPEN BUTTON (Bonus)
                                    name: "cta_url",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "🌐 OPEN LINK",
                                        url: shortLink,
                                        merchant_url: shortLink
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        // Send the button message
        await socket.relayMessage(sender, msgParams, { quoted: msg });

    } catch (e) {
        console.error("Shortener Error:", e);
        await socket.sendMessage(sender, { text: '❌ Error shortening link.' }, { quoted: msg });
    }
    break;
}
case 'ttp': {
    const text = args.join(' ');
    if (!text) return await socket.sendMessage(sender, { text: '❌ *Need text to create sticker.*' });

    try {
        // TTP Stickers can't have "Context Info" cards attached easily, 
        // but we can send a styled reaction first.
        await socket.sendMessage(sender, { react: { text: '🎨', key: msg.key } });

        const url = `https://dummyimage.com/512x512/000000/ffffff.png&text=${encodeURIComponent(text)}`;
        
        await socket.sendMessage(sender, { 
            sticker: { url: url },
            // Using packname trick
            packname: "Dtec Mini",
            author: "TTP Bot"
        }, { quoted: msg });

    } catch (e) {
        await socket.sendMessage(sender, { text: '❌ Error creating sticker.' });
    }
    break;
}

case 'github':
case 'git': {
    const axios = require('axios');
    const user = args[0];
    if(!user) return await socket.sendMessage(sender, { text: '❌ *Need GitHub username.*' });

    // Load Config
    const sanitized = (sender || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    try {
        const res = await axios.get(`https://api.github.com/users/${user}`);
        const d = res.data;

        const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_GIT" },
            message: { contactMessage: { displayName: "GitHub Profile", vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:GitHub\nORG:Microsoft\nEND:VCARD` } }
        };

        const txt = `
╭───❰ *🐙 GITHUB PROFILE* ❱───╮
│
│ 👤 *Name:* ${d.name || 'N/A'}
│ 🔖 *User:* ${d.login}
│ 📖 *Bio:* ${d.bio || 'No Bio'}
│
│ 📦 *Repos:* ${d.public_repos}
│ 👥 *Followers:* ${d.followers}
│ 👣 *Following:* ${d.following}
│
│ 📅 *Created:* ${new Date(d.created_at).toDateString()}
│ 🔗 *Link:* ${d.html_url}
│
╰─────────────────────╯
> ${botName}`;

        await socket.sendMessage(sender, { 
            image: { url: d.avatar_url }, 
            caption: txt,
            contextInfo: {
                externalAdReply: {
                    title: `GitHub: ${d.login}`,
                    body: "Click to visit profile",
                    thumbnailUrl: d.avatar_url,
                    sourceUrl: d.html_url,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: metaQuote });

    } catch(e) {
         await socket.sendMessage(sender, { text: '❌ User not found.' });
    }
    break;
}
                case 'gossip':
    try {
        
        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
        if (!response.ok) {
            throw new Error('API එකෙන් news ගන්න බැරි වුණා.බන් 😩');
        }
        const data = await response.json();


        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
            throw new Error('API එකෙන් ලැබුණු news data වල ගැටලුවක්');
        }


        const { title, desc, date, link } = data.result;


        let thumbnailUrl = 'https://via.placeholder.com/150';
        try {
            
            const pageResponse = await fetch(link);
            if (pageResponse.ok) {
                const pageHtml = await pageResponse.text();
                const $ = cheerio.load(pageHtml);
                const ogImage = $('meta[property="og:image"]').attr('content');
                if (ogImage) {
                    thumbnailUrl = ogImage; 
                } else {
                    console.warn(`No og:image found for ${link}`);
                }
            } else {
                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
            }
        } catch (err) {
            console.warn(`Thumbnail scrape කරන්න බැරි වුණා from ${link}: ${err.message}`);
        }


        await socket.sendMessage(sender, {
            image: { url: thumbnailUrl },
            caption: formatMessage(
                '📰 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥 නවතම පුවත් 📰',
                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date || 'තවම ලබාදීලා නැත'}\n🌐 *Link*: ${link}`,
                '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥'
            )
        });
    } catch (error) {
        console.error(`Error in 'news' case: ${error.message}`);
        await socket.sendMessage(sender, {
            text: '⚠️ නිව්ස් ගන්න බැරි වුණා සුද්දෝ! 😩 යමක් වැරදුණා වගේ.'
        });
    }
                    break;
case 'deleteme': {
  // 'number' is the session number passed to setupCommandHandlers (sanitized in caller)
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  // determine who sent the command
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

  // Permission: only the session owner or the bot OWNER can delete this session
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or the bot owner can delete this session.' }, { quoted: msg });
    break;
  }

  try {
    // 1) Remove from Mongo
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);

    // 2) Remove temp session dir
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try {
      if (fs.existsSync(sessionPath)) {
        fs.removeSync(sessionPath);
        console.log(`Removed session folder: ${sessionPath}`);
      }
    } catch (e) {
      console.warn('Failed removing session folder:', e);
    }

    // 3) Try to logout & close socket
    try {
      if (typeof socket.logout === 'function') {
        await socket.logout().catch(err => console.warn('logout error (ignored):', err?.message || err));
      }
    } catch (e) { console.warn('socket.logout failed:', e?.message || e); }
    try { socket.ws?.close(); } catch (e) { console.warn('ws close failed:', e?.message || e); }

    // 4) Remove from runtime maps
    activeSockets.delete(sanitized);
    socketCreationTime.delete(sanitized);

    // 5) notify user
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION DELETED', '✅ Your session has been successfully deleted from MongoDB and local storage.', BOT_NAME_FANCY)
    }, { quoted: msg });

    console.log(`Session ${sanitized} deleted by ${senderNum}`);
  } catch (err) {
    console.error('deleteme command error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
 
case 'fb':
case 'fbdl':
case 'facebook':
case 'fbd': {
    try {
        let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        let url = text.split(" ")[1]; // e.g. .fb <link>

        if (!url) {
            return await socket.sendMessage(sender, { 
                text: '🚫 *Please send a Facebook video link.*\n\nExample: .fb <url>' 
            }, { quoted: msg });
        }

        const axios = require('axios');

        // 🔹 Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        // 🔹 Fake contact for Meta AI mention
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_FB"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        // 🔹 Call API
        let api = `https://tharuzz-ofc-api-v2.vercel.app/api/download/fbdl?url=${encodeURIComponent(url)}`;
        let { data } = await axios.get(api);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '❌ *Failed to fetch Facebook video.*' }, { quoted: shonux });
        }

        let title = data.result.title || 'Facebook Video';
        let thumb = data.result.thumbnail;
        let hdLink = data.result.dlLink?.hdLink || data.result.dlLink?.sdLink; // Prefer HD else SD

        if (!hdLink) {
            return await socket.sendMessage(sender, { text: '⚠️ *No video link available.*' }, { quoted: shonux });
        }

        // 🔹 Send thumbnail + title first
        await socket.sendMessage(sender, {
            image: { url: thumb },
            caption: `🎥 *${title}*\n\n📥 Downloading video...\n_© Powered by ${botName}_`
        }, { quoted: shonux });

        // 🔹 Send video automatically
        await socket.sendMessage(sender, {
            video: { url: hdLink },
            caption: `🎥 *${title}*\n\n✅ Downloaded by ${botName}`
        }, { quoted: shonux });

    } catch (e) {
        console.log(e);
        await socket.sendMessage(sender, { text: '⚠️ *Error downloading Facebook video.*' });
    }
}
break;




case 'cfn': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  const botName = cfg.botName || BOT_NAME_FANCY;
  const logo = cfg.logo || config.RCD_IMAGE_PATH;

  const full = body.slice(config.PREFIX.length + command.length).trim();
  if (!full) {
    await socket.sendMessage(sender, { text: `❗ Provide input: .cfn <jid@newsletter> | emoji1,emoji2\nExample: .cfn 120363402094635383@newsletter | 🔥,❤️` }, { quoted: msg });
    break;
  }

  const admins = await loadAdminsFromMongo();
  const normalizedAdmins = (admins || []).map(a => (a || '').toString());
  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
  const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
  if (!(isOwner || isAdmin)) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only owner or configured admins can add follow channels.' }, { quoted: msg });
    break;
  }

  let jidPart = full;
  let emojisPart = '';
  if (full.includes('|')) {
    const split = full.split('|');
    jidPart = split[0].trim();
    emojisPart = split.slice(1).join('|').trim();
  } else {
    const parts = full.split(/\s+/);
    if (parts.length > 1 && parts[0].includes('@newsletter')) {
      jidPart = parts.shift().trim();
      emojisPart = parts.join(' ').trim();
    } else {
      jidPart = full.trim();
      emojisPart = '';
    }
  }

  const jid = jidPart;
  if (!jid || !jid.endsWith('@newsletter')) {
    await socket.sendMessage(sender, { text: '❗ Invalid JID. Example: 120363402094635383@newsletter' }, { quoted: msg });
    break;
  }

  let emojis = [];
  if (emojisPart) {
    emojis = emojisPart.includes(',') ? emojisPart.split(',').map(e => e.trim()) : emojisPart.split(/\s+/).map(e => e.trim());
    if (emojis.length > 20) emojis = emojis.slice(0, 20);
  }

  try {
    if (typeof socket.newsletterFollow === 'function') {
      await socket.newsletterFollow(jid);
    }

    await addNewsletterToMongo(jid, emojis);

    const emojiText = emojis.length ? emojis.join(' ') : '(default set)';

    // Meta mention for botName
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CFN" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: `✅ Channel followed and saved!\n\nJID: ${jid}\nEmojis: ${emojiText}\nSaved by: @${senderIdSimple}`,
      footer: `📌 ${botName} FOLLOW CHANNEL`,
      mentions: [nowsender], // user mention
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (e) {
    console.error('cfn error', e);
    await socket.sendMessage(sender, { text: `❌ Failed to save/follow channel: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'fb':
case 'fbdl':
case 'facebook': {
    const axios = require('axios');
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 1. Text එක සහ URL එක හරියටම වෙන් කරගැනීම
    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || '';

    // URL එක හොයාගන්න Regex එකක් (මැසේජ් එකේ කොතන තිබුනත් ගන්නවා)
    const urlMatch = text.match(/(https?:\/\/(www\.|web\.|m\.)?(facebook|fb)\.(com|watch)\/\S+)/);
    const url = urlMatch ? urlMatch[0] : null;

    if (!url) {
        return await socket.sendMessage(sender, { 
            text: '🚫 *Please give me a Facebook URL.*' 
        }, { quoted: msg });
    }

    try {
        // 2. Bot Name Load Logic
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'Dtec Downloader';

        // 3. START ANIMATION (Fake Loading)
        // මුලින්ම මැසේජ් එකක් යවලා ID එක ගන්නවා
        let { key } = await socket.sendMessage(sender, { text: "🔄 *Connecting to Facebook...*" }, { quoted: msg });

        await sleep(500);
        await socket.sendMessage(sender, { text: "🔎 *Searching Video Data...*", edit: key });

        // 4. API Call (Reliable API)
        const api = `https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(url)}`;
        const { data } = await axios.get(api);

        if (!data.status || !data.data) {
            await socket.sendMessage(sender, { text: "❌ *Video Not Found or Private!*", edit: key });
            return;
        }

        await socket.sendMessage(sender, { text: "⬇️ *Downloading Video...*", edit: key });

        // 5. Data Extraction
        const result = data.data; // API response structure
        const videoTitle = "Facebook Video"; // සමහර API title එවන්නෙ නෑ, ඒ නිසා default එකක් තියාගමු
        
        // HD හෝ SD තෝරාගැනීම (HD මුලින් බලනවා)
        let downloadUrl = '';
        let quality = '';

        const hdInfo = result.find(v => v.resolution === 'HD');
        const sdInfo = result.find(v => v.resolution === 'SD');

        if (hdInfo) {
            downloadUrl = hdInfo.url;
            quality = 'HD 720p';
        } else if (sdInfo) {
            downloadUrl = sdInfo.url;
            quality = 'SD 480p';
        } else {
            // resolution හරියට නැත්නම් පළවෙනි ලින්ක් එක ගන්නවා
            downloadUrl = result[0]?.url;
            quality = 'Standard';
        }

        if (!downloadUrl) {
            await socket.sendMessage(sender, { text: "❌ *No Download Link Found!*", edit: key });
            return;
        }

        await socket.sendMessage(sender, { text: "✅ *Uploading to WhatsApp...*", edit: key });

        // 6. Send Final Video with Premium Look
        await socket.sendMessage(sender, {
            video: { url: downloadUrl },
            caption: `🎬 *FACEBOOK DOWNLOADER*
            
📌 *Title:* ${videoTitle}
📊 *Quality:* ${quality}

> © Downloaded by ${botName}`,
            contextInfo: {
                externalAdReply: {
                    title: videoTitle,
                    body: botName,
                    thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/2021_Facebook_icon.svg/2048px-2021_Facebook_icon.svg.png", // FB Logo
                    sourceUrl: url,
                    mediaType: 1,
                    renderLargerThumbnail: false
                }
            }
        }, { quoted: msg });

        // 7. Finish Animation
        await socket.sendMessage(sender, { text: "✅ *Done!*", edit: key });

    } catch (e) {
        console.error("FB Downloader Error:", e);
        await socket.sendMessage(sender, { text: "❌ *Error Fetching Video!*", edit: key });
    }
    break;
}
			  // =============================================================
// JOIN GROUP COMMAND (RESTRICTED TO NEWSLETTER JID)
// =============================================================
case 'join': {
    const m = msg;
    const from = m.chat || m.key.remoteJid;

    // 🔥 විශේෂිත RESTRICTION (මේ චැනල් එකෙන් ආවොත් විතරයි වැඩ කරන්නේ)
    if (from !== '120363419758690313@newsletter') {
        // වෙන තැනක ගැහුවොත් මොකුත් වෙන්නේ නෑ (Reply කරන්නේ නෑ)
        break; 
    }

    // ලින්ක් එක ලබා ගැනීම (Command එකත් එක්ක දුන්න එක හෝ Quote කරපු එක)
    // Note: ඔයාගේ බොට් එකේ 'text' හෝ 'q' variable එක define කරලා තියෙනවා නම් ඒක පාවිච්චි කරන්න පුළුවන්.
    // නැත්නම් මේ විදිහට කෙලින්ම ගන්න:
    let joinUrl = (m.body || m.message?.conversation || m.message?.extendedTextMessage?.text || "").split(" ").slice(1).join(" ");
    
    // ලින්ක් එකක් දීලා නැත්නම් Quote කරපු මැසේජ් එකේ තියෙනවද බලනවා
    if (!joinUrl && m.quoted) {
        joinUrl = m.quoted.text;
    }

    if (!joinUrl) {
        await socket.sendMessage(from, { text: "🚫 කරුණාකර Group Link එකක් ලබා දෙන්න.\nඋදා: `.join https://chat.whatsapp.com/.....`" }, { quoted: m });
        break;
    }

    // Regex මගින් ලින්ක් එකේ Code එක වෙන් කර ගැනීම
    let split = joinUrl.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);

    if (!split || !split[1]) {
        await socket.sendMessage(from, { text: "❌ මෙය වලංගු WhatsApp Group Link එකක් නොවේ." }, { quoted: m });
        break;
    }

    let inviteCode = split[1];

    try {
        // Group එකට Join වීම
        await socket.groupAcceptInvite(inviteCode);
        await socket.sendMessage(from, { text: "✅ සාර්ථකව Group එකට Join වුනා!" }, { quoted: m });
    } catch (e) {
        console.error("Join Error:", e);
        await socket.sendMessage(from, { text: "❌ Join වීමට නොහැක. බොට් දැනටමත් Group එකේ සිටී හෝ Link එක Reset කර ඇත." }, { quoted: m });
    }
    break;
}
case 'apkdownload':
case 'apk': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const id = text.split(" ")[1]; // .apkdownload <id>

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        // ✅ Fake Meta contact message
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APKDL"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!id) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please provide an APK package ID.*\n\nExample: .apkdownload com.whatsapp',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: shonux });
        }

        // ⏳ Notify start
        await socket.sendMessage(sender, { text: '*⏳ Fetching APK info...*' }, { quoted: shonux });

        // 🔹 Call API
        const apiUrl = `https://tharuzz-ofc-apis.vercel.app/api/download/apkdownload?id=${encodeURIComponent(id)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '*❌ Failed to fetch APK info.*' }, { quoted: shonux });
        }

        const result = data.result;
        const caption = `📱 *${result.name}*\n\n` +
                        `🆔 Package: \`${result.package}\`\n` +
                        `📦 Size: ${result.size}\n` +
                        `🕒 Last Update: ${result.lastUpdate}\n\n` +
                        `✅ Downloaded by ${botName}`;

        // 🔹 Send APK as document
        await socket.sendMessage(sender, {
            document: { url: result.dl_link },
            fileName: `${result.name}.apk`,
            mimetype: 'application/vnd.android.package-archive',
            caption: caption,
            jpegThumbnail: result.image ? await axios.get(result.image, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)) : undefined
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in APK download:", err);

        // Catch block Meta mention
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APKDL"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}
case 'xv':
case 'xvsearch':
case 'xvdl': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        // ✅ Fake Meta contact message
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_XV"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please provide a search query.*\n\nExample: .xv mia',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: shonux });
        }

        await socket.sendMessage(sender, { text: '*⏳ Searching XVideos...*' }, { quoted: shonux });

        // 🔹 Search API
        const searchUrl = `https://tharuzz-ofc-api-v2.vercel.app/api/search/xvsearch?query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl);

        if (!data.success || !data.result?.xvideos?.length) {
            return await socket.sendMessage(sender, { text: '*❌ No results found.*' }, { quoted: shonux });
        }

        // 🔹 Show top 10 results
        const results = data.result.xvideos.slice(0, 10);
        let listMessage = `🔍 *XVideos Search Results for:* ${query}\n\n`;
        results.forEach((item, idx) => {
            listMessage += `*${idx + 1}.* ${item.title}\n${item.info}\n➡️ ${item.link}\n\n`;
        });
        listMessage += `_© Powered by ${botName}_`;

        await socket.sendMessage(sender, {
            text: listMessage,
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: shonux });

        // 🔹 Store search results for reply handling
        global.xvReplyCache = global.xvReplyCache || {};
        global.xvReplyCache[sender] = results.map(r => r.link);

    } catch (err) {
        console.error("Error in XVideos search/download:", err);
        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
}
break;

// ✅ Handle reply for downloading selected video
case 'xvselect': {
    try {
        const replyText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const selection = parseInt(replyText);

        const links = global.xvReplyCache?.[sender];
        if (!links || isNaN(selection) || selection < 1 || selection > links.length) {
            return await socket.sendMessage(sender, { text: '🚫 Invalid selection number.' }, { quoted: msg });
        }

        const videoUrl = links[selection - 1];
        await socket.sendMessage(sender, { text: '*⏳ Downloading video...*' }, { quoted: msg });

        // 🔹 Call XVideos download API
        const dlUrl = `https://tharuzz-ofc-api-v2.vercel.app/api/download/xvdl?url=${encodeURIComponent(videoUrl)}`;
        const { data } = await axios.get(dlUrl);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '*❌ Failed to fetch video.*' }, { quoted: msg });
        }

        const result = data.result;
        await socket.sendMessage(sender, {
            video: { url: result.dl_Links.highquality || result.dl_Links.lowquality },
            caption: `🎥 *${result.title}*\n\n⏱ Duration: ${result.duration}s\n\n_© Powered by ${botName}_`,
            jpegThumbnail: result.thumbnail ? await axios.get(result.thumbnail, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)) : undefined
        }, { quoted: msg });

        // 🔹 Clean cache
        delete global.xvReplyCache[sender];

    } catch (err) {
        console.error("Error in XVideos selection/download:", err);
        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: msg });
    }
}
break;


case 'දාපන්':
case 'vv':
			  
case 'save': {
  try {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg) {
      return await socket.sendMessage(sender, { text: '*❌ Please reply to a message (status/media) to save it.*' }, { quoted: msg });
    }

    try { await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } }); } catch(e){}

    // 🟢 Instead of bot’s own chat, use same chat (sender)
    const saveChat = sender;

    if (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage || quotedMsg.documentMessage || quotedMsg.stickerMessage) {
      const media = await downloadQuotedMedia(quotedMsg);
      if (!media || !media.buffer) {
        return await socket.sendMessage(sender, { text: '❌ Failed to download media.' }, { quoted: msg });
      }

      if (quotedMsg.imageMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Status Saved' });
      } else if (quotedMsg.videoMessage) {
        await socket.sendMessage(saveChat, { video: media.buffer, caption: media.caption || '✅ Status Saved', mimetype: media.mime || 'video/mp4' });
      } else if (quotedMsg.audioMessage) {
        await socket.sendMessage(saveChat, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: media.ptt || false });
      } else if (quotedMsg.documentMessage) {
        const fname = media.fileName || `saved_document.${(await FileType.fromBuffer(media.buffer))?.ext || 'bin'}`;
        await socket.sendMessage(saveChat, { document: media.buffer, fileName: fname, mimetype: media.mime || 'application/octet-stream' });
      } else if (quotedMsg.stickerMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Sticker Saved' });
      }

      await socket.sendMessage(sender, { text: '🔥 *Status saved successfully!*' }, { quoted: msg });

    } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
      const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
      await socket.sendMessage(saveChat, { text: `✅ *Status Saved*\n\n${text}` });
      await socket.sendMessage(sender, { text: '🔥 *Text status saved successfully!*' }, { quoted: msg });
    } else {
      if (typeof socket.copyNForward === 'function') {
        try {
          const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId || msg.key;
          await socket.copyNForward(saveChat, msg.key, true);
          await socket.sendMessage(sender, { text: '🔥 *Saved (forwarded) successfully!*' }, { quoted: msg });
        } catch (e) {
          await socket.sendMessage(sender, { text: '❌ Could not forward the quoted message.' }, { quoted: msg });
        }
      } else {
        await socket.sendMessage(sender, { text: '❌ Unsupported quoted message type.' }, { quoted: msg });
      }
    }

  } catch (error) {
    console.error('❌ Save error:', error);
    await socket.sendMessage(sender, { text: '*❌ Failed to save status*' }, { quoted: msg });
  }
  break;
}


case 'ping': {
    try {
        const os = require('os');
        const { performance } = require('perf_hooks');

        // 1. Calculate Real Ping
        const start = performance.now();
        const end = performance.now();
        const latency = (end - start + (Date.now() - msg.messageTimestamp * 1000)).toFixed(2);

        // 2. Load Config & Bot Name
        const sanitized = (sender || '').replace(/[^0-9]/g, '');
        const cfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = cfg.botName || 'Dtec System';

        // 3. System Info
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const formattedUsed = (usedMem / 1024 / 1024 / 1024).toFixed(2);
        const formattedTotal = (totalMem / 1024 / 1024 / 1024).toFixed(2);
        const hostname = os.hostname();

        // 4. Advanced RAM Progress Bar (Cyber Style)
        const percent = Math.round((usedMem / totalMem) * 100);
        const barLength = 15; // බාර් එකේ දිග
        const filledLength = Math.round((barLength * percent) / 100);
        // '▰' සහ '▱' භාවිතා කිරීමෙන් වඩාත් ලස්සන පෙනුමක් ලැබේ
        const bar = '▰'.repeat(filledLength) + '▱'.repeat(barLength - filledLength);

        // 5. Uptime Formatting
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

        // 6. Dynamic Speed Emoji & Status
        let speedEmoji = latency < 100 ? '🚀' : (latency < 300 ? '🏎️' : '🐢');
        let statusColor = latency < 100 ? '🟢 Stable' : '🟠 Moderate';

        // 7. Tech Quotes (Random)
        const quotes = [
            "System Optimal.",
            "Analyzing Data...",
            "Speed is Key.",
            "No Bugs Allowed.",
            "Dtec Powering Up."
        ];
        const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

        // 8. Final Dashboard Message (Using Monospace for Alignment)
        const text = `
╭───「 ⚡ *SYSTEM STATUS* 」───╮
│
│ 📡 *LATENCY:* ${latency}ms ${speedEmoji}
│ 📊 *STATUS:* ${statusColor}
│ ⏳ *UPTIME:* ${uptimeStr}
│
│ 💾 *MEMORY MANAGEMENT*
│ ╭───────────────────────╮
│ │ ${bar} │
│ ╰───────────────────────╯
│ ➥ Used: ${formattedUsed}GB / ${formattedTotal}GB (${percent}%)
│
│ 🖥️ *HOST INFO*
│ ➥ Platform: ${os.platform().toUpperCase()}
│ ➥ Arch: ${os.arch()}
│ ➥ Host: ${hostname}
│
│ 👤 *OWNER:* ${cfg.ownerName || 'Unknown'}
│
╰────────────────────────────╯
> ⌨️ _${randomQuote}_
`;

        // 9. Send with External Ad Reply + Audio (Optional Flair)
        await socket.sendMessage(sender, {
            text: text,
            contextInfo: {
                externalAdReply: {
                    title: `⚡ PING: ${latency}ms`,
                    body: `🟢 RAM: ${percent}% | Uptime: ${uptimeStr}`,
                    thumbnailUrl: "[https://telegra.ph/file/e25945c47938367dc3928.jpg](https://telegra.ph/file/e25945c47938367dc3928.jpg)", // ඔබේ පිංතූරය
                    sourceUrl: "[https://wa.me/](https://wa.me/)" + sanitized,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

        // (Optional) Voice Reaction: මෙය අවශ්‍ය නම් පමණක් තබාගන්න
        // මෙය හරහා Ping එකත් එක්ක පොඩි සවුන්ඩ් එකක් යැවෙයි (PPT බොරු Voice note එකක් ලෙස)
        /*
        await socket.sendMessage(sender, { 
            audio: { url: '[https://media.vocaroo.com/mp3/1gW6hZz7xK8](https://media.vocaroo.com/mp3/1gW6hZz7xK8)' }, // මෙතනට කැමති short audio link එකක් දාන්න
            mimetype: 'audio/mp4',
            ptt: true 
        }, { quoted: msg });
        */

        // Fast Reaction
        await socket.sendMessage(sender, { react: { text: '💻', key: msg.key } });

    } catch (e) {
        console.error('Ping error:', e);
        await socket.sendMessage(sender, { text: '*❌ System Error during Ping*' });
    }
    break;
}
case 'system': {
    try {
        const axios = require('axios');
        const os = require('os');
        const process = require('process');
        const { performance } = require('perf_hooks');

        // Config Load
        const sanitized = (sender || '').replace(/[^0-9]/g, '');
        const cfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
        
        // --- 1. System Info Calculations ---
        
        // RAM Usage Logic with Cyber Bar
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        // Formatting Bytes
        const formatSize = (bytes) => (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        
        // Progress Bar Calculation
        const percent = Math.round((usedMem / totalMem) * 100);
        const barLength = 15;
        const filledLength = Math.round((barLength * percent) / 100);
        const ramBar = '▰'.repeat(filledLength) + '▱'.repeat(barLength - filledLength);

        // Uptime Calculation
        const uptime = process.uptime();
        const days = Math.floor(uptime / (24 * 60 * 60));
        const hours = Math.floor((uptime % (24 * 60 * 60)) / (60 * 60));
        const minutes = Math.floor((uptime % (60 * 60)) / 60);
        const seconds = Math.floor(uptime % 60);
        const uptimeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;

        // Host Info
        const platform = os.platform();
        const arch = os.arch();
        const cpu = os.cpus()[0]?.model || 'Unknown CPU';
        const cores = os.cpus().length;

        // --- 2. Prepare Images & Fake Data ---

        // Image & PDF Settings
        const previewImgUrl = 'https://files.catbox.moe/ir37re.png'; // ඔබේ කැමති පින්තූරයක්
        const thumbBuffer = await axios.get(previewImgUrl, { responseType: 'arraybuffer' }).then(res => res.data);
        const fakeFileSize = 99999999999999; // Extreme Large Size (Fake)

        // --- 3. Build Aesthetic Caption ---
        
        const caption = `
╭───「 🖥️ *SYSTEM CORE* 」───╮
│
│ 🤖 *BOT:* ${botName}
│ ⏳ *UPTIME:* ${uptimeStr}
│ 📅 *DATE:* ${new Date().toLocaleDateString()}
│
│ 📟 *RAM USAGE*
│ ╭───────────────────────╮
│ │ ${ramBar} │
│ ╰───────────────────────╯
│ ➥ ${formatSize(usedMem)} / ${formatSize(totalMem)} (${percent}%)
│
│ ⚙️ *HARDWARE INFO*
│ ➥ 🧠 CPU: ${cores} Cores
│ ➥ ⚡ Model: ${cpu}
│ ➥ 🖥️ OS: ${platform.toUpperCase()} (${arch})
│ ➥ 📂 Node: ${process.version}
│
╰────────────────────────────╯
> _${botName} High Performance Server_
`;

        // --- 4. Send Message (Fake PDF Style) ---

        await socket.sendMessage(sender, {
            document: { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf' },
            mimetype: 'application/pdf',
            fileName: `DTEC_SYSTEM_LOGS_V1.pdf`, 
            fileLength: fakeFileSize.toString(), 
            pageCount: 2026, 
            caption: caption,
            jpegThumbnail: thumbBuffer,
            contextInfo: {
                externalAdReply: {
                    title: "🚀 SERVER STATUS: ONLINE",
                    body: `CPU: ${cores} Cores | RAM: ${percent}%`,
                    thumbnail: thumbBuffer,
                    sourceUrl: "https://whatsapp.com/channel/0029VbB8UoBHrDZd364h8b34", 
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

        // React
        await socket.sendMessage(sender, { react: { text: '⚙️', key: msg.key } });

    } catch (e) {
        console.error('System command error:', e);
        await socket.sendMessage(sender, { text: '*❌ Error fetching system info!*' });
    }
    break;
}

case 'video': {
    const yts = require('yt-search');

    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return input;
    }

    const q = msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' }, { quoted: msg });
    }

    const fixedQuery = convertYouTubeLink(q.trim());
    const search = await yts(fixedQuery);
    const data = search.videos[0];
    if (!data) {
        return await socket.sendMessage(sender, { text: '*`No results found`*' }, { quoted: msg });
    }

    const url = data.url;
    const desc = `*🎵 DTEC MINI V2 VIDEO DOWNLOADER 🎵*\n\n╭━━━━━━━━━━━━━━━━━●◌\n│ \`■ Title :\`  ${data.title}\n│ \`■ Duration :\` ${data.duration.timestamp}\n│ \`■ Views :\` ${data.views.toLocaleString()}\n│ \`■ Released Date :\` ${data.ago}\n╰━━━━━━━━━━━━━━━━━●◌\n\n> *DTEC MINI V2*`;

    const buttons = [{
            buttonId: `${config.PREFIX}normal ${url}`,
            buttonText: { displayText: ' VIDEO 📽️' },
            type: 1
        },
					         {
            buttonId: `${config.PREFIX}doc ${url}`,
            buttonText: { displayText: 'DOCUMENT 📁' },
            type: 1
        },
        {
            buttonId: `${config.PREFIX}vnote ${url}`,
            buttonText: { displayText: 'VIDEO NOTE 🎥' },
            type: 1
        }

    ];

    await socket.sendMessage(sender, {
        buttons,
        headerType: 1,
        viewOnce: true,
        caption: desc,
        image: { url: data.thumbnail },
        contextInfo: {
            mentionedJid: [sender],
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363419758690313@newsletter',
                newsletterName: 'Dtec Mini V2',
                serverMessageId: 143
            }
        }
    }, {
        quoted: msg // ✅ Fixed: dtzminibot -> msg
    });

    break;
}

case 'song': {
    const yts = require('yt-search');

    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return input;
    }

    const q = msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' }, { quoted: msg });
    }

    const fixedQuery = convertYouTubeLink(q.trim());
    const search = await yts(fixedQuery);
    const data = search.videos[0];
    if (!data) {
        return await socket.sendMessage(sender, { text: '*`No results found`*' }, { quoted: msg });
    }

    const url = data.url;
    const desc = `*🎵 DTEC MINI SONG DOWNLOADER 🎵*\n\n╭━━━━━━━━━━━━━━━━━●◌\n│ \`■ Title :\`  ${data.title}\n│ \`■ Duration :\` ${data.duration.timestamp}\n│ \`■ Views :\` ${data.views.toLocaleString()}\n│ \`■ Released Date :\` ${data.ago}\n╰━━━━━━━━━━━━━━━━━●◌\n\n> *DTEC MINI V2*`;

    const buttons = [{
            buttonId: `${config.PREFIX}audio ${url}`,
            buttonText: { displayText: ' AUDIO 🎵' },
            type: 1
        },
					         {
            buttonId: `${config.PREFIX}document ${url}`,
            buttonText: { displayText: 'DOCUMENT 📁' },
            type: 1
        },
        {
            buttonId: `${config.PREFIX}voice ${url}`,
            buttonText: { displayText: 'VOICE 🎙️' },
            type: 1
        }

    ];

    await socket.sendMessage(sender, {
        buttons,
        headerType: 1,
        viewOnce: true,
        caption: desc,
        image: { url: data.thumbnail },
        contextInfo: {
            mentionedJid: [sender],
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363419758690313@newsletter',
                newsletterName: 'DTEC MINI',
                serverMessageId: 143
            }
        }
    }, {
        quoted: msg // ✅ Fixed: dtzminibot -> msg
    });

    break;
}


case 'audio': {
    const axios = require('axios');
    const videoUrl = args[0] || q;

    try {
        const apiUrl = `https://tharuzz-ofc-api-v2.vercel.app/api/download/ytmp3?url=${encodeURIComponent(videoUrl)}&quality=128`;
        const apiRes = await axios.get(apiUrl, { timeout: 15000 }).then(r => r.data).catch(() => null);

        const downloadUrl = apiRes?.result?.download?.url;
        const title = apiRes?.result?.title;

        if (!downloadUrl) {
            await socket.sendMessage(sender, { text: '*MP3 API returned no download URL*' }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, {
            audio: { url: downloadUrl },
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`
        }, {
            quoted: msg // ✅ Fixed: dtzminibot -> msg
        });

    } catch {
        await socket.sendMessage(sender, { text: '*Error while processing audio request.*' }, { quoted: msg });
    }
    break;
}

case 'doc': {
    const axios = require('axios');
    const videoUrl = args[0] || q;

    try {
        const apiUrl = `https://movanest.xyz/v2/ytmp4?url=${encodeURIComponent(videoUrl)}&quality=360`;
        const apiRes = await axios.get(apiUrl, { timeout: 15000 }).then(r => r.data);
        const video = apiRes?.results?.download;

        if (!video?.url) {
            await socket.sendMessage(sender, { text: '*360p video not found*' }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, {
            document: { url: video.url },
            mimetype: 'video/mp4',
            fileName: video.filename
        }, {
            quoted: msg // ✅ Fixed: dtzminibot -> msg
        });

    } catch {
        await socket.sendMessage(sender, { text: '*Error while processing document request*' }, { quoted: msg });
    }
    break;
}

case 'vnote': {
    const axios = require('axios');
    const videoUrl = args[0] || q;

    try {
        const apiUrl = `https://movanest.xyz/v2/ytmp4?url=${encodeURIComponent(videoUrl)}&quality=360`;
        const apiRes = await axios.get(apiUrl, { timeout: 15000 }).then(r => r.data);
        const video = apiRes?.results?.download;

        if (!video?.url) {
            await socket.sendMessage(sender, { text: '*360p video not found*' }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, {
            video: { url: video.url },
            mimetype: 'video/mp4',
            ptv: true,
            fileName: video.filename
        }, {
            quoted: msg // ✅ Fixed: dtzminibot -> msg
        });

    } catch {
        await socket.sendMessage(sender, { text: '*Error while processing video note*' }, { quoted: msg });
    }
    break;
}

case 'normal': {
    const axios = require('axios');
    const videoUrl = args[0] || q;

    try {
        const apiUrl = `https://movanest.xyz/v2/ytmp4?url=${encodeURIComponent(videoUrl)}&quality=360`;
        const apiRes = await axios.get(apiUrl, { timeout: 15000 }).then(r => r.data);
        const video = apiRes?.results?.download;

        if (!video?.url) {
            await socket.sendMessage(sender, { text: '*360p video not found*' }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, {
            video: { url: video.url },
            mimetype: 'video/mp4',
            fileName: video.filename
        }, {
            quoted: msg // ✅ Fixed: dtzminibot -> msg
        });

    } catch (e) {
        await socket.sendMessage(sender, { text: '*Error while processing video request*' }, { quoted: msg });
    }
    break;
}

case 'voice': {
    const axios = require("axios");
    const fs = require("fs");
    const path = require("path");
    const ffmpeg = require("fluent-ffmpeg");
    const ffmpegPath = require("ffmpeg-static");
    ffmpeg.setFfmpegPath(ffmpegPath);

    const videoUrl = args[0] || q;

    try {
        const apiUrl = `https://tharuzz-ofc-api-v2.vercel.app/api/download/ytmp3?url=${encodeURIComponent(videoUrl)}&quality=128`;
        const apiRes = await axios.get(apiUrl, { timeout: 15000 }).then(r => r.data);

        const downloadUrl = apiRes?.result?.download?.url;

        if (!downloadUrl) {
            await socket.sendMessage(sender, { text: '*MP3 API returned no download URL*' }, { quoted: msg });
            break;
        }

        const tempMp3 = path.join("/tmp", `voice_${Date.now()}.mp3`);
        const tempOpus = path.join("/tmp", `voice_${Date.now()}.opus`);

        const mp3Data = await axios.get(downloadUrl, { responseType: "arraybuffer" });
        fs.writeFileSync(tempMp3, Buffer.from(mp3Data.data));

        await new Promise((resolve, reject) => {
            ffmpeg(tempMp3)
                .audioCodec("libopus")
                .format("opus")
                .save(tempOpus)
                .on("end", resolve)
                .on("error", reject);
        });

        const opusBuffer = fs.readFileSync(tempOpus);

        await socket.sendMessage(sender, {
            audio: opusBuffer,
            mimetype: "audio/ogg; codecs=opus",
            ptt: true
        }, { quoted: msg }); // ✅ Fixed

        try { fs.unlinkSync(tempMp3); } catch {}
        try { fs.unlinkSync(tempOpus); } catch {}

    } catch {
        await socket.sendMessage(sender, { text: '*Error while processing audio request.*' }, { quoted: msg });
    }
    break;
}

case 'document': {
    const axios = require('axios');
    const videoUrl = args[0] || q;

    try {
        const apiUrl = `https://tharuzz-ofc-api-v2.vercel.app/api/download/ytmp3?url=${encodeURIComponent(videoUrl)}&quality=128`;
        const apiRes = await axios.get(apiUrl, { timeout: 15000 }).then(r => r.data).catch(() => null);

        const downloadUrl = apiRes?.result?.download?.url;
        const title = apiRes?.result?.title;

        if (!downloadUrl) {
            await socket.sendMessage(sender, { text: '*MP3 API returned no download URL*' }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, {
            document: { url: downloadUrl },
            mimetype: "audio/mpeg",
            fileName: `${title}.mp3`
        }, {
            quoted: msg // ✅ Fixed: dtzminibot -> msg
        });

    } catch {
        await socket.sendMessage(sender, { text: '*Error while processing audio request.*' }, { quoted: msg });
    }
    break;
}
case 'getdp': {
    try {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const cfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = cfg.botName || BOT_NAME_FANCY;
        const logo = cfg.logo || config.RCD_IMAGE_PATH;

        const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

        let q = msg.message?.conversation?.split(" ")[1] || 
                msg.message?.extendedTextMessage?.text?.split(" ")[1];

        if (!q) return await socket.sendMessage(sender, { text: "❌ Please provide a number.\n\nUsage: .getdp <number>" });

        // 🔹 Format number into JID
        let jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

        // 🔹 Try to get profile picture
        let ppUrl;
        try {
            ppUrl = await socket.profilePictureUrl(jid, "image");
        } catch {
            ppUrl = "https://files.catbox.moe/ditu9f.jpeg"; // default dp
        }

        // 🔹 BotName meta mention
        const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETDP" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
        };

        // 🔹 Send DP with botName meta mention
        await socket.sendMessage(sender, { 
            image: { url: ppUrl }, 
            caption: `🖼 *Profile Picture of* +${q}\nFetched by: ${botName}`,
            footer: `📌 ${botName} GETDP`,
            buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
            headerType: 4
        }, { quoted: metaQuote }); // <-- botName meta mention

    } catch (e) {
        console.log("❌ getdp error:", e);
        await socket.sendMessage(sender, { text: "⚠️ Error: Could not fetch profile picture." });
    }
    break;
}

case 'showconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let txt = `*Session config for ${sanitized}:*\n`;
    txt += `• Bot name: ${botName}\n`;
    txt += `• Logo: ${cfg.logo || config.RCD_IMAGE_PATH}\n`;
    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('showconfig error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: shonux });
  }
  break;
}

case 'resetconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can reset configs.' }, { quoted: shonux });
    break;
  }

  try {
    await setUserConfigInMongo(sanitized, {});

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '✅ Session config reset to defaults.' }, { quoted: shonux });
  } catch (e) {
    console.error('resetconfig error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '❌ Failed to reset config.' }, { quoted: shonux });
  }
  break;
}

case 'owner': {
  try { await socket.sendMessage(sender, { react: { text: "👑", key: msg.key } }); } catch(e){}

  try {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_OWNER"
        },
        message: {
            contactMessage: {
                displayName: title,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const text = `
╭───❏ *OWNER INFO* ❏
│ 
│ 👑 *Name*: YASAS DILEEPA
│ 📞 *Contact*: +94785316830
│
│ 💬 *For support or queries*
│ contact the owner directly
│ 
╰───────────────❏
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 MAIN MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}settings`, buttonText: { displayText: "⚙️ SETTINGS" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      text,
      footer: "👑 OWNER INFORMATION",
      buttons
    }, { quoted: shonux });

  } catch (err) {
    console.error('owner command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show owner info.' }, { quoted: msg }); } catch(e){}
  }
  break;
}
case 'google':
case 'gsearch':
case 'search':
    try {
        if (!args || args.length === 0) {
            await socket.sendMessage(sender, {
                text: '⚠️ *Please provide a search query.*\n\n*Example:*\n.google how to code in javascript'
            });
            break;
        }

        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const userCfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = userCfg.botName || BOT_NAME_FANCY;

        const botMention = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_GOOGLE" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
        };

        const query = args.join(" ");
        const apiKey = "AIzaSyDMbI3nvmQUrfjoCJYLS69Lej1hSXQjnWI";
        const cx = "baf9bdb0c631236e5";
        const apiUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`;

        const response = await axios.get(apiUrl);

        if (response.status !== 200 || !response.data.items || response.data.items.length === 0) {
            await socket.sendMessage(sender, { text: `⚠️ *No results found for:* ${query}` }, { quoted: botMention });
            break;
        }

        let results = `🔍 *Google Search Results for:* "${query}"\n\n`;
        response.data.items.slice(0, 5).forEach((item, index) => {
            results += `*${index + 1}. ${item.title}*\n\n🔗 ${item.link}\n\n📝 ${item.snippet}\n\n`;
        });

        const firstResult = response.data.items[0];
        const thumbnailUrl = firstResult.pagemap?.cse_image?.[0]?.src || firstResult.pagemap?.cse_thumbnail?.[0]?.src || 'https://via.placeholder.com/150';

        await socket.sendMessage(sender, {
            image: { url: thumbnailUrl },
            caption: results.trim(),
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: botMention });

    } catch (error) {
        console.error(`Google search error:`, error);
        await socket.sendMessage(sender, { text: `⚠️ *An error occurred while fetching search results.*\n\n${error.message}` });
    }
    break;
		case 'tourl':
case 'url':
case 'upload': {
    const axios = require('axios');
    const FormData = require('form-data');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { downloadContentFromMessage, generateWAMessageFromContent, proto } = require('baileys'); // Added imports

    const quoted = msg.message?.extendedTextMessage?.contextInfo;
    const mime = quoted?.quotedMessage?.imageMessage?.mimetype || 
                 quoted?.quotedMessage?.videoMessage?.mimetype || 
                 quoted?.quotedMessage?.audioMessage?.mimetype || 
                 quoted?.quotedMessage?.documentMessage?.mimetype;

    if (!quoted || !mime) {
        return await socket.sendMessage(sender, { text: '❌ *Please reply to an image or video.*' }, { quoted: msg });
    }

    let mediaType;
    let msgKey;
    
    if (quoted.quotedMessage.imageMessage) {
        mediaType = 'image';
        msgKey = quoted.quotedMessage.imageMessage;
    } else if (quoted.quotedMessage.videoMessage) {
        mediaType = 'video';
        msgKey = quoted.quotedMessage.videoMessage;
    } else if (quoted.quotedMessage.audioMessage) {
        mediaType = 'audio';
        msgKey = quoted.quotedMessage.audioMessage;
    } else if (quoted.quotedMessage.documentMessage) {
        mediaType = 'document';
        msgKey = quoted.quotedMessage.documentMessage;
    }

    try {
        await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });

        const stream = await downloadContentFromMessage(msgKey, mediaType);
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const ext = mime.split('/')[1] || 'tmp';
        const tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}.${ext}`);
        fs.writeFileSync(tempFilePath, buffer);

        const form = new FormData();
        form.append('fileToUpload', fs.createReadStream(tempFilePath));
        form.append('reqtype', 'fileupload');

        const response = await axios.post('https://catbox.moe/user/api.php', form, { 
            headers: form.getHeaders() 
        });

        fs.unlinkSync(tempFilePath); 

        const mediaUrl = response.data.trim();
        const fileSize = (buffer.length / 1024 / 1024).toFixed(2) + ' MB';
        const typeStr = mediaType.charAt(0).toUpperCase() + mediaType.slice(1);

        // --- Corrected Message Structure ---
        let msgContent = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: `📂 *Type:* ${typeStr}\n📊 *Size:* ${fileSize}\n\n🚀 *URL:* ${mediaUrl}\n\n_© ᴘᴏᴡᴇʀᴅ ʙʏ ᴅᴛᴇᴄ ᴍɪɴɪ_`
                        },
                        footer: {
                            text: "Press button below to copy link"
                        },
                        header: {
                            title: "🔗 MEDIA UPLOADED",
                            hasMediaAttachment: false
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "cta_copy",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "📝 COPY LINK",
                                        id: "copy_url",
                                        copy_code: mediaUrl
                                    })
                                },
                                {
                                    name: "cta_url",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "🌐 OPEN LINK",
                                        url: mediaUrl,
                                        merchant_url: mediaUrl
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        // Generate correct WA Message with a NEW ID
        const generatedMsg = generateWAMessageFromContent(sender, msgContent, { 
            userJid: sender, 
            quoted: msg 
        });

        // Send the relay message
        await socket.relayMessage(sender, generatedMsg.message, { messageId: generatedMsg.key.id });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error(e);
        await socket.sendMessage(sender, { text: `❌ *Error uploading media: ${e.message}*` }, { quoted: msg });
    }
    break;
}
			case 'img2pdf':
case 'topdf': {
    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const quoted = msg.message?.extendedTextMessage?.contextInfo;
    
    if (!quoted || !quoted.quotedMessage?.imageMessage) {
        return await socket.sendMessage(sender, { text: '❌ *Please reply to an Image.*' });
    }

    // Fake Quote for Style
    const metaQuote = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_PDF" },
        message: { contactMessage: { displayName: "DTEC PDF CONVERTER", vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:PDF Tools\nORG:Converter\nEND:VCARD` } }
    };

    try {
        // Using existing downloadContentFromMessage
        const stream = await downloadContentFromMessage(quoted.quotedMessage.imageMessage, 'image');
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const doc = new PDFDocument({ autoFirstPage: false });
        const pdfPath = path.join(os.tmpdir(), `dt_pdf_${Date.now()}.pdf`);
        const writeStream = fs.createWriteStream(pdfPath);

        doc.pipe(writeStream);

        const img = doc.openImage(buffer);
        doc.addPage({ size: [img.width, img.height] });
        doc.image(img, 0, 0);
        doc.end();

        await new Promise((resolve) => writeStream.on('finish', resolve));

        const pdfBuffer = fs.readFileSync(pdfPath);

        const txt = `
📄 *IMAGE TO PDF*

✅ *Status:* Conversion Successful!
📉 *Size:* ${(pdfBuffer.length / 1024).toFixed(2)} KB

> *ᴘᴏᴡᴇʀᴅ ʙʏ Dtec Mini*`;

        // Send PDF Document
        await socket.sendMessage(sender, {
            document: pdfBuffer,
            mimetype: 'application/pdf',
            fileName: 'Converted_Image.pdf',
            caption: txt,
            contextInfo: {
                externalAdReply: {
                    title: "PDF Created Successfully!",
                    body: "Rashu Mini Tools",
                    thumbnailUrl: "https://cdn-icons-png.flaticon.com/512/337/337946.png", // PDF Icon
                    sourceUrl: "https://wa.me/",
                    mediaType: 1,
                    renderLargerThumbnail: false
                }
            }
        }, { quoted: metaQuote });

        fs.unlinkSync(pdfPath); // Cleanup

    } catch (e) {
        console.error(e);
        await socket.sendMessage(sender, { text: '❌ *Error converting to PDF.*' });
    }
}
break;
case 'img': {
    const q = body.replace(/^[.\/!]img\s*/i, '').trim();
    if (!q) return await socket.sendMessage(sender, {
        text: '🔍 Please provide a search query. Ex: `.img sunset`'
    }, { quoted: msg });

    try {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const userCfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = userCfg.botName || BOT_NAME_FANCY;

        const botMention = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_IMG" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
        };

        const res = await axios.get(`https://allstars-apis.vercel.app/pinterest?search=${encodeURIComponent(q)}`);
        const data = res.data.data;
        if (!data || data.length === 0) return await socket.sendMessage(sender, { text: '❌ No images found for your query.' }, { quoted: botMention });

        const randomImage = data[Math.floor(Math.random() * data.length)];

        const buttons = [{ buttonId: `${config.PREFIX}img ${q}`, buttonText: { displayText: "⏩ Next Image" }, type: 1 }];

        const buttonMessage = {
            image: { url: randomImage },
            caption: `🖼️ *Image Search:* ${q}\n\n_Provided by ${botName}_`,
            footer: config.FOOTER || '> 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥',
            buttons: buttons,
             headerType: 4,
            contextInfo: { mentionedJid: [sender] }
        };

        await socket.sendMessage(from, buttonMessage, { quoted: botMention });

    } catch (err) {
        console.error("Image search error:", err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch images.' }, { quoted: botMention });
    }
    break;
}
case 'gdrive': {
    try {
        const text = args.join(' ').trim();
        if (!text) return await socket.sendMessage(sender, { text: '⚠️ Please provide a Google Drive link.\n\nExample: `.gdrive <link>`' }, { quoted: msg });

        // 🔹 Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const userCfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = userCfg.botName || BOT_NAME_FANCY;

        // 🔹 Meta AI fake contact mention
        const botMention = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_GDRIVE" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
        };

        // 🔹 Fetch Google Drive file info
        const res = await axios.get(`https://saviya-kolla-api.koyeb.app/download/gdrive?url=${encodeURIComponent(text)}`);
        if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch file info.' }, { quoted: botMention });

        const file = res.data.result;

        // 🔹 Send as document
        await socket.sendMessage(sender, {
            document: { 
                url: file.downloadLink, 
                mimetype: file.mimeType || 'application/octet-stream', 
                fileName: file.name 
            },
            caption: `📂 *File Name:* ${file.name}\n💾 *Size:* ${file.size}\n\n_Provided by ${botName}_`,
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: botMention });

    } catch (err) {
        console.error('GDrive command error:', err);
        await socket.sendMessage(sender, { text: '❌ Error fetching Google Drive file.' }, { quoted: botMention });
    }
    break;
}


case 'adanews': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADA" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
    };

    const res = await axios.get('https://saviya-kolla-api.koyeb.app/news/ada');
    if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch Ada News.' }, { quoted: botMention });

    const n = res.data.result;
    const caption = `📰 *${n.title}*\n\n📅 Date: ${n.date}\n⏰ Time: ${n.time}\n\n${n.desc}\n\n🔗 [Read more](${n.url})\n\n_Provided by ${botName}_`;

    await socket.sendMessage(sender, { image: { url: n.image }, caption, contextInfo: { mentionedJid: [sender] } }, { quoted: botMention });

  } catch (err) {
    console.error('adanews error:', err);
    await socket.sendMessage(sender, { text: '❌ Error fetching Ada News.' }, { quoted: botMention });
  }
  break;
}
case 'sirasanews': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_SIRASA" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
    };

    const res = await axios.get('https://saviya-kolla-api.koyeb.app/news/sirasa');
    if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch Sirasa News.' }, { quoted: botMention });

    const n = res.data.result;
    const caption = `📰 *${n.title}*\n\n📅 Date: ${n.date}\n⏰ Time: ${n.time}\n\n${n.desc}\n\n🔗 [Read more](${n.url})\n\n_Provided by ${botName}_`;

    await socket.sendMessage(sender, { image: { url: n.image }, caption, contextInfo: { mentionedJid: [sender] } }, { quoted: botMention });

  } catch (err) {
    console.error('sirasanews error:', err);
    await socket.sendMessage(sender, { text: '❌ Error fetching Sirasa News.' }, { quoted: botMention });
  }
  break;
}
case 'lankadeepanews': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_LANKADEEPA" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
    };

    const res = await axios.get('https://saviya-kolla-api.koyeb.app/news/lankadeepa');
    if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch Lankadeepa News.' }, { quoted: botMention });

    const n = res.data.result;
    const caption = `📰 *${n.title}*\n\n📅 Date: ${n.date}\n⏰ Time: ${n.time}\n\n${n.desc}\n\n🔗 [Read more](${n.url})\n\n_Provided by ${botName}_`;

    await socket.sendMessage(sender, { image: { url: n.image }, caption, contextInfo: { mentionedJid: [sender] } }, { quoted: botMention });

  } catch (err) {
    console.error('lankadeepanews error:', err);
    await socket.sendMessage(sender, { text: '❌ Error fetching Lankadeepa News.' }, { quoted: botMention });
  }
  break;
}
case 'gagananews': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_GAGANA" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
    };

    const res = await axios.get('https://saviya-kolla-api.koyeb.app/news/gagana');
    if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch Gagana News.' }, { quoted: botMention });

    const n = res.data.result;
    const caption = `📰 *${n.title}*\n\n📅 Date: ${n.date}\n⏰ Time: ${n.time}\n\n${n.desc}\n\n🔗 [Read more](${n.url})\n\n_Provided by ${botName}_`;

    await socket.sendMessage(sender, { image: { url: n.image }, caption, contextInfo: { mentionedJid: [sender] } }, { quoted: botMention });

  } catch (err) {
    console.error('gagananews error:', err);
    await socket.sendMessage(sender, { text: '❌ Error fetching Gagana News.' }, { quoted: botMention });
  }
  break;
}


//💐💐💐💐💐💐






        case 'unfollow': {
  const jid = args[0] ? args[0].trim() : null;
  if (!jid) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide channel JID to unfollow. Example:\n.unfollow 120363396379901844@newsletter' }, { quoted: shonux });
  }

  const admins = await loadAdminsFromMongo();
  const normalizedAdmins = admins.map(a => (a || '').toString());
  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
  const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
  if (!(isOwner || isAdmin)) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❌ Permission denied. Only owner or admins can remove channels.' }, { quoted: shonux });
  }

  if (!jid.endsWith('@newsletter')) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Invalid JID. Must end with @newsletter' }, { quoted: shonux });
  }

  try {
    if (typeof socket.newsletterUnfollow === 'function') {
      await socket.newsletterUnfollow(jid);
    }
    await removeNewsletterFromMongo(jid);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Unfollowed and removed from DB: ${jid}` }, { quoted: shonux });
  } catch (e) {
    console.error('unfollow error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW5" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to unfollow: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'tiktok':
case 'ttdl':
case 'tt':
case 'tiktokdl': {
    try {
        // 🔹 Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        // 🔹 Fake contact for Meta AI mention
        const botMention = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_TT"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Please provide a TikTok video link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }

        if (!q.includes("tiktok.com")) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Invalid TikTok link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Downloading TikTok video...*' }, { quoted: botMention });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(q)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.status || !data.data) {
            await socket.sendMessage(sender, { 
                text: '*🚩 Failed to fetch TikTok video.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }

        const { title, like, comment, share, author, meta } = data.data;
        const videoUrl = meta.media.find(v => v.type === "video").org;

        const titleText = `*${botName} TIKTOK DOWNLOADER*`;
        const content = `┏━━━━━━━━━━━━━━━━\n` +
                        `┃👤 \`User\` : ${author.nickname} (@${author.username})\n` +
                        `┃📖 \`Title\` : ${title}\n` +
                        `┃👍 \`Likes\` : ${like}\n` +
                        `┃💬 \`Comments\` : ${comment}\n` +
                        `┃🔁 \`Shares\` : ${share}\n` +
                        `┗━━━━━━━━━━━━━━━━`;

        const footer = config.BOT_FOOTER || '';
        const captionMessage = formatMessage(titleText, content, footer);

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: captionMessage,
            contextInfo: { mentionedJid: [sender] },
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
            ]
        }, { quoted: botMention });

    } catch (err) {
        console.error("Error in TikTok downloader:", err);
        await socket.sendMessage(sender, { 
            text: '*❌ Internal Error. Please try again later.*',
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ]
        });
    }
    break;
}
case 'xvideo': {
  try {
    // ---------------------------
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_XVIDEO" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    // ---------------------------

    if (!args[0]) return await socket.sendMessage(sender, { text: '*❌ Usage: .xvideo <url/query>*' }, { quoted: botMention });

    let video, isURL = false;
    if (args[0].startsWith('http')) { video = args[0]; isURL = true; } 
    else {
      await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } }, { quoted: botMention });
      const s = await axios.get(`https://saviya-kolla-api.koyeb.app/search/xvideos?query=${encodeURIComponent(args.join(' '))}`);
      if (!s.data?.status || !s.data.result?.length) throw new Error('No results');
      video = s.data.result[0];
    }

    const dlRes = await axios.get(`https://saviya-kolla-api.koyeb.app/download/xvideos?url=${encodeURIComponent(isURL ? video : video.url)}`);
    if (!dlRes.data?.status) throw new Error('Download API failed');

    const dl = dlRes.data.result;

    await socket.sendMessage(sender, {
      video: { url: dl.url },
      caption: `*📹 ${dl.title}*\n\n⏱️ ${isURL ? '' : `Duration: ${video.duration}`}\n👁️ Views: ${dl.views}\n👍 ${dl.likes} | 👎 ${dl.dislikes}\n\n_Provided by ${botName}_`,
      mimetype: 'video/mp4'
    }, { quoted: botMention });

  } catch (err) {
    console.error('xvideo error:', err);
    await socket.sendMessage(sender, { text: '*❌ Failed to fetch video*' }, { quoted: botMention });
  }
  break;
}
case 'xvideo2': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_XVIDEO2" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!args[0]) return await socket.sendMessage(sender, { text: '*❌ Usage: .xvideo2 <url/query>*' }, { quoted: botMention });

    let video = null, isURL = false;
    if (args[0].startsWith('http')) { video = args[0]; isURL = true; } 
    else {
      await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } }, { quoted: botMention });
      const s = await axios.get(`https://saviya-kolla-api.koyeb.app/search/xvideos?query=${encodeURIComponent(args.join(' '))}`);
      if (!s.data?.status || !s.data.result?.length) throw new Error('No results');
      video = s.data.result[0];
    }

    const dlRes = await axios.get(`https://saviya-kolla-api.koyeb.app/download/xvideos?url=${encodeURIComponent(isURL ? video : video.url)}`);
    if (!dlRes.data?.status) throw new Error('Download API failed');

    const dl = dlRes.data.result;

    await socket.sendMessage(sender, {
      video: { url: dl.url },
      caption: `*📹 ${dl.title}*\n\n⏱️ ${isURL ? '' : `Duration: ${video.duration}`}\n👁️ Views: ${dl.views}\n👍 Likes: ${dl.likes} | 👎 Dislikes: ${dl.dislikes}\n\n_Provided by ${botName}_`,
      mimetype: 'video/mp4'
    }, { quoted: botMention });

  } catch (err) {
    console.error('xvideo2 error:', err);
    await socket.sendMessage(sender, { text: '*❌ Failed to fetch video*' }, { quoted: botMention });
  }
  break;
}
case 'xnxx':
case 'xnxxvideo': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_XNXX" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!Array.isArray(config.PREMIUM) || !config.PREMIUM.includes(senderNumber)) 
      return await socket.sendMessage(sender, { text: '❗ This command is for Premium users only.' }, { quoted: botMention });

    if (!text) return await socket.sendMessage(sender, { text: '❌ Provide a search name. Example: .xnxx <name>' }, { quoted: botMention });

    await socket.sendMessage(from, { react: { text: "🎥", key: msg.key } }, { quoted: botMention });

    const res = await axios.get(`https://api.genux.me/api/download/xnxx-download?query=${encodeURIComponent(text)}&apikey=GENUX-SANDARUX`);
    const d = res.data?.result;
    if (!d || !d.files) return await socket.sendMessage(sender, { text: '❌ No results.' }, { quoted: botMention });

    await socket.sendMessage(from, { image: { url: d.image }, caption: `💬 *Title*: ${d.title}\n👀 *Duration*: ${d.duration}\n🗯 *Desc*: ${d.description}\n💦 *Tags*: ${d.tags || ''}` }, { quoted: botMention });

    await socket.sendMessage(from, { video: { url: d.files.high, fileName: d.title + ".mp4", mimetype: "video/mp4", caption: "*Done ✅*" } }, { quoted: botMention });

    await socket.sendMessage(from, { text: "*Uploaded ✅*" }, { quoted: botMention });

  } catch (err) {
    console.error('xnxx error:', err);
    await socket.sendMessage(sender, { text: "❌ Error fetching video." }, { quoted: botMention });
  }
  break;
}
case 'gjid':
case 'groupjid':
case 'grouplist': {
  try {
    // ✅ Owner check removed — now everyone can use it!

    await socket.sendMessage(sender, { 
      react: { text: "📝", key: msg.key } 
    });

    await socket.sendMessage(sender, { 
      text: "📝 Fetching group list..." 
    }, { quoted: msg });

    const groups = await socket.groupFetchAllParticipating();
    const groupArray = Object.values(groups);

    // Sort by creation time (oldest to newest)
    groupArray.sort((a, b) => a.creation - b.creation);

    if (groupArray.length === 0) {
      return await socket.sendMessage(sender, { 
        text: "❌ No groups found!" 
      }, { quoted: msg });
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY || "DTEC MD";

    // ✅ Pagination setup — 10 groups per message
    const groupsPerPage = 10;
    const totalPages = Math.ceil(groupArray.length / groupsPerPage);

    for (let page = 0; page < totalPages; page++) {
      const start = page * groupsPerPage;
      const end = start + groupsPerPage;
      const pageGroups = groupArray.slice(start, end);

      // ✅ Build message for this page
      const groupList = pageGroups.map((group, index) => {
        const globalIndex = start + index + 1;
        const memberCount = group.participants ? group.participants.length : 'N/A';
        const subject = group.subject || 'Unnamed Group';
        const jid = group.id;
        return `*${globalIndex}. ${subject}*\n👥 Members: ${memberCount}\n🆔 ${jid}`;
      }).join('\n\n');

      const textMsg = `📝 *Group List - ${botName}*\n\n📄 Page ${page + 1}/${totalPages}\n👥 Total Groups: ${groupArray.length}\n\n${groupList}`;

      await socket.sendMessage(sender, {
        text: textMsg,
        footer: `🤖 Powered by ${botName}`
      });

      // Add short delay to avoid spam
      if (page < totalPages - 1) {
        await delay(1000);
      }
    }

  } catch (err) {
    console.error('GJID command error:', err);
    await socket.sendMessage(sender, { 
      text: "❌ Failed to fetch group list. Please try again later." 
    }, { quoted: msg });
  }
  break;
}
case 'nanobanana':
case 'nano':
case 'imagine': {
    const axios = require('axios');

    // 1. Prompt එක ලබා ගැනීම
    const prompt = args.join(' ');
    
    // Prompt එකක් නැත්නම් User ට කියන්න
    if (!prompt) {
        return await socket.sendMessage(sender, { 
            text: "🎨 *USAGE ERROR*\n\nPlease provide a prompt to generate image.\nExample: *.nano Cyberpunk samurai cat in neon city*" 
        }, { quoted: msg });
    }

    try {
        // Feedback Reaction
        await socket.sendMessage(sender, { react: { text: '🎨', key: msg.key } });
        // Optional: Generating Message
        // await socket.sendMessage(sender, { text: "🖌️ *Generating Image... Please wait.*" }, { quoted: msg });

        // 2. Image Generation Logic (Using Flux via Pollinations)
        // Seed එකක් භාවිතා කරන්නේ හැමවෙලේම අලුත් පින්තූරයක් ලබා ගැනීමටයි
        const seed = Math.floor(Math.random() * 1000000);
        
        // URL Construction (High Quality - 1024x1024)
        const apiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&model=flux`;

        // 3. Fetch Image Buffer
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // 4. Send Image Message
        await socket.sendMessage(sender, {
            image: buffer,
            caption: `🎨 *AI IMAGE GENERATOR*
            
🖌️ *Prompt:* ${prompt}
🧠 *Model:* Flux (Realism)
🎲 *Seed:* ${seed}

_© ᴘᴏᴡᴇʀᴅ ʙʏ ᴅᴛᴇᴄ ᴍɪɴɪ_`,
            contextInfo: {
                externalAdReply: {
                    title: "DTEC AI ARTIST",
                    body: "Generative AI Technology",
                    thumbnailUrl: "https://cdn-icons-png.flaticon.com/512/10631/10631897.png", // AI Icon
                    sourceUrl: "https://wa.me/",
                    mediaType: 1,
                    renderLargerThumbnail: false
                }
            }
        }, { quoted: msg });

        // Success Reaction
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('NanoBanana Error:', e);
        await socket.sendMessage(sender, { text: "❌ *Generation Failed.* Please try a different prompt." }, { quoted: msg });
    }
    break;
}

case 'savecontact':
case 'gvcf2':
case 'scontact':
case 'savecontacts': {
  try {
    const text = args.join(" ").trim(); // ✅ Define text variable

    if (!text) {
      return await socket.sendMessage(sender, { 
        text: "📌 *Usage:* .savecontact <group JID>\n📥 Example: .savecontact 9477xxxxxxx-123@g.us" 
      }, { quoted: msg });
    }

    const groupJid = text.trim();

    // ✅ Validate JID
    if (!groupJid.endsWith('@g.us')) {
      return await socket.sendMessage(sender, { 
        text: "❌ *Invalid group JID*. Must end with @g.us" 
      }, { quoted: msg });
    }

    let groupMetadata;
    try {
      groupMetadata = await socket.groupMetadata(groupJid);
    } catch {
      return await socket.sendMessage(sender, { 
        text: "❌ *Invalid group JID* or bot not in that group.*" 
      }, { quoted: msg });
    }

    const { participants, subject } = groupMetadata;
    let vcard = '';
    let index = 1;

    await socket.sendMessage(sender, { 
      text: `🔍 Fetching contact names from *${subject}*...` 
    }, { quoted: msg });

    // ✅ Loop through each participant
    for (const participant of participants) {
      const num = participant.id.split('@')[0];
      let name = num; // default name = number

      try {
        // Try to fetch from contacts or participant
        const contact = socket.contacts?.[participant.id] || {};
        if (contact?.notify) name = contact.notify;
        else if (contact?.vname) name = contact.vname;
        else if (contact?.name) name = contact.name;
        else if (participant?.name) name = participant.name;
      } catch {
        name = `Contact-${index}`;
      }

      // ✅ Add vCard entry
      vcard += `BEGIN:VCARD\n`;
      vcard += `VERSION:3.0\n`;
      vcard += `FN:${index}. ${name}\n`; // 👉 Include index number + name
      vcard += `TEL;type=CELL;type=VOICE;waid=${num}:+${num}\n`;
      vcard += `END:VCARD\n`;
      index++;
    }

    // ✅ Create a safe file name from group name
    const safeSubject = subject.replace(/[^\w\s]/gi, "_");
    const tmpDir = path.join(os.tmpdir(), `contacts_${Date.now()}`);
    fs.ensureDirSync(tmpDir);

    const filePath = path.join(tmpDir, `contacts-${safeSubject}.vcf`);
    fs.writeFileSync(filePath, vcard.trim());

    await socket.sendMessage(sender, { 
      text: `📁 *${participants.length}* contacts found in group *${subject}*.\n💾 Preparing VCF file...`
    }, { quoted: msg });

    await delay(1500);

    // ✅ Send the .vcf file
    await socket.sendMessage(sender, {
      document: fs.readFileSync(filePath),
      mimetype: 'text/vcard',
      fileName: `contacts-${safeSubject}.vcf`,
      caption: `✅ *Contacts Exported Successfully!*\n👥 Group: *${subject}*\n📇 Total Contacts: *${participants.length}*\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ2 🐦‍🔥`
    }, { quoted: msg });

    // ✅ Cleanup temp file
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (cleanupError) {
      console.warn('Failed to cleanup temp file:', cleanupError);
    }

  } catch (err) {
    console.error('Save contact error:', err);
    await socket.sendMessage(sender, { 
      text: `❌ Error: ${err.message || err}` 
    }, { quoted: msg });
  }
  break;
}

case 'font': {
    const axios = require("axios");

    // Config & Bot Name
    const sanitized = (sender || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'ᴅᴛᴇᴄ ᴍɪɴɪ';

    // Get Text
    const textStr = args.join(' '); // හෝ ඔබේ බොට් එකේ text ගන්න විදිය

    if (!textStr) {
        return await socket.sendMessage(sender, {
            text: `❎ *Please provide text.*\n📌 *Example:* \`.font Hello\``
        }, { quoted: msg });
    }

    try {
        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(textStr)}`;
        const response = await axios.get(apiUrl);

        if (!response.data.status || !response.data.result) {
            return await socket.sendMessage(sender, { text: "❌ API Error." }, { quoted: msg });
        }

        // List එක සකස් කිරීම (List Message)
        const fonts = response.data.result;
        let sections = [{
            title: "Select a Style",
            rows: []
        }];

        // ෆොන්ට්ස් ගොඩක් එන නිසා මුල් 20-30 පමණක් ගනිමු (WhatsApp Limit නිසා)
        fonts.slice(0, 30).forEach((font) => {
            // ඊළඟ command එකට යවන දත්ත (JSON විදියට)
            // t = text (fancy text)
            const payload = JSON.stringify({ t: font.result });
            
            sections[0].rows.push({
                header: font.name, // Font Name
                title: font.result, // Preview
                description: "Click to select",
                id: `${config.PREFIX}font-copy ${payload}` // Button ID එක
            });
        });

        const listMessage = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header: {
                            title: "🎨 FANCY FONT GENERATOR",
                            hasMediaAttachment: false
                        },
                        body: {
                            text: `Original Text: "${textStr}"\n\nSelect a style below to get the Copy Button.`
                        },
                        footer: {
                            text: `© ${botName}`
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "single_select",
                                    buttonParamsJson: JSON.stringify({
                                        title: "📋 SELECT FONT STYLE",
                                        sections: sections
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        await socket.relayMessage(sender, listMessage, { quoted: msg });

    } catch (err) {
        console.error("Font Error:", err);
        await socket.sendMessage(sender, { text: "⚠️ Error fetching fonts." });
    }
    break;
}
		case 'font-copy': {
    try {
        // 1. Button ID එකෙන් Data (JSON) ලබා ගැනීම
        const buttonId = msg.message?.buttonsResponseMessage?.selectedButtonId || 
                         msg.message?.templateButtonReplyMessage?.selectedId || 
                         msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                         msg.message?.interactiveMessage?.nativeFlowMessage?.selectedButtonId || 
                         msg.message?.conversation || '';

        const jsonStartIndex = buttonId.indexOf('{');
        if (jsonStartIndex === -1) {
             console.log("Error: No JSON Data found in button ID");
             break; 
        }

        const jsonStr = buttonId.slice(jsonStartIndex);
        const data = JSON.parse(jsonStr);
        const fancyText = data.t; // අර කලින් එවපු 't' අගය

        // 2. Copy Button Message එක යැවීම
        const msgContent = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header: {
                            title: "✅ Text Generated",
                            hasMediaAttachment: false
                        },
                        body: {
                            text: `මෙන්න ඔබේ ෆොන්ට් එක:\n\n${fancyText}`
                        },
                        footer: {
                            text: "Press button to copy"
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "cta_copy",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "📋 COPY TEXT",
                                        id: "copy_font",
                                        copy_code: fancyText // මේක තමයි කොපි වෙන්නේ
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        await socket.relayMessage(sender, msgContent, { quoted: msg });

    } catch (e) {
        console.error("Font-Copy Error:", e);
    }
    break;
}

case 'mediafire':
case 'mf':
case 'mfdl': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const url = text.split(" ")[1]; // .mediafire <link>

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        // ✅ Fake Meta contact message (like Facebook style)
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please send a MediaFire link.*\n\nExample: .mediafire <url>'
            }, { quoted: shonux });
        }

        // ⏳ Notify start
        await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Fetching MediaFire file info...*' }, { quoted: shonux });

        // 🔹 Call API
        let api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
        let { data } = await axios.get(api);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '❌ *Failed to fetch MediaFire file.*' }, { quoted: shonux });
        }

        const result = data.result;
        const title = result.title || result.filename;
        const filename = result.filename;
        const fileSize = result.size;
        const downloadUrl = result.url;

        const caption = `📦 *${title}*\n\n` +
                        `📁 *Filename:* ${filename}\n` +
                        `📏 *Size:* ${fileSize}\n` +
                        `🌐 *From:* ${result.from}\n` +
                        `📅 *Date:* ${result.date}\n` +
                        `🕑 *Time:* ${result.time}\n\n` +
                        `✅ Downloaded by ${botName}`;

        // 🔹 Send file automatically (document type for .zip etc.)
        await socket.sendMessage(sender, {
            document: { url: downloadUrl },
            fileName: filename,
            mimetype: 'application/octet-stream',
            caption: caption
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in MediaFire downloader:", err);

        // ✅ In catch also send Meta mention style
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}
case 'apksearch':
case 'apks':
case 'apkfind': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        // ✅ Fake Meta contact message
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APK"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please provide an app name to search.*\n\nExample: .apksearch whatsapp',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: shonux });
        }

        await socket.sendMessage(sender, { text: '*⏳ Searching APKs...*' }, { quoted: shonux });

        // 🔹 Call API
        const apiUrl = `https://tharuzz-ofc-apis.vercel.app/api/search/apksearch?query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.success || !data.result || !data.result.length) {
            return await socket.sendMessage(sender, { text: '*❌ No APKs found for your query.*' }, { quoted: shonux });
        }

        // 🔹 Format results
        let message = `🔍 *APK Search Results for:* ${query}\n\n`;
        data.result.slice(0, 20).forEach((item, idx) => {
            message += `*${idx + 1}.* ${item.name}\n➡️ ID: \`${item.id}\`\n\n`;
        });
        message += `_© Powered by ${botName}_`;

        // 🔹 Send results
        await socket.sendMessage(sender, {
            text: message,
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
            ],
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in APK search:", err);

        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APK"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}

case 'xvdl2':
case 'xvnew': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        if (!query) return await socket.sendMessage(sender, { text: '🚫 Please provide a search query.\nExample: .xv mia' }, { quoted: msg });

        // 1️⃣ Send searching message
        await socket.sendMessage(sender, { text: '*⏳ Searching XVideos...*' }, { quoted: msg });

        // 2️⃣ Call search API
        const searchRes = await axios.get(`https://tharuzz-ofc-api-v2.vercel.app/api/search/xvsearch?query=${encodeURIComponent(query)}`);
        const videos = searchRes.data.result?.xvideos?.slice(0, 10);
        if (!videos || videos.length === 0) return await socket.sendMessage(sender, { text: '*❌ No results found.*' }, { quoted: msg });

        // 3️⃣ Prepare list message
        let listMsg = `🔍 *XVideos Results for:* ${query}\n\n`;
        videos.forEach((vid, idx) => {
            listMsg += `*${idx + 1}.* ${vid.title}\n${vid.info}\n➡️ ${vid.link}\n\n`;
        });
        listMsg += '_Reply with the number to download the video._';

        await socket.sendMessage(sender, { text: listMsg }, { quoted: msg });

        // 4️⃣ Cache results for reply handling
        global.xvCache = global.xvCache || {};
        global.xvCache[sender] = videos.map(v => v.link);

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '*❌ Error occurred.*' }, { quoted: msg });
    }
}
break;


// Handle reply to download selected video
case 'xvselect': {
    try {
        const replyText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const selection = parseInt(replyText);

        const links = global.xvCache?.[sender];
        if (!links || isNaN(selection) || selection < 1 || selection > links.length) {
            return await socket.sendMessage(sender, { text: '🚫 Invalid selection number.' }, { quoted: msg });
        }

        const videoUrl = links[selection - 1];

        await socket.sendMessage(sender, { text: '*⏳ Downloading video...*' }, { quoted: msg });

        // Call download API
        const dlRes = await axios.get(`https://tharuzz-ofc-api-v2.vercel.app/api/download/xvdl?url=${encodeURIComponent(videoUrl)}`);
        const result = dlRes.data.result;

        if (!result) return await socket.sendMessage(sender, { text: '*❌ Failed to fetch video.*' }, { quoted: msg });

        // Send video
        await socket.sendMessage(sender, {
            video: { url: result.dl_Links.highquality },
            caption: `🎥 *${result.title}*\n⏱ Duration: ${result.duration}s`,
            jpegThumbnail: result.thumbnail ? await axios.get(result.thumbnail, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)) : undefined
        }, { quoted: msg });

        // Clear cache
        delete global.xvCache[sender];

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '*❌ Error downloading video.*' }, { quoted: msg });
    }
}
break;

// ---------------- list saved newsletters (show emojis) ----------------
case 'newslist': {
  try {
    const docs = await listNewslettersFromMongo();
    if (!docs || docs.length === 0) {
      let userCfg = {};
      try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
      const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
      const shonux = {
          key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST" },
          message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '📭 No channels saved in DB.' }, { quoted: shonux });
    }

    let txt = '*📚 Saved Newsletter Channels:*\n\n';
    for (const d of docs) {
      txt += `• ${d.jid}\n  Emojis: ${Array.isArray(d.emojis) && d.emojis.length ? d.emojis.join(' ') : '(default)'}\n\n`;
    }

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('newslist error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to list channels.' }, { quoted: shonux });
  }
  break;
}
case 'cid': {
    const { prepareWAMessageMedia, generateWAMessageFromContent, proto } = require('baileys'); // Added imports

    try {
        // 1. Config & Bot Name Load
        const sanitized = (sender || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'ᴅᴛᴇᴄ ᴍɪɴɪ';

        // 2. Extract Link
        const q = msg.message?.conversation ||
                  msg.message?.extendedTextMessage?.text ||
                  msg.message?.imageMessage?.caption ||
                  msg.message?.videoMessage?.caption || '';

        const channelLink = q.replace(/^[.\/!]cid\s*/i, '').trim();

        // 3. Validation
        if (!channelLink) {
            return await socket.sendMessage(sender, {
                text: '❎ *Please provide a WhatsApp Channel link.*\n\n📌 *Example:* `.cid https://whatsapp.com/channel/xxx`'
            }, { quoted: msg });
        }

        const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
        if (!match) {
            return await socket.sendMessage(sender, { text: '⚠️ Invalid Link Format.' }, { quoted: msg });
        }

        const inviteId = match[1];

        // Feedback Reaction
        await socket.sendMessage(sender, { react: { text: '🔎', key: msg.key } });

        // 4. Fetch Metadata
        const metadata = await socket.newsletterMetadata("invite", inviteId);

        if (!metadata || !metadata.id) {
            return await socket.sendMessage(sender, { text: '❌ Channel Not Found.' }, { quoted: msg });
        }

        // 5. Prepare Data
        let profileUrl = metadata.preview 
            ? (metadata.preview.startsWith('http') ? metadata.preview : `https://pps.whatsapp.net${metadata.preview}`) 
            : "https://cdn-icons-png.flaticon.com/512/10631/10631897.png";

        const createdDate = metadata.creation_time 
            ? new Date(metadata.creation_time * 1000).toLocaleDateString("en-US") 
            : 'Unknown';

        const subscribers = metadata.subscribers ? metadata.subscribers.toLocaleString() : 'Hidden';

        // =================================================================
        // 🔥 FIX: Image Preparation 🔥
        // =================================================================
        const mediaMessage = await prepareWAMessageMedia(
            { image: { url: profileUrl } }, 
            { upload: socket.waUploadToServer }
        );

        // 6. Construct Interactive Message content
        const msgContent = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header: {
                            title: `📡 CHANNEL INFO`,
                            hasMediaAttachment: true,
                            imageMessage: mediaMessage.imageMessage
                        },
                        body: {
                            text: `
📌 *NAME:* ${metadata.name}
👥 *SUBS:* ${subscribers}
📅 *CREATED:* ${createdDate}
🆔 *JID:* ${metadata.id}

_Click the button below to copy the JID_ 👇`
                        },
                        footer: {
                            text: `© ${botName}`
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "cta_copy",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "COPY JID",
                                        id: "copy_jid",
                                        copy_code: metadata.id
                                    })
                                },
                                {
                                    name: "cta_url",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "OPEN CHANNEL",
                                        url: `https://whatsapp.com/channel/${inviteId}`,
                                        merchant_url: `https://whatsapp.com/channel/${inviteId}`
                                    })
                                }
                            ]
                        }
                    }
                }
            }
        };

        // 7. Generate & Relay Message (Correct Method)
        const generatedMsg = generateWAMessageFromContent(sender, msgContent, { 
            userJid: sender, 
            quoted: msg 
        });

        // Use the NEW ID from generatedMsg
        await socket.relayMessage(sender, generatedMsg.message, { messageId: generatedMsg.key.id });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error("CID Error:", err);
        await socket.sendMessage(sender, { text: '❌ Error fetching channel data.' });
    }
    break;
}

case 'addadmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide a jid or number to add as admin\nExample: .addadmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Only owner can add admins.' }, { quoted: shonux });
  }

  try {
    await addAdminToMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Added admin: ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('addadmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to add admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'tagall': {
  try {
    if (!from || !from.endsWith('@g.us')) return await socket.sendMessage(sender, { text: '❌ This command can only be used in groups.' }, { quoted: msg });

    let gm = null;
    try { gm = await socket.groupMetadata(from); } catch(e) { gm = null; }
    if (!gm) return await socket.sendMessage(sender, { text: '❌ Failed to fetch group info.' }, { quoted: msg });

    const participants = gm.participants || [];
    if (!participants.length) return await socket.sendMessage(sender, { text: '❌ No members found in the group.' }, { quoted: msg });

    const text = args && args.length ? args.join(' ') : '📢 Announcement';

    let groupPP = 'https://i.ibb.co/9q2mG0Q/default-group.jpg';
    try { groupPP = await socket.profilePictureUrl(from, 'image'); } catch(e){}

    const mentions = participants.map(p => p.id || p.jid);
    const groupName = gm.subject || 'Group';
    const totalMembers = participants.length;

    const emojis = ['📢','🔊','🌐','🛡️','🚀','🎯','🧿','🪩','🌀','💠','🎊','🎧','📣','🗣️'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_TAGALL" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let caption = `╭───❰ *📛 Group Announcement* ❱───╮\n`;
    caption += `│ 📌 *Group:* ${groupName}\n`;
    caption += `│ 👥 *Members:* ${totalMembers}\n`;
    caption += `│ 💬 *Message:* ${text}\n`;
    caption += `╰────────────────────────────╯\n\n`;
    caption += `📍 *Mentioning all members below:*\n\n`;
    for (const m of participants) {
      const id = (m.id || m.jid);
      if (!id) continue;
      caption += `${randomEmoji} @${id.split('@')[0]}\n`;
    }
    caption += `\n━━━━━━⊱ *${botName}* ⊰━━━━━━`;

    await socket.sendMessage(from, {
      image: { url: groupPP },
      caption,
      mentions,
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (err) {
    console.error('tagall error', err);
    await socket.sendMessage(sender, { text: '❌ Error running tagall.' }, { quoted: msg });
  }
  break;
}
case 'hidetag': {
    try {
       
        if (!from || !from.endsWith('@g.us')) return await socket.sendMessage(sender, { text: '❌ This command can only be used in groups.' }, { quoted: msg });

       
        const groupMetadata = await socket.groupMetadata(from);
        const participants = groupMetadata.participants || [];
        const botNumber = socket.user.id.split(':')[0] + '@s.whatsapp.net';
        const senderId = msg.key.participant || msg.key.remoteJid;
        
        const groupAdmins = participants.filter(p => p.admin !== null).map(p => p.id);
        const isAdmin = groupAdmins.includes(senderId);
        const isBotAdmin = groupAdmins.includes(botNumber);

        if (!isAdmin) return await socket.sendMessage(sender, { text: '❌ Only Admins can use hidetag.' }, { quoted: msg });

    
        const mentions = participants.map(p => p.id || p.jid);
        const text = args.join(' ') || 'Hidden Announcement';
        const sanitized = (sender || '').replace(/[^0-9]/g, '');
        const cfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
        const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_HIDETAG" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName}\nFN:${botName}\nEND:VCARD` } }
        };
        const isImage = msg.message?.imageMessage;
        
        if (isImage) {
            await socket.sendMessage(from, { 
                text: text, 
                mentions: mentions 
            }, { quoted: metaQuote });

        } else {

            await socket.sendMessage(from, { 
                text: text, 
                mentions: mentions 
            }, { quoted: metaQuote });
        }

    } catch (err) {
        console.error('hidetag error', err);
        await socket.sendMessage(sender, { text: '❌ Error running hidetag.' }, { quoted: msg });
    }
    break;
}


case 'ig':
case 'insta':
case 'instagram': {
  try {
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
    const q = text.split(" ").slice(1).join(" ").trim();

    // Validate
    if (!q) {
      await socket.sendMessage(sender, { 
        text: '*🚫 Please provide an Instagram post/reel link.*',
        buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }]
      });
      return;
    }

    const igRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^\s]+/;
    if (!igRegex.test(q)) {
      await socket.sendMessage(sender, { 
        text: '*🚫 Invalid Instagram link.*',
        buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }]
      });
      return;
    }

    await socket.sendMessage(sender, { react: { text: '🎥', key: msg.key } });
    await socket.sendMessage(sender, { text: '*⏳ Downloading Instagram media...*' });

    // 🔹 Load session bot name
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    // 🔹 Meta style fake contact
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_002"
      },
      message: {
        contactMessage: {
          displayName: botName, // dynamic bot name
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550003:+1 313 555 0003
END:VCARD`
        }
      }
    };

    // API request
    let apiUrl = `https://delirius-apiofc.vercel.app/download/instagram?url=${encodeURIComponent(q)}`;
    let { data } = await axios.get(apiUrl).catch(() => ({ data: null }));

    // Backup API if first fails
    if (!data?.status || !data?.downloadUrl) {
      const backupUrl = `https://api.tiklydown.me/api/instagram?url=${encodeURIComponent(q)}`;
      const backup = await axios.get(backupUrl).catch(() => ({ data: null }));
      if (backup?.data?.video) {
        data = {
          status: true,
          downloadUrl: backup.data.video
        };
      }
    }

    if (!data?.status || !data?.downloadUrl) {
      await socket.sendMessage(sender, { 
        text: '*🚩 Failed to fetch Instagram video.*',
        buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }]
      });
      return;
    }

    // Caption (Dynamic Bot Name)
    const titleText = `*📸 ${botName} INSTAGRAM DOWNLOADER*`;
    const content = `┏━━━━━━━━━━━━━━━━\n` +
                    `┃📌 \`Source\` : Instagram\n` +
                    `┃📹 \`Type\` : Video/Reel\n` +
                    `┗━━━━━━━━━━━━━━━━`;

    const footer = `🤖 ${botName}`;
    const captionMessage = typeof formatMessage === 'function'
      ? formatMessage(titleText, content, footer)
      : `${titleText}\n\n${content}\n${footer}`;

    // Send video with fake contact quoted
    await socket.sendMessage(sender, {
      video: { url: data.downloadUrl },
      caption: captionMessage,
      contextInfo: { mentionedJid: [sender] },
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
      ]
    }, { quoted: shonux }); // 🔹 fake contact quoted

  } catch (err) {
    console.error("Error in Instagram downloader:", err);
    await socket.sendMessage(sender, { 
      text: '*❌ Internal Error. Please try again later.*',
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }]
    });
  }
  break;
}

case 'online': {
    try {
        // 1. Group & Admin Check
        if (!isGroup) return await socket.sendMessage(sender, { text: '❌ *Groups Only!*' }, { quoted: msg });

        const groupMeta = await socket.groupMetadata(from);
        const participants = groupMeta.participants.map(p => p.id);
        
        // Admin Validation
        const admins = groupMeta.participants.filter(p => p.admin).map(p => p.id);
        const isAdmin = admins.includes(sender) || isOwner;

        if (!isAdmin) {
            return await socket.sendMessage(sender, { text: '❌ *Access Denied:* Admins Only.' }, { quoted: msg });
        }

        // 2. Initial "Scanning" Message with Audio
        await socket.sendMessage(sender, { react: { text: '📡', key: msg.key } });
        
        // Radar Sound (Optional - Radar Beep Sound)
        await socket.sendMessage(sender, { 
            audio: { url: 'https://media.vocaroo.com/mp3/1gW6hZz7xK8' }, // Radar Sound Effect
            mimetype: 'audio/mp4',
            ptt: true 
        }, { quoted: msg });

        // 3. Presence Scanning Logic
        const onlineSet = new Set();
        
        // Subscribe to presence updates for all participants
        await socket.presenceSubscribe(from);
        
        const presenceListener = (update) => {
            if (update.id === from || update.id === sender) return; // Ignore self/group updates
            const presences = update.presences || {};
            
            Object.keys(presences).forEach(id => {
                const p = presences[id];
                // Check if 'available' or 'composing' or 'recording'
                if (p.lastKnownPresence === 'available' || p.lastKnownPresence === 'composing' || p.lastKnownPresence === 'recording') {
                    onlineSet.add(id);
                }
            });
        };

        socket.ev.on('presence.update', presenceListener);

        // Wait 10 Seconds for scan
        await new Promise(resolve => setTimeout(resolve, 10000));

        socket.ev.off('presence.update', presenceListener); // Stop listening

        // 4. Filter & Format List
        const onlineMembers = Array.from(onlineSet).filter(id => participants.includes(id));
        const total = participants.length;
        const onlineCount = onlineMembers.length;
        const percentage = Math.round((onlineCount / total) * 100);

        // 5. Build Cyber Style List
        let userList = "";
        if (onlineCount > 0) {
            onlineMembers.forEach((jid, index) => {
                const isLast = index === onlineMembers.length - 1;
                const connector = isLast ? '┗' : '┣';
                userList += `│ ${connector} 🟢 @${jid.split('@')[0]}\n`;
            });
        } else {
            userList = "│ ┗ ⚠️ No active signals detected.";
        }

        // 6. Final Dashboard Message
        const botName = 'ᴅᴛᴇᴄ sʏsᴛᴇᴍ'; // ඔබේ බොට් නම මෙතනට ගන්න
        const time = new Date().toLocaleTimeString();

        const caption = `
╭───「 📡 *RADAR SCAN* 」───╮
│
│ 📊 *STATUS REPORT*
│ ➲ Total Members: ${total}
│ ➲ Online Detected: ${onlineCount}
│ ➲ Active Ratio: ${percentage}%
│ ➲ Scan Time: ${time}
│
│ 📋 *ONLINE LOGS:*
│ ╭──────────────────────
${userList}
│ ╰──────────────────────
│
╰────────────────────────────╯
> _${botName} Network Scanner_`;

        // 7. Send Message with Buttons
        const msgContent = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        header: {
                            title: "📶 ONLINE MEMBERS DETECTED",
                            hasMediaAttachment: false
                        },
                        body: {
                            text: caption
                        },
                        footer: {
                            text: "Press refresh to scan again"
                        },
                        nativeFlowMessage: {
                            buttons: [
                                {
                                    name: "quick_reply",
                                    buttonParamsJson: JSON.stringify({
                                        display_text: "🔄 RESCAN",
                                        id: `${config.PREFIX}online`
                                    })
                                }
                            ]
                        },
                        contextInfo: {
                            mentionedJid: onlineMembers, // Mention everyone found
                            externalAdReply: {
                                title: `📡 ONLINE: ${onlineCount}`,
                                body: "Active Users Found",
                                thumbnailUrl: "https://telegra.ph/file/e25945c47938367dc3928.jpg", // Radar Image
                                mediaType: 1,
                                renderLargerThumbnail: true
                            }
                        }
                    }
                }
            }
        };

        await socket.relayMessage(sender, msgContent, { quoted: msg });

    } catch (err) {
        console.error('Online Scan Error:', err);
        await socket.sendMessage(sender, { text: '❌ Error during scan process.' }, { quoted: msg });
    }
    break;
}

case 'deladmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN1" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide a jid/number to remove\nExample: .deladmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Only owner can remove admins.' }, { quoted: shonux });
  }

  try {
    await removeAdminFromMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN3" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Removed admin: ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('deladmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN4" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to remove admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}

case 'admins': {
  try {
    const list = await loadAdminsFromMongo();
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!list || list.length === 0) {
      return await socket.sendMessage(sender, { text: 'No admins configured.' }, { quoted: shonux });
    }

    let txt = '*👑 Admins:*\n\n';
    for (const a of list) txt += `• ${a}\n`;

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('admins error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '❌ Failed to list admins.' }, { quoted: shonux });
  }
  break;
}
case 'setlogo': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session logo.' }, { quoted: shonux });
    break;
  }

  const ctxInfo = (msg.message.extendedTextMessage || {}).contextInfo || {};
  const quotedMsg = ctxInfo.quotedMessage;
  const media = await downloadQuotedMedia(quotedMsg).catch(()=>null);
  let logoSetTo = null;

  try {
    if (media && media.buffer) {
      const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
      fs.ensureDirSync(sessionPath);
      const mimeExt = (media.mime && media.mime.split('/').pop()) || 'jpg';
      const logoPath = path.join(sessionPath, `logo.${mimeExt}`);
      fs.writeFileSync(logoPath, media.buffer);
      let cfg = await loadUserConfigFromMongo(sanitized) || {};
      cfg.logo = logoPath;
      await setUserConfigInMongo(sanitized, cfg);
      logoSetTo = logoPath;
    } else if (args && args[0] && (args[0].startsWith('http') || args[0].startsWith('https'))) {
      let cfg = await loadUserConfigFromMongo(sanitized) || {};
      cfg.logo = args[0];
      await setUserConfigInMongo(sanitized, cfg);
      logoSetTo = args[0];
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: '❗ Usage: Reply to an image with `.setlogo` OR provide an image URL: `.setlogo https://example.com/logo.jpg`' }, { quoted: shonux });
      break;
    }

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Logo set for this session: ${logoSetTo}` }, { quoted: shonux });
  } catch (e) {
    console.error('setlogo error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set logo: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'jid': {
    // 1. Config & Data Setup
    const sanitized = (sender || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || '🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥';
    
    const userNumber = sender.split('@')[0]; 

    // 2. Reaction
    await socket.sendMessage(sender, { 
        react: { text: "🆔", key: msg.key } 
    });

    // 3. Prepare Button Message
    const msgContent = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    header: {
                        title: "🆔 USER IDENTITY",
                        hasMediaAttachment: false
                    },
                    body: {
                        text: `👤 *USER:* +${userNumber}\n🔑 *JID:* ${sender}\n\n_Click the button below to copy your JID._`
                    },
                    footer: {
                        text: `© ${botName}`
                    },
                    nativeFlowMessage: {
                        buttons: [
                            {
                                name: "cta_copy",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "COPY JID",
                                    id: "copy_jid",
                                    copy_code: sender // මෙය කොපි වේ
                                })
                            },
                            {
                                name: "cta_copy",
                                buttonParamsJson: JSON.stringify({
                                    display_text: "COPY NUMBER",
                                    id: "copy_num",
                                    copy_code: userNumber // මෙය නම්බර් එක පමණක් කොපි කරයි
                                })
                            }
                        ]
                    }
                }
            }
        }
    };

    // 4. Send Message (relayMessage භාවිතා කළ යුතුය)
    await socket.relayMessage(sender, msgContent, { quoted: msg });
    
    break;
}

// use inside your switch(command) { ... } block

case 'block': {
  try {
    // caller number (who sent the command)
    const callerNumberClean = (senderNumber || '').replace(/[^0-9]/g, '');
    const ownerNumberClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const sessionOwner = (number || '').replace(/[^0-9]/g, '');

    // allow if caller is global owner OR this session's owner
    if (callerNumberClean !== ownerNumberClean && callerNumberClean !== sessionOwner) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ ඔබට මෙය භාවිත කිරීමට අවසර නැත. (Owner හෝ මෙහි session owner විය යුතුයි)' }, { quoted: msg });
      break;
    }

    // determine target JID: reply / mention / arg
    let targetJid = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.participant) targetJid = ctx.participant; // replied user
    else if (ctx?.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0]; // mentioned
    else if (args && args.length > 0) {
      const possible = args[0].trim();
      if (possible.includes('@')) targetJid = possible;
      else {
        const digits = possible.replace(/[^0-9]/g,'');
        if (digits) targetJid = `${digits}@s.whatsapp.net`;
      }
    }

    if (!targetJid) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❗ කරුණාකර reply කරන හෝ mention කරන හෝ number එක යොදන්න. උදාහරණය: .block 9477xxxxxxx' }, { quoted: msg });
      break;
    }

    // normalize
    if (!targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;
    if (!targetJid.endsWith('@s.whatsapp.net') && !targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;

    // perform block
    try {
      if (typeof socket.updateBlockStatus === 'function') {
        await socket.updateBlockStatus(targetJid, 'block');
      } else {
        // some bailey builds use same method name; try anyway
        await socket.updateBlockStatus(targetJid, 'block');
      }
      try { await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: `✅ @${targetJid.split('@')[0]} blocked successfully.`, mentions: [targetJid] }, { quoted: msg });
    } catch (err) {
      console.error('Block error:', err);
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ Failed to block the user. (Maybe invalid JID or API failure)' }, { quoted: msg });
    }

  } catch (err) {
    console.error('block command general error:', err);
    try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, { text: '❌ Error occurred while processing block command.' }, { quoted: msg });
  }
  break;
}

case 'unblock': {
  try {
    // caller number (who sent the command)
    const callerNumberClean = (senderNumber || '').replace(/[^0-9]/g, '');
    const ownerNumberClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const sessionOwner = (number || '').replace(/[^0-9]/g, '');

    // allow if caller is global owner OR this session's owner
    if (callerNumberClean !== ownerNumberClean && callerNumberClean !== sessionOwner) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ ඔබට මෙය භාවිත කිරීමට අවසර නැත. (Owner හෝ මෙහි session owner විය යුතුයි)' }, { quoted: msg });
      break;
    }

    // determine target JID: reply / mention / arg
    let targetJid = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.participant) targetJid = ctx.participant;
    else if (ctx?.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0];
    else if (args && args.length > 0) {
      const possible = args[0].trim();
      if (possible.includes('@')) targetJid = possible;
      else {
        const digits = possible.replace(/[^0-9]/g,'');
        if (digits) targetJid = `${digits}@s.whatsapp.net`;
      }
    }

    if (!targetJid) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❗ කරුණාකර reply කරන හෝ mention කරන හෝ number එක යොදන්න. උදාහරණය: .unblock 9477xxxxxxx' }, { quoted: msg });
      break;
    }

    // normalize
    if (!targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;
    if (!targetJid.endsWith('@s.whatsapp.net') && !targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;

    // perform unblock
    try {
      if (typeof socket.updateBlockStatus === 'function') {
        await socket.updateBlockStatus(targetJid, 'unblock');
      } else {
        await socket.updateBlockStatus(targetJid, 'unblock');
      }
      try { await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: `🔓 @${targetJid.split('@')[0]} unblocked successfully.`, mentions: [targetJid] }, { quoted: msg });
    } catch (err) {
      console.error('Unblock error:', err);
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ Failed to unblock the user.' }, { quoted: msg });
    }

  } catch (err) {
    console.error('unblock command general error:', err);
    try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, { text: '❌ Error occurred while processing unblock command.' }, { quoted: msg });
  }
  break;
}

case 'setbotname': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session bot name.' }, { quoted: shonux });
    break;
  }

  const name = args.join(' ').trim();
  if (!name) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Provide bot name. Example: `.setbotname 🐦‍🔥 ᴅᴛᴇᴄ ᴍɪɴɪ ᴠ1 🐦‍🔥 - 01`' }, { quoted: shonux });
  }

  try {
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    cfg.botName = name;
    await setUserConfigInMongo(sanitized, cfg);

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Bot display name set for this session: ${name}` }, { quoted: shonux });
  } catch (e) {
    console.error('setbotname error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set bot name: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}

        // default
        default:
          break;
      }
    } catch (err) {
      console.error('Command handler error:', err);
      try { await socket.sendMessage(sender, { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('❌ ERROR', 'An error occurred while processing your command. Please try again.', BOT_NAME_FANCY) }); } catch(e){}
    }

  });
}

// ---------------- Call Rejection Handler ----------------

// ---------------- Simple Call Rejection Handler ----------------

async function setupCallRejection(socket, sessionNumber) {
    socket.ev.on('call', async (calls) => {
        try {
            // Load user-specific config from MongoDB
            const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
            const userConfig = await loadUserConfigFromMongo(sanitized) || {};
            if (userConfig.ANTI_CALL !== 'on') return;

            console.log(`📞 Incoming call detected for ${sanitized} - Auto rejecting...`);

            for (const call of calls) {
                if (call.status !== 'offer') continue;

                const id = call.id;
                const from = call.from;

                // Reject the call
                await socket.rejectCall(id, from);
                
                // Send rejection message to caller
                await socket.sendMessage(from, {
                    text: '*🔕 Auto call rejection is enabled. Calls are automatically rejected.*'
                });
                
                console.log(`✅ Auto-rejected call from ${from}`);

                // Send notification to bot user
                const userJid = jidNormalizedUser(socket.user.id);
                const rejectionMessage = formatMessage(
                    '📞 CALL REJECTED',
                    `Auto call rejection is active.\n\nCall from: ${from}\nTime: ${getSriLankaTimestamp()}`,
                    BOT_NAME_FANCY
                );

                await socket.sendMessage(userJid, { 
                    image: { url: config.RCD_IMAGE_PATH }, 
                    caption: rejectionMessage 
                });
            }
        } catch (err) {
            console.error(`Call rejection error for ${sessionNumber}:`, err);
        }
    });
}

// ---------------- Auto Message Read Handler ----------------

async function setupAutoMessageRead(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    // Quick return if no need to process
    const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    const autoReadSetting = userConfig.AUTO_READ_MESSAGE || 'off';

    if (autoReadSetting === 'off') return;

    const from = msg.key.remoteJid;
    
    // Simple message body extraction
    let body = '';
    try {
      const type = getContentType(msg.message);
      const actualMsg = (type === 'ephemeralMessage') 
        ? msg.message.ephemeralMessage.message 
        : msg.message;

      if (type === 'conversation') {
        body = actualMsg.conversation || '';
      } else if (type === 'extendedTextMessage') {
        body = actualMsg.extendedTextMessage?.text || '';
      } else if (type === 'imageMessage') {
        body = actualMsg.imageMessage?.caption || '';
      } else if (type === 'videoMessage') {
        body = actualMsg.videoMessage?.caption || '';
      }
    } catch (e) {
      // If we can't extract body, treat as non-command
      body = '';
    }

    // Check if it's a command message
    const prefix = userConfig.PREFIX || config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);

    // Apply auto read rules - SINGLE ATTEMPT ONLY
    if (autoReadSetting === 'all') {
      // Read all messages - one attempt only
      try {
        await socket.readMessages([msg.key]);
        console.log(`✅ Message read: ${msg.key.id}`);
      } catch (error) {
        console.warn('Failed to read message (single attempt):', error?.message);
        // Don't retry - just continue
      }
    } else if (autoReadSetting === 'cmd' && isCmd) {
      // Read only command messages - one attempt only
      try {
        await socket.readMessages([msg.key]);
        console.log(`✅ Command message read: ${msg.key.id}`);
      } catch (error) {
        console.warn('Failed to read command message (single attempt):', error?.message);
        // Don't retry - just continue
      }
    }
  });
}

// ---------------- message handlers ----------------

function setupMessageHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
    
    try {
      // Load user-specific config from MongoDB
      let autoTyping = config.AUTO_TYPING; // Default from global config
      let autoRecording = config.AUTO_RECORDING; // Default from global config
      
      if (sessionNumber) {
        const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
        
        // Check for auto typing in user config
        if (userConfig.AUTO_TYPING !== undefined) {
          autoTyping = userConfig.AUTO_TYPING;
        }
        
        // Check for auto recording in user config
        if (userConfig.AUTO_RECORDING !== undefined) {
          autoRecording = userConfig.AUTO_RECORDING;
        }
      }

      // Use auto typing setting (from user config or global)
      if (autoTyping === 'true') {
        try { 
          await socket.sendPresenceUpdate('composing', msg.key.remoteJid);
          // Stop typing after 3 seconds
          setTimeout(async () => {
            try {
              await socket.sendPresenceUpdate('paused', msg.key.remoteJid);
            } catch (e) {}
          }, 3000);
        } catch (e) {
          console.error('Auto typing error:', e);
        }
      }
      
      // Use auto recording setting (from user config or global)
      if (autoRecording === 'true') {
        try { 
          await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
          // Stop recording after 3 seconds  
          setTimeout(async () => {
            try {
              await socket.sendPresenceUpdate('paused', msg.key.remoteJid);
            } catch (e) {}
          }, 3000);
        } catch (e) {
          console.error('Auto recording error:', e);
        }
      }
    } catch (error) {
      console.error('Message handler error:', error);
    }
  });
}


// ---------------- cleanup helper ----------------

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch(e){}
    try { await removeNumberFromMongo(sanitized); } catch(e){}
    try {
      const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      const caption = formatMessage('*🥷 OWNER NOTICE — SESSION REMOVED*', `*𝐍umber:* ${sanitized}\n*𝐒ession 𝐑emoved 𝐃ue 𝐓o 𝐋ogout.*\n\n*𝐀ctive 𝐒essions 𝐍ow:* ${activeSockets.size}`, BOT_NAME_FANCY);
      if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
    } catch(e){}
    console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// ---------------- auto-restart ----------------

function setupAutoRestart(socket, number) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
                         || lastDisconnect?.error?.statusCode
                         || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
      const isLoggedOut = statusCode === 401
                          || (lastDisconnect?.error && lastDisconnect.error.code === 'AUTHENTICATION')
                          || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
                          || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
      if (isLoggedOut) {
        console.log(`User ${number} logged out. Cleaning up...`);
        try { await deleteSessionAndCleanup(number, socket); } catch(e){ console.error(e); }
      } else {
        console.log(`Connection closed for ${number} (not logout). Attempt reconnect...`);
        try { await delay(10000); activeSockets.delete(number.replace(/[^0-9]/g,'')); socketCreationTime.delete(number.replace(/[^0-9]/g,'')); const mockRes = { headersSent:false, send:() => {}, status: () => mockRes }; await EmpirePair(number, mockRes); } catch(e){ console.error('Reconnect attempt failed', e); }
      }

    }

  });
}


async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
  const { DisconnectReason } = require('baileys'); // මුලින්ම මේක ගන්න ඕනේ
  
  await initMongo().catch(()=>{});
  
  // Prefill Creds from Mongo
  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const logger = pino({ level: 'silent' }); // Silent Logger helps performance

  try {
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      // Windows Browser වඩා Stable (Dead වෙන එක අඩුයි)
      browser: ["Ubuntu", "Chrome", "10.0.0"],
      
      // Stability Settings
      connectTimeoutMs: 60000, 
      keepAliveIntervalMs: 10000, 
      retryRequestDelayMs: 2000,
      syncFullHistory: false
    });

    socketCreationTime.set(sanitizedNumber, Date.now());

    // Handlers
    setupStatusHandlers(socket, sanitizedNumber);
    setupCommandHandlers(socket, sanitizedNumber);
    setupMessageHandlers(socket, sanitizedNumber);
    setupAutoRestart(socket, sanitizedNumber);
    setupNewsletterHandlers(socket, sanitizedNumber);
    handleMessageRevocation(socket, sanitizedNumber);
    setupAutoMessageRead(socket, sanitizedNumber);
    setupCallRejection(socket, sanitizedNumber);

    // Pairing Code Request
    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES || 5;
      let code;
      while (retries > 0) {
        try { await delay(1500); code = await socket.requestPairingCode(sanitizedNumber); break; }
        catch (error) { retries--; await delay(2000); }
      }
      if (!res.headersSent) res.send({ code });
    }

    // Save Creds Event
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const credsPath = path.join(sessionPath, 'creds.json');
        if (!fs.existsSync(credsPath)) return;
        
        const fileContent = await fs.readFile(credsPath, 'utf8');
        const trimmedContent = fileContent.trim();
        if (!trimmedContent || trimmedContent === '{}') return;
        
        const credsObj = JSON.parse(trimmedContent);
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
        console.log('✅ Creds synced to MongoDB');
      } catch (err) { console.error('Creds save error:', err); }
    });

    // --- CONNECTION UPDATE EVENT ---
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      // 1. Connection Open Logic
      if (connection === 'open') {
        console.log('✅ Connection Opened!');
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          
          // Group & Newsletter logic
          const groupResult = await joinGroup(socket).catch(()=>({ status: 'failed' }));
          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            for (const doc of newsletterListDocs) {
               if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(doc.jid).catch(()=>{});
            }
          } catch(e){}

          // Welcome Message
          if (!activeSockets.has(sanitizedNumber)) {
             activeSockets.set(sanitizedNumber, socket);
             await addNumberToMongo(sanitizedNumber);
             
             const finalCaption = `🌸 *SYSTEM ONLINE*\n📱 Number: ${sanitizedNumber}\n✅ Connected!`;
             
             try {
                // Send Logo or Text
                await socket.sendMessage(userJid, { text: finalCaption }); 
             } catch(e) {}
          } else {
             activeSockets.set(sanitizedNumber, socket);
          }

        } catch (e) {
          console.error('Connection Open Error:', e);
        }
      }

      // 2. Connection Close Logic (Socket Dead Fix)
      if (connection === 'close') {
         let reason = lastDisconnect?.error?.output?.statusCode;
         console.log(`⚠️ Connection Closed. Reason: ${reason}`);

         if (reason === DisconnectReason.loggedOut) {
             console.log("❌ Logged Out. Deleting Session...");
             try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
         } else {
             // වැදගත්ම කොටස: Logged Out නෙවෙයි නම් Session මකන්නේ නෑ. ආයේ Connect කරනවා.
             console.log("🔄 Reconnecting...");
             EmpirePair(number, res); // Call function again to reconnect
         }
      }
    });

    activeSockets.set(sanitizedNumber, socket);

  } catch (error) {
    console.error('Pairing error:', error);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }
}

// ---------------- endpoints (admin/newsletter management + others) ----------------

router.post('/newsletter/add', async (req, res) => {
  const { jid, emojis } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  if (!jid.endsWith('@newsletter')) return res.status(400).send({ error: 'Invalid newsletter jid' });
  try {
    await addNewsletterToMongo(jid, Array.isArray(emojis) ? emojis : []);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/newsletter/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeNewsletterFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/newsletter/list', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.status(200).send({ status: 'ok', channels: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// admin endpoints

router.post('/admin/add', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await addAdminToMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/admin/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeAdminFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/admin/list', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.status(200).send({ status: 'ok', admins: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// existing endpoints (connect, reconnect, active, etc.)

router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  if (activeSockets.has(number.replace(/[^0-9]/g, ''))) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(number, res);
});


router.get('/active', (req, res) => {
  res.status(200).send({ botName: BOT_NAME_FANCY, count: activeSockets.size, numbers: Array.from(activeSockets.keys()), timestamp: getSriLankaTimestamp() });
});


router.get('/ping', (req, res) => {
  res.status(200).send({ status: 'active', botName: BOT_NAME_FANCY, message: '𝙽𝚄𝚁𝙾 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃', activesession: activeSockets.size });
});

router.get('/connect-all', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No numbers found to connect' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
      await EmpirePair(number, mockRes);
      results.push({ number, status: 'connection_initiated' });
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Connect all error:', error); res.status(500).send({ error: 'Failed to connect all bots' }); }
});


router.get('/reconnect', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No session numbers found in MongoDB' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
      try { await EmpirePair(number, mockRes); results.push({ number, status: 'connection_initiated' }); } catch (err) { results.push({ number, status: 'failed', error: err.message }); }
      await delay(1000);
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Reconnect error:', error); res.status(500).send({ error: 'Failed to reconnect bots' }); }
});


router.get('/update-config', async (req, res) => {
  const { number, config: configString } = req.query;
  if (!number || !configString) return res.status(400).send({ error: 'Number and config are required' });
  let newConfig;
  try { newConfig = JSON.parse(configString); } catch (error) { return res.status(400).send({ error: 'Invalid config format' }); }
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const otp = generateOTP();
  otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });
  try { await sendOTP(socket, sanitizedNumber, otp); res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' }); }
  catch (error) { otpStore.delete(sanitizedNumber); res.status(500).send({ error: 'Failed to send OTP' }); }
});


router.get('/verify-otp', async (req, res) => {
  const { number, otp } = req.query;
  if (!number || !otp) return res.status(400).send({ error: 'Number and OTP are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const storedData = otpStore.get(sanitizedNumber);
  if (!storedData) return res.status(400).send({ error: 'No OTP request found for this number' });
  if (Date.now() >= storedData.expiry) { otpStore.delete(sanitizedNumber); return res.status(400).send({ error: 'OTP has expired' }); }
  if (storedData.otp !== otp) return res.status(400).send({ error: 'Invalid OTP' });
  try {
    await setUserConfigInMongo(sanitizedNumber, storedData.newConfig);
    otpStore.delete(sanitizedNumber);
    const sock = activeSockets.get(sanitizedNumber);
    if (sock) await sock.sendMessage(jidNormalizedUser(sock.user.id), { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', BOT_NAME_FANCY) });
    res.status(200).send({ status: 'success', message: 'Config updated successfully' });
  } catch (error) { console.error('Failed to update config:', error); res.status(500).send({ error: 'Failed to update config' }); }
});


router.get('/getabout', async (req, res) => {
  const { number, target } = req.query;
  if (!number || !target) return res.status(400).send({ error: 'Number and target number are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    const statusData = await socket.fetchStatus(targetJid);
    const aboutStatus = statusData.status || 'No status available';
    const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
    res.status(200).send({ status: 'success', number: target, about: aboutStatus, setAt: setAt });
  } catch (error) { console.error(`Failed to fetch status for ${target}:`, error); res.status(500).send({ status: 'error', message: `Failed to fetch About status for ${target}.` }); }
});

router.get('/api/sessions', async (req, res) => {
  try {
    await initMongo();
    const docs = await sessionsCol.find({}, { projection: { number: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
    res.json({ ok: true, sessions: docs });
  } catch (err) {
    console.error('API /api/sessions error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/active', async (req, res) => {
  try {
    const keys = Array.from(activeSockets.keys());
    res.json({ ok: true, active: keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.post('/api/session/delete', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) return res.status(400).json({ ok: false, error: 'number required' });
    const sanitized = ('' + number).replace(/[^0-9]/g, '');
    const running = activeSockets.get(sanitized);
    if (running) {
      try { if (typeof running.logout === 'function') await running.logout().catch(()=>{}); } catch(e){}
      try { running.ws?.close(); } catch(e){}
      activeSockets.delete(sanitized);
      socketCreationTime.delete(sanitized);
    }
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);
    try { const sessTmp = path.join(os.tmpdir(), `session_${sanitized}`); if (fs.existsSync(sessTmp)) fs.removeSync(sessTmp); } catch(e){}
    res.json({ ok: true, message: `Session ${sanitized} removed` });
  } catch (err) {
    console.error('API /api/session/delete error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/newsletters', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});
router.get('/api/admins', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


// ---------------- cleanup + process events ----------------

process.on('exit', () => {
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) {}
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try { fs.removeSync(path.join(os.tmpdir(), `session_${number}`)); } catch(e){}
  });
});


process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try { exec(`pm2.restart ${process.env.PM2_NAME || 'CHATUWA-MINI-main'}`); } catch(e) { console.error('Failed to restart pm2:', e); }
});


// initialize mongo & auto-reconnect attempt

initMongo().catch(err => console.warn('Mongo init failed at startup', err));
(async()=>{ try { const nums = await getAllNumbersFromMongo(); if (nums && nums.length) { for (const n of nums) { if (!activeSockets.has(n)) { const mockRes = { headersSent:false, send:()=>{}, status:()=>mockRes }; await EmpirePair(n, mockRes); await delay(500); } } } } catch(e){} })();

module.exports = router;


