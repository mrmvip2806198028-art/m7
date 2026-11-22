// موقع + بوت ديسكورد في مشروع واحد. الموقع يطلع ID قصير والبوت يعمل السيرفر بيه.
require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ChannelType,
} = require("discord.js");

/* ---------- تخزين بسيط (ملف JSON) ---------- */
const DB = path.join(__dirname, "data.json");
const load = () => { try { return JSON.parse(fs.readFileSync(DB, "utf8")); } catch { return {}; } };
const save = (d) => fs.writeFileSync(DB, JSON.stringify(d));
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newId(db) {
  let id;
  do { id = Array.from({ length: 6 }, () => ABC[Math.floor(Math.random() * ABC.length)]).join(""); }
  while (db[id]);
  return id;
}

/* ---------- Claude API ---------- */
async function ask(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "API error");
  return j.content.map((c) => c.text || "").join("");
}

const serverPrompt = (t) =>
  `أنت خبير تصميم سيرفرات ديسكورد. المستخدم عايز: ${t}
ارجع JSON فقط بدون أي كلام تاني وبدون backticks بالشكل ده:
{"name":"اسم السيرفر","description":"وصف قصير","roles":[{"name":"اسم الرتبة","color":"#hex"}],"categories":[{"name":"اسم الكاتيجوري","channels":[{"name":"اسم الروم","type":"text او voice"}]}]}
القواعد: من 8 لـ 12 رتبة مرتبة من الأعلى للأقل، ومن 5 لـ 8 كاتيجوريز (ترحيب، قوانين، أخبار، شات، صوتيات، تيكتات...). أسماء الرومات بإيموجي في الأول وشرطة بدل المسافات. اللغة مصري/عربي بسيط أو إنجليزي حسب نوع السيرفر.`;

const logoPrompt = (t) =>
  `ارسم لوجو لسيرفر ديسكورد: ${t}
ارجع كود SVG واحد فقط بدون شرح وبدون backticks. viewBox="0 0 512 512"، تصميم مسطح عصري بألوان متناسقة، شكل رمزي بسيط، من غير scripts ولا صور خارجية.`;

/* ---------- الموقع ---------- */
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/server", async (req, res) => {
  try {
    const text = String(req.body.text || "").slice(0, 500);
    if (!text) return res.status(400).json({ error: "اكتب عايز ايه" });
    const out = await ask(serverPrompt(text));
    const data = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    const db = load();
    const id = newId(db);
    db[id] = { ...data, t: Date.now() };
    save(db);
    res.json({ id, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/logo", async (req, res) => {
  try {
    const out = await ask(logoPrompt(String(req.body.text || "").slice(0, 500)));
    let svg = out.slice(out.indexOf("<svg"), out.lastIndexOf("</svg>") + 6);
    svg = svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
    if (!svg.startsWith("<svg")) throw new Error("مطلعش لوجو، جرب تاني");
    res.json({ svg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("Site is up"));

/* ---------- البوت ---------- */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const command = new SlashCommandBuilder()
  .setName("code")
  .setDescription("طبّق سيرفر من الـ ID اللي طلع في الموقع")
  .addStringOption((o) =>
    o.setName("id").setDescription("الـ ID (6 حروف)").setRequired(true).setMaxLength(12)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: [command.toJSON()] });
  console.log(`Bot ready as ${client.user.tag}`);
});

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== "code") return;
  if (!i.memberPermissions.has(PermissionFlagsBits.Administrator))
    return i.reply({ content: "الأمر ده للأدمن بس.", ephemeral: true });

  const id = i.options.getString("id").trim().toUpperCase();
  const d = load()[id];
  if (!d) return i.reply({ content: "الـ ID ده مش موجود، اتأكد منه.", ephemeral: true });

  await i.reply({ content: "⏳ بجهز السيرفر، استنى شوية...", ephemeral: true });
  const guild = i.guild;
  let rolesDone = 0, chDone = 0;
  try {
    // الرتب من الأقل للأعلى عشان الترتيب يطلع صح
    for (const r of [...(d.roles || [])].slice(0, 50).reverse()) {
      await guild.roles.create({
        name: String(r.name).slice(0, 100),
        color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : undefined,
        reason: "Server builder",
      });
      rolesDone++;
    }
    for (const k of (d.categories || []).slice(0, 30)) {
      const parent = await guild.channels.create({
        name: String(k.name).slice(0, 100),
        type: ChannelType.GuildCategory,
      });
      for (const c of (k.channels || []).slice(0, 25)) {
        await guild.channels.create({
          name: String(c.name).slice(0, 100),
          type: c.type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText,
          parent: parent.id,
        });
        chDone++;
      }
    }
    await i.editReply(`✅ خلصت! اتعمل ${rolesDone} رتبة و${chDone} روم.`);
  } catch (e) {
    console.error(e);
    await i.editReply(
      `⚠️ وقفت في النص (${rolesDone} رتبة، ${chDone} روم). اتأكد إن البوت Administrator ورتبته فوق الرتب.\n${e.message}`
    );
  }
});

client.login(process.env.TOKEN);
