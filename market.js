require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  PermissionsBitField,
  REST,
  Routes,
  Events,
  ActivityType
} = require('discord.js');

const fs   = require('fs');
const http = require('http');

// ✅ Keep-alive server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.end('Market bot alive!'); }).listen(PORT);

// ✅ Error handling
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const GUILD_ID        = process.env.GUILD_ID;
const BUY_LOG_CHANNEL = process.env.BUY_LOG_CHANNEL;
const REVIEW_CHANNEL  = process.env.REVIEW_CHANNEL; // channel where reviews get posted publicly
const COLOR           = 0x6cc5ff;

// ─── JSON DATABASE ────────────────────────────────────────────────────────────
const DB         = './data';
const PRODUCTS_F = `${DB}/products.json`;
const USERS_F    = `${DB}/users.json`;
const LOGS_F     = `${DB}/logs.json`;
const REVIEWS_F  = `${DB}/reviews.json`;

for (const dir of [DB]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
for (const [file, def] of [
  [PRODUCTS_F, '{}'],
  [USERS_F, '{}'],
  [LOGS_F, '[]'],
  [REVIEWS_F, '{}']
]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, def);
}

const readJSON  = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

// ─── ROBLOX HELPERS ───────────────────────────────────────────────────────────
async function getRobloxUser(username) {
  try {
    const res  = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
    });
    const data = await res.json();
    return data.data?.[0] || null;
  } catch { return null; }
}

async function getRobloxBio(userId) {
  try {
    const res  = await fetch(`https://users.roblox.com/v1/users/${userId}`);
    const data = await res.json();
    return data.description || '';
  } catch { return ''; }
}

async function ownsGamepass(robloxUserId, gamepassId) {
  try {
    const res  = await fetch(
      `https://inventory.roblox.com/v1/users/${robloxUserId}/items/GamePass/${gamepassId}`
    );
    const data = await res.json();
    return (data.data?.length ?? 0) > 0;
  } catch { return false; }
}

