require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionsBitField,
  REST,
  Routes,
  Events,
  ActivityType
} = require('discord.js');

const { createClient } = require('@supabase/supabase-js');
const http = require('http');

// Keep-alive server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.end('Market bot alive!'); }).listen(PORT);

// Error handling
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const GUILD_ID        = process.env.GUILD_ID;
const BUY_LOG_CHANNEL = process.env.BUY_LOG_CHANNEL;
const REVIEW_CHANNEL  = process.env.REVIEW_CHANNEL;
const COLOR           = 0x6cc5ff;

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

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
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity('the market', { type: ActivityType.Watching });

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Slash commands registered.');
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
      return interaction.editReply({ content: 'Roblox username not found. Please check and try again.' });
    }

    const code = generateCode();

    const { error } = await supabase
      .from('users')
      .upsert({
        id: interaction.user.id,
        pending_roblox_id: String(robloxUser.id),
        pending_roblox_username: robloxUser.name,
        pending_code: code,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) {
      console.error('Supabase error (linkroblox):', error);
      return interaction.editReply({ content: 'An error occurred. Please try again.' });
    }

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle('Link Your Roblox Account')
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

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', interaction.user.id)
      .maybeSingle();

    if (!user?.pending_roblox_id) {
      return interaction.editReply({ content: 'No pending verification. Run `/linkroblox` first.' });
    }

    const { pending_roblox_id: id, pending_roblox_username: username, pending_code: code } = user;
    const bio = await getRobloxBio(id);

    if (!bio.includes(code)) {
      return interaction.editReply({
        content: `Code \`${code}\` not found in your Roblox bio. Make sure you saved it, then try again.`
      });
    }

    const { error } = await supabase
      .from('users')
      .update({
        roblox_id: id,
        roblox_username: username,
        pending_roblox_id: null,
        pending_roblox_username: null,
        pending_code: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', interaction.user.id);

    if (error) {
      console.error('Supabase error (verify):', error);
      return interaction.editReply({ content: 'An error occurred. Please try again.' });
    }

    const avatar = await getRobloxAvatar(id);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Roblox Account Linked!')
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

    const { data: existing } = await supabase
      .from('products')
      .select('name')
      .eq('name', name)
      .maybeSingle();

    if (existing) {
      return interaction.editReply({ content: `A product named **${name}** already exists.` });
    }

    const { error } = await supabase
      .from('products')
      .insert({
        name,
        description,
        price,
        gamepass_id: gamepassId,
        file_url: file.url,
        file_name: file.name,
        thumbnail_url: thumbnail?.url || null,
        added_by: interaction.user.id
      });

    if (error) {
      console.error('Supabase error (addproduct):', error);
      return interaction.editReply({ content: 'An error occurred. Please try again.' });
    }

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Product Added')
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

    const name = interaction.options.getString('name').toLowerCase().trim();

    const { error, count } = await supabase
      .from('products')
      .delete({ count: 'exact' })
      .eq('name', name);

    if (error) {
      console.error('Supabase error (removeproduct):', error);
      return interaction.editReply({ content: 'An error occurred. Please try again.' });
    }

    if (count === 0) {
      return interaction.editReply({ content: `No product named **${name}** found.` });
    }

    await interaction.editReply({ content: `Product **${name}** removed.` });
  }

  // ── /listproducts ─────────────────────────────────────────────────────────────
  if (commandName === 'listproducts') {
    await interaction.deferReply();

    const { data: products } = await supabase
      .from('products')
      .select('*');

    if (!products || products.length === 0) {
      return interaction.editReply({ content: 'No products available yet.' });
    }

    const embeds = [];
    for (const p of products.slice(0, 10)) {
      const { data: productReviews } = await supabase
        .from('reviews')
        .select('stars')
        .eq('product_name', p.name);

      const reviews = productReviews || [];
      const avgRating = reviews.length
        ? (reviews.reduce((a, r) => a + r.stars, 0) / reviews.length).toFixed(1)
        : null;

      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`${p.name}`)
        .setDescription(p.description)
        .addFields(
          { name: 'Price', value: p.price, inline: true },
          {
            name: 'Rating',
            value: avgRating ? `${starDisplay(Math.round(Number(avgRating)))} (${avgRating}/5 — ${reviews.length} reviews)` : 'No reviews yet',
            inline: true
          },
          { name: 'Gamepass ID', value: p.gamepass_id, inline: true }
        )
        .setFooter({ text: `Use /buy ${p.name} to purchase` });

      if (p.thumbnail_url) embed.setThumbnail(p.thumbnail_url);
      embeds.push(embed);
    }

    await interaction.editReply({ embeds });
  }

  // ── /buy ──────────────────────────────────────────────────────────────────────
  if (commandName === 'buy') {
    await interaction.deferReply({ ephemeral: true });

    const name = interaction.options.getString('productname').toLowerCase().trim();

    const { data: product } = await supabase
      .from('products')
      .select('*')
      .eq('name', name)
      .maybeSingle();

    if (!product) {
      return interaction.editReply({
        content: `No product named **${name}** found. Use \`/listproducts\` to see available products.`
      });
    }

    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', interaction.user.id)
      .maybeSingle();

    if (!userData?.roblox_id) {
      return interaction.editReply({
        content: 'You need to link your Roblox account first.\nUse `/linkroblox` to get started.'
      });
    }

    // Check if already purchased
    const { data: existingPurchase } = await supabase
      .from('purchase_logs')
      .select('id')
      .eq('discord_user_id', interaction.user.id)
      .eq('product_name', name)
      .maybeSingle();

    if (existingPurchase) {
      return interaction.editReply({
        content: `You already purchased **${name}**! Use \`/retrieve ${name}\` to get the file again.`
      });
    }

    // Check gamepass ownership
    const owns = await ownsGamepass(userData.roblox_id, product.gamepass_id);
    if (!owns) {
      return interaction.editReply({
        content:
          `You don't own the required gamepass for **${name}**.\n` +
          `Purchase it on Roblox first, then try again.\n\n` +
          `[Buy Gamepass](https://www.roblox.com/game-pass/${product.gamepass_id})`
      });
    }

    // DM the file
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('Thank you for your purchase!')
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
        files: [{ attachment: product.file_url, name: product.file_name }]
      });
    } catch {
      return interaction.editReply({
        content: `Couldn't DM you the file. Please open your DMs and use \`/retrieve ${name}\` to try again.`
      });
    }

    // Log the purchase
    const { error: logError } = await supabase
      .from('purchase_logs')
      .insert({
        discord_user_id: interaction.user.id,
        discord_username: interaction.user.username,
        roblox_username: userData.roblox_username,
        roblox_id: userData.roblox_id,
        product_name: name,
        price: product.price
      });

    if (logError) {
      console.error('Supabase error (buy log):', logError);
    }

    // Send to buy log channel
    const logChannel = interaction.guild.channels.cache.get(BUY_LOG_CHANNEL);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('New Purchase')
        .addFields(
          { name: 'Discord', value: `<@${interaction.user.id}> (${interaction.user.username})`, inline: true },
          { name: 'Roblox', value: `${userData.roblox_username} (${userData.roblox_id})`, inline: true },
          { name: 'Product', value: name, inline: true },
          { name: 'Price', value: product.price, inline: true },
          { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        );
      await logChannel.send({ embeds: [logEmbed] });
    }

    await interaction.editReply({
      content: `Purchase successful! Check your DMs for **${name}**. Leave a review with \`/review\`!`
    });
  }

  // ── /retrieve ─────────────────────────────────────────────────────────────────
  if (commandName === 'retrieve') {
    await interaction.deferReply({ ephemeral: true });

    const name = interaction.options.getString('productname').toLowerCase().trim();

    const { data: product } = await supabase
      .from('products')
      .select('*')
      .eq('name', name)
      .maybeSingle();

    if (!product) {
      return interaction.editReply({ content: `No product named **${name}** found.` });
    }

    const { data: purchased } = await supabase
      .from('purchase_logs')
      .select('id')
      .eq('discord_user_id', interaction.user.id)
      .eq('product_name', name)
      .maybeSingle();

    if (!purchased) {
      return interaction.editReply({
        content: `You haven't purchased **${name}** yet. Use \`/buy ${name}\` to buy it.`
      });
    }

    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('Here is your product!')
        .setDescription(`Here's your copy of **${name}**. Enjoy!`);

      await interaction.user.send({
        embeds: [dmEmbed],
        files: [{ attachment: product.file_url, name: product.file_name }]
      });

      await interaction.editReply({ content: 'File sent to your DMs!' });
    } catch {
      await interaction.editReply({ content: 'Couldn\'t DM you. Please open your DMs and try again.' });
    }
  }

  // ── /review ───────────────────────────────────────────────────────────────────
  if (commandName === 'review') {
    await interaction.deferReply({ ephemeral: true });

    const name     = interaction.options.getString('productname').toLowerCase().trim();
    const stars    = interaction.options.getInteger('stars');
    const feedback = interaction.options.getString('feedback');

    const { data: purchased } = await supabase
      .from('purchase_logs')
      .select('id')
      .eq('discord_user_id', interaction.user.id)
      .eq('product_name', name)
      .maybeSingle();

    if (!purchased) {
      return interaction.editReply({ content: 'You can only review products you\'ve purchased.' });
    }

    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', interaction.user.id)
      .maybeSingle();

    const { error: reviewError } = await supabase
      .from('reviews')
      .insert({
        product_name: name,
        discord_user_id: interaction.user.id,
        discord_username: interaction.user.username,
        roblox_username: userData?.roblox_username || 'Unknown',
        roblox_id: userData?.roblox_id || 'Unknown',
        stars,
        feedback
      });

    if (reviewError) {
      if (reviewError.code === '23505') {
        return interaction.editReply({ content: 'You already reviewed this product.' });
      }
      console.error('Supabase error (review):', reviewError);
      return interaction.editReply({ content: 'An error occurred. Please try again.' });
    }

    const avatar = userData?.roblox_id ? await getRobloxAvatar(userData.roblox_id) : null;

    // Post review publicly in review channel
    const reviewChannel = interaction.guild.channels.cache.get(REVIEW_CHANNEL);
    if (reviewChannel) {
      const reviewEmbed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('New Product Review')
        .addFields(
          { name: 'Product Name', value: name },
          { name: 'Roblox', value: `${userData?.roblox_username || 'Unknown'}\n${userData?.roblox_id || 'Unknown'}` },
          { name: 'Discord', value: `${interaction.user.username}\n${interaction.user.id}` },
          { name: 'Star Rating', value: starDisplay(stars) },
          { name: 'Additional Feedback', value: `\`\`\`${feedback}\`\`\`` }
        )
        .setTimestamp();

      if (avatar) reviewEmbed.setThumbnail(avatar);

      await reviewChannel.send({ embeds: [reviewEmbed] });
    }

    await interaction.editReply({ content: `Review submitted for **${name}**! Thank you.` });
  }

  // ── /buylogs ──────────────────────────────────────────────────────────────────
  if (commandName === 'buylogs') {
    await interaction.deferReply({ ephemeral: true });

    const filter = interaction.options.getString('product')?.toLowerCase().trim();

    let query = supabase
      .from('purchase_logs')
      .select('*')
      .order('purchased_at', { ascending: false })
      .limit(20);

    if (filter) query = query.eq('product_name', filter);

    const { data: logs } = await query;

    if (!logs || logs.length === 0) {
      return interaction.editReply({ content: 'No purchase logs found.' });
    }

    const lines = logs.map((l, i) =>
      `**${i + 1}.** <@${l.discord_user_id}> (${l.roblox_username}) — **${l.product_name}** — ${l.price} — <t:${Math.floor(new Date(l.purchased_at).getTime() / 1000)}:R>`
    ).join('\n');

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`Purchase Logs${filter ? ` — ${filter}` : ''}`)
      .setDescription(lines)
      .setFooter({ text: `Showing last ${logs.length} purchases` });

    await interaction.editReply({ embeds: [embed] });
  }

  // ── /profile ──────────────────────────────────────────────────────────────────
  if (commandName === 'profile') {
    await interaction.deferReply({ ephemeral: true });

    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', interaction.user.id)
      .maybeSingle();

    if (!userData?.roblox_id) {
      return interaction.editReply({
        content: 'You haven\'t linked your Roblox account yet. Use `/linkroblox` to get started.'
      });
    }

    const { data: purchases } = await supabase
      .from('purchase_logs')
      .select('product_name, price')
      .eq('discord_user_id', interaction.user.id);

    const purchaseList = purchases || [];
    const avatar = await getRobloxAvatar(userData.roblox_id);

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`${interaction.user.username}'s Profile`)
      .addFields(
        { name: 'Discord', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Roblox', value: `[${userData.roblox_username}](https://www.roblox.com/users/${userData.roblox_id}/profile)`, inline: true },
        { name: 'Total Purchases', value: `${purchaseList.length}`, inline: true },
        {
          name: 'Purchased Products',
          value: purchaseList.length ? purchaseList.map(p => `• ${p.product_name}`).join('\n') : 'None yet'
        }
      );

    if (avatar) embed.setThumbnail(avatar);

    await interaction.editReply({ embeds: [embed] });
  }

});

// Login
client.login(process.env.TOKEN);