async function getRobloxAvatar(userId) {
  try {
    const res  = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`
    );
    const data = await res.json();
    return data.data?.[0]?.imageUrl || null;
  } catch { return null; }
}

function generateCode() {
  return 'VERIFY-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function starDisplay(stars) {
  return '⭐'.repeat(stars) + '✩'.repeat(5 - stars);
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('linkroblox')
    .setDescription('Start linking your Roblox account')
    .addStringOption(o =>
      o.setName('username').setDescription('Your Roblox username').setRequired(true)),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verify your Roblox account after placing the code in your bio'),

  new SlashCommandBuilder()
    .setName('addproduct')
    .setDescription('Add a product to the market (admin only)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o => o.setName('name').setDescription('Product name').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Product description').setRequired(true))
    .addStringOption(o => o.setName('price').setDescription('Price e.g. 500 Robux').setRequired(true))
    .addStringOption(o => o.setName('gamepass_id').setDescription('Roblox gamepass ID').setRequired(true))
    .addAttachmentOption(o => o.setName('file').setDescription('Product file to deliver').setRequired(true))
    .addAttachmentOption(o => o.setName('thumbnail').setDescription('Product thumbnail image').setRequired(false)),

  new SlashCommandBuilder()
    .setName('removeproduct')
    .setDescription('Remove a product from the market (admin only)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o => o.setName('name').setDescription('Product name to remove').setRequired(true)),

  new SlashCommandBuilder()
    .setName('listproducts')
    .setDescription('Browse all available products'),

  new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy a product')
    .addStringOption(o =>
      o.setName('productname').setDescription('Specify the product name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('retrieve')
    .setDescription('Re-send a product you already purchased')
    .addStringOption(o => o.setName('productname').setDescription('Product name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('review')
    .setDescription('Leave a review on a product')
    .addStringOption(o => o.setName('productname').setDescription('Product name').setRequired(true))
    .addIntegerOption(o =>
      o.setName('stars').setDescription('Rating from 1 to 5').setRequired(true).setMinValue(1).setMaxValue(5))
    .addStringOption(o => o.setName('feedback').setDescription('Your feedback').setRequired(true)),

  new SlashCommandBuilder()
    .setName('buylogs')
    .setDescription('View purchase logs (admin only)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o => o.setName('product').setDescription('Filter by product name (optional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your linked Roblox profile and purchases'),

].map(c => c.toJSON());

// ─── BOT READY ────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('the market', { type: ActivityType.Watching });

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

// ─── INTERACTIONS ─────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /linkroblox ──────────────────────────────────────────────────────────────
  if (commandName === 'linkroblox') {
    await interaction.deferReply({ ephemeral: true });

    const username   = interaction.options.getString('username');
    const robloxUser = await getRobloxUser(username);

    if (!robloxUser) {
      return interaction.editReply({ content: '❌ Roblox username not found. Please check and try again.' });
    }

    const code  = generateCode();
    const users = readJSON(USERS_F);

    users[interaction.user.id] = {
      ...users[interaction.user.id],
      pendingRoblox: { id: robloxUser.id, username: robloxUser.name, code }
    };
    writeJSON(USERS_F, users);

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('🔗 Link Your Roblox Account')
      .setDescription(
        `**Step 1:** Copy the code below\n` +
        `**Step 2:** Go to your [Roblox profile](https://www.roblox.com/users/${robloxUser.id}/profile) and paste it in your **bio/description**\n` +
        `**Step 3:** Run \`/verify\` to confirm\n\n` +
        `> You can remove the code from your bio after verifying.`
      )
      .addFields(
        { name: 'Your Verification Code', value: `\`\`\`${code}\`\`\`` },
        { name: 'Roblox Account', value: `[${robloxUser.name}](https://www.roblox.com/users/${robloxUser.id}/profile)` }
      )
      .setFooter({ text: 'Code expires if you run /linkroblox again' });

    await interaction.editReply({ embeds: [embed] });
  }

  // ── /verify ──────────────────────────────────────────────────────────────────
  if (commandName === 'verify') {
    await interaction.deferReply({ ephemeral: true });

    const users = readJSON(USERS_F);
    const user  = users[interaction.user.id];

    if (!user?.pendingRoblox) {
      return interaction.editReply({ content: '❌ No pending verification. Run `/linkroblox` first.' });
    }

    const { id, username, code } = user.pendingRoblox;
    const bio = await getRobloxBio(id);

    if (!bio.includes(code)) {
      return interaction.editReply({
        content: `❌ Code \`${code}\` not found in your Roblox bio. Make sure you saved it, then try again.`
      });
    }

    users[interaction.user.id] = {
      ...user,
      roblox: { id, username },
      pendingRoblox: null,
      purchases: user.purchases || []
    };
    writeJSON(USERS_F, users);

    const avatar = await getRobloxAvatar(id);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Roblox Account Linked!')
      .setDescription(`Your Discord is now linked to **${username}**.\nYou can remove the code from your bio now.`);

    if (avatar) embed.setThumbnail(avatar);

    await interaction.editReply({ embeds: [embed] });
  }

  // ── /addproduct ───────────────────────────────────────────────────────────────
  if (commandName === 'addproduct') {
    await interaction.deferReply({ ephemeral: true });

    const name        = interaction.options.getString('name').toLowerCase().trim();
    const description = interaction.options.getString('description');
    const price       = interaction.options.getString('price');
    const gamepassId  = interaction.options.getString('gamepass_id');
    const file        = interaction.options.getAttachment('file');
    const thumbnail   = interaction.options.getAttachment('thumbnail');
    const products    = readJSON(PRODUCTS_F);

    if (products[name]) {
      return interaction.editReply({ content: `❌ A product named **${name}** already exists.` });
    }

    products[name] = {
      name,
      description,
      price,
      gamepassId,
      fileUrl: file.url,
      fileName: file.name,
      thumbnailUrl: thumbnail?.url || null,
      addedBy: interaction.user.id,
      addedAt: new Date().toISOString()
    };
    writeJSON(PRODUCTS_F, products);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Product Added')
      .addFields(
        { name: 'Name', value: name, inline: true },
        { name: 'Price', value: price, inline: true },
        { name: 'Gamepass ID', value: gamepassId, inline: true },
        { name: 'Description', value: description }
      );

    if (thumbnail) embed.setThumbnail(thumbnail.url);

    await interaction.editReply({ embeds: [embed] });
  }

  // ── /removeproduct ────────────────────────────────────────────────────────────
  if (commandName === 'removeproduct') {
    await interaction.deferReply({ ephemeral: true });

    const name     = interaction.options.getString('name').toLowerCase().trim();
    const products = readJSON(PRODUCTS_F);

    if (!products[name]) {
      return interaction.editReply({ content: `❌ No product named **${name}** found.` });
    }

    delete products[name];
    writeJSON(PRODUCTS_F, products);

    await interaction.editReply({ content: `✅ Product **${name}** removed.` });
  }

  // ── /listproducts ─────────────────────────────────────────────────────────────
  if (commandName === 'listproducts') {
    await interaction.deferReply();

    const products = readJSON(PRODUCTS_F);
    const reviews  = readJSON(REVIEWS_F);
    const list     = Object.values(products);

    if (list.length === 0) {
      return interaction.editReply({ content: '📦 No products available yet.' });
    }

    const embeds = list.map(p => {
      const productReviews = reviews[p.name] || [];
      const avgRating      = productReviews.length
        ? (productReviews.reduce((a, r) => a + r.stars, 0) / productReviews.length).toFixed(1)
        : null;

      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`📦 ${p.name}`)
        .setDescription(p.description)
        .addFields(
          { name: 'Price', value: p.price, inline: true },
          {
            name: 'Rating',
            value: avgRating ? `${starDisplay(Math.round(Number(avgRating)))} (${avgRating}/5 — ${productReviews.length} reviews)` : 'No reviews yet',
            inline: true
          },
          { name: 'Gamepass ID', value: p.gamepassId, inline: true }
        )
        .setFooter({ text: `Use /buy ${p.name} to purchase` });

      if (p.thumbnailUrl) embed.setThumbnail(p.thumbnailUrl);
      return embed;
    });

    await interaction.editReply({ embeds: embeds.slice(0, 10) });
  }

  // ── /buy ──────────────────────────────────────────────────────────────────────
  if (commandName === 'buy') {
    await interaction.deferReply({ ephemeral: true });

    const name     = interaction.options.getString('productname').toLowerCase().trim();
    const products = readJSON(PRODUCTS_F);
    const users    = readJSON(USERS_F);
    const logs     = readJSON(LOGS_F);
    const product  = products[name];

    if (!product) {
      return interaction.editReply({
        content: `❌ No product named **${name}** found. Use \`/listproducts\` to see available products.`
      });
    }

    const userData = users[interaction.user.id];
    if (!userData?.roblox) {
      return interaction.editReply({
        content: '❌ You need to link your Roblox account first.\nUse `/linkroblox` to get started.'
      });
    }

    // Check if already purchased
    const alreadyBought = logs.find(l => l.userId === interaction.user.id && l.product === name);
    if (alreadyBought) {
      return interaction.editReply({
        content: `✅ You already purchased **${name}**! Use \`/retrieve ${name}\` to get the file again.`
      });
    }

    // Check gamepass ownership
    const owns = await ownsGamepass(userData.roblox.id, product.gamepassId);
    if (!owns) {
      return interaction.editReply({
        content:
          `❌ You don't own the required gamepass for **${name}**.\n` +
          `Purchase it on Roblox first, then try again.\n\n` +
          `🔗 [Buy Gamepass](https://www.roblox.com/game-pass/${product.gamepassId})`
      });
    }

    // DM the file
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🎉 Thank you for your purchase!')
        .setDescription(
          `Thank you for purchasing **${name}**. You can download it below.\n\n` +
          `If you have any issues, use \`/retrieve ${name}\` or contact support.`
        )
        .addFields(
          { name: 'Product', value: name, inline: true },
          { name: 'Price', value: product.price, inline: true }
        );

      await interaction.user.send({
        embeds: [dmEmbed],
        files: [{ attachment: product.fileUrl, name: product.fileName }]
      });
    } catch {
      return interaction.editReply({
        content: `❌ Couldn't DM you the file. Please open your DMs and use \`/retrieve ${name}\` to try again.`
      });
    }

    // Log the purchase
    const log = {
      userId: interaction.user.id,
      userTag: interaction.user.username,
      robloxUsername: userData.roblox.username,
      robloxId: userData.roblox.id,
      product: name,
      price: product.price,
      purchasedAt: new Date().toISOString()
    };
    logs.push(log);
    writeJSON(LOGS_F, logs);

    if (!userData.purchases) userData.purchases = [];
    userData.purchases.push(name);
    users[interaction.user.id] = userData;
    writeJSON(USERS_F, users);

    // Send to buy log channel
    const logChannel = interaction.guild.channels.cache.get(BUY_LOG_CHANNEL);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('💸 New Purchase')
        .addFields(
          { name: 'Discord', value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: true },
          { name: 'Roblox', value: `${userData.roblox.username} (${userData.roblox.id})`, inline: true },
          { name: 'Product', value: name, inline: true },
          { name: 'Price', value: product.price, inline: true },
          { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        );
      await logChannel.send({ embeds: [logEmbed] });
    }

    await interaction.editReply({
      content: `✅ Purchase successful! Check your DMs for **${name}**. Leave a review with \`/review\`!`
    });
  }

  // ── /retrieve ─────────────────────────────────────────────────────────────────
  if (commandName === 'retrieve') {
    await interaction.deferReply({ ephemeral: true });

    const name     = interaction.options.getString('productname').toLowerCase().trim();
    const products = readJSON(PRODUCTS_F);
    const logs     = readJSON(LOGS_F);
    const product  = products[name];

    if (!product) {
      return interaction.editReply({ content: `❌ No product named **${name}** found.` });
    }

    const purchased = logs.find(l => l.userId === interaction.user.id && l.product === name);
    if (!purchased) {
      return interaction.editReply({
        content: `❌ You haven't purchased **${name}** yet. Use \`/buy ${name}\` to buy it.`
      });
    }

    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('📦 Here is your product!')
        .setDescription(`Here's your copy of **${name}**. Enjoy!`);

      await interaction.user.send({
        embeds: [dmEmbed],
        files: [{ attachment: product.fileUrl, name: product.fileName }]
      });

      await interaction.editReply({ content: '✅ File sent to your DMs!' });
    } catch {
      await interaction.editReply({ content: '❌ Couldn\'t DM you. Please open your DMs and try again.' });
    }
  }

  // ── /review ───────────────────────────────────────────────────────────────────
  if (commandName === 'review') {
    await interaction.deferReply({ ephemeral: true });

    const name     = interaction.options.getString('productname').toLowerCase().trim();
    const stars    = interaction.options.getInteger('stars');
    const feedback = interaction.options.getString('feedback');
    const logs     = readJSON(LOGS_F);
    const reviews  = readJSON(REVIEWS_F);
    const users    = readJSON(USERS_F);

    const purchased = logs.find(l => l.userId === interaction.user.id && l.product === name);
    if (!purchased) {
      return interaction.editReply({ content: '❌ You can only review products you\'ve purchased.' });
    }

    if (!reviews[name]) reviews[name] = [];
    const alreadyReviewed = reviews[name].find(r => r.userId === interaction.user.id);
    if (alreadyReviewed) {
      return interaction.editReply({ content: '❌ You already reviewed this product.' });
    }

    const userData = users[interaction.user.id];
    const avatar   = userData?.roblox?.id ? await getRobloxAvatar(userData.roblox.id) : null;

    reviews[name].push({
      userId: interaction.user.id,
      userTag: interaction.user.username,
      robloxUsername: userData?.roblox?.username || 'Unknown',
      robloxId: userData?.roblox?.id || 'Unknown',
      stars,
      feedback,
      reviewedAt: new Date().toISOString()
    });
    writeJSON(REVIEWS_F, reviews);

    // Post review publicly in review channel
    const reviewChannel = interaction.guild.channels.cache.get(REVIEW_CHANNEL);
    if (reviewChannel) {
      const reviewEmbed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('New Product Review')
        .addFields(
          { name: 'Product Name', value: name },
          { name: 'Roblox', value: `${userData?.roblox?.username || 'Unknown'}\n${userData?.roblox?.id || 'Unknown'}` },
          { name: 'Discord', value: `${interaction.user.username}\n${interaction.user.id}` },
          { name: 'Star Rating', value: starDisplay(stars) },
          { name: 'Additional Feedback', value: `\`\`\`${feedback}\`\`\`` }
        )
        .setTimestamp();

      if (avatar) reviewEmbed.setThumbnail(avatar);

      await reviewChannel.send({ embeds: [reviewEmbed] });
    }

    await interaction.editReply({ content: `✅ Review submitted for **${name}**! Thank you.` });
  }

  // ── /buylogs ──────────────────────────────────────────────────────────────────
  if (commandName === 'buylogs') {
    await interaction.deferReply({ ephemeral: true });

    const filter = interaction.options.getString('product')?.toLowerCase().trim();
    let logs     = readJSON(LOGS_F);

    if (filter) logs = logs.filter(l => l.product === filter);

    if (logs.length === 0) {
      return interaction.editReply({ content: '📋 No purchase logs found.' });
    }

    const recent = logs.slice(-20).reverse();
    const lines  = recent.map((l, i) =>
      `**${i + 1}.** <@${l.userId}> (${l.robloxUsername}) — **${l.product}** — ${l.price} — <t:${Math.floor(new Date(l.purchasedAt).getTime() / 1000)}:R>`
    ).join('\n');

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`📋 Purchase Logs${filter ? ` — ${filter}` : ''}`)
      .setDescription(lines)
      .setFooter({ text: `Showing last ${recent.length} of ${logs.length} total purchases` });

    await interaction.editReply({ embeds: [embed] });
  }

  // ── /profile ──────────────────────────────────────────────────────────────────
  if (commandName === 'profile') {
    await interaction.deferReply({ ephemeral: true });

    const users    = readJSON(USERS_F);
    const logs     = readJSON(LOGS_F);
    const userData = users[interaction.user.id];

    if (!userData?.roblox) {
      return interaction.editReply({
        content: '❌ You haven\'t linked your Roblox account yet. Use `/linkroblox` to get started.'
      });
    }

    const purchases = logs.filter(l => l.userId === interaction.user.id);
    const avatar    = await getRobloxAvatar(userData.roblox.id);

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`${interaction.user.username}'s Profile`)
      .addFields(
        { name: 'Discord', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Roblox', value: `[${userData.roblox.username}](https://www.roblox.com/users/${userData.roblox.id}/profile)`, inline: true },
        { name: 'Total Purchases', value: `${purchases.length}`, inline: true },
        {
          name: 'Purchased Products',
          value: purchases.length ? purchases.map(p => `• ${p.product}`).join('\n') : 'None yet'
        }
      );

    if (avatar) embed.setThumbnail(avatar);

    await interaction.editReply({ embeds: [embed] });
  }

});

// ✅ Login
client.login(process.env.TOKEN);
