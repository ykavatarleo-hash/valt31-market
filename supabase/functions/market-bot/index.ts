import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── ROBLOX HELPERS ───────────────────────────────────────────────────────────
async function getRobloxUser(username: string) {
  try {
    const res = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });
    const data = await res.json();
    return data.data?.[0] || null;
  } catch {
    return null;
  }
}

async function getRobloxBio(userId: string) {
  try {
    const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
    const data = await res.json();
    return data.description || "";
  } catch {
    return "";
  }
}

async function ownsGamepass(robloxUserId: string, gamepassId: string) {
  try {
    const res = await fetch(
      `https://inventory.roblox.com/v1/users/${robloxUserId}/items/GamePass/${gamepassId}`
    );
    const data = await res.json();
    return (data.data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function getRobloxAvatar(userId: string) {
  try {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`
    );
    const data = await res.json();
    return data.data?.[0]?.imageUrl || null;
  } catch {
    return null;
  }
}

function generateCode() {
  return (
    "VERIFY-" +
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
}

function starDisplay(stars: number) {
  return "⭐".repeat(stars) + "✩".repeat(5 - stars);
}

// ─── ROUTE HANDLERS ──────────────────────────────────────────────────────────

async function handleLinkRoblox(req: Request) {
  const { discord_user_id, username } = await req.json();
  const robloxUser = await getRobloxUser(username);

  if (!robloxUser) {
    return { error: "Roblox username not found" };
  }

  const code = generateCode();

  const { error } = await supabase.from("users").upsert(
    {
      id: discord_user_id,
      pending_roblox_id: String(robloxUser.id),
      pending_roblox_username: robloxUser.name,
      pending_code: code,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("Supabase error (linkroblox):", error);
    return { error: "Database error" };
  }

  return {
    code,
    roblox_id: robloxUser.id,
    roblox_name: robloxUser.name,
    profile_url: `https://www.roblox.com/users/${robloxUser.id}/profile`,
  };
}

async function handleVerify(req: Request) {
  const { discord_user_id } = await req.json();

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("id", discord_user_id)
    .maybeSingle();

  if (!user?.pending_roblox_id) {
    return { error: "No pending verification" };
  }

  const { pending_roblox_id, pending_roblox_username, pending_code } = user;
  const bio = await getRobloxBio(pending_roblox_id);

  if (!bio.includes(pending_code)) {
    return { error: "Code not found in bio", code: pending_code };
  }

  const { error } = await supabase
    .from("users")
    .update({
      roblox_id: pending_roblox_id,
      roblox_username: pending_roblox_username,
      pending_roblox_id: null,
      pending_roblox_username: null,
      pending_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", discord_user_id);

  if (error) {
    console.error("Supabase error (verify):", error);
    return { error: "Database error" };
  }

  const avatar = await getRobloxAvatar(pending_roblox_id);

  return {
    verified: true,
    roblox_username: pending_roblox_username,
    roblox_id: pending_roblox_id,
    avatar,
  };
}

async function handleAddProduct(req: Request) {
  const { name, description, price, gamepass_id, file_url, file_name, thumbnail_url, added_by } =
    await req.json();

  const { data: existing } = await supabase
    .from("products")
    .select("name")
    .eq("name", name)
    .maybeSingle();

  if (existing) {
    return { error: "Product already exists" };
  }

  const { error } = await supabase.from("products").insert({
    name,
    description,
    price,
    gamepass_id,
    file_url,
    file_name,
    thumbnail_url: thumbnail_url || null,
    added_by,
  });

  if (error) {
    console.error("Supabase error (addproduct):", error);
    return { error: "Database error" };
  }

  return { success: true, name };
}

async function handleRemoveProduct(req: Request) {
  const { name } = await req.json();

  const { error, count } = await supabase
    .from("products")
    .delete({ count: "exact" })
    .eq("name", name);

  if (error) {
    console.error("Supabase error (removeproduct):", error);
    return { error: "Database error" };
  }

  if (count === 0) {
    return { error: "Product not found" };
  }

  return { success: true, name };
}

async function handleListProducts() {
  const { data: products } = await supabase.from("products").select("*");

  if (!products || products.length === 0) {
    return { products: [] };
  }

  const results = [];
  for (const p of products) {
    const { data: reviews } = await supabase
      .from("reviews")
      .select("stars")
      .eq("product_name", p.name);

    const reviewList = reviews || [];
    const avgRating = reviewList.length
      ? (reviewList.reduce((a: number, r: { stars: number }) => a + r.stars, 0) / reviewList.length).toFixed(1)
      : null;

    results.push({
      name: p.name,
      description: p.description,
      price: p.price,
      gamepass_id: p.gamepass_id,
      thumbnail_url: p.thumbnail_url,
      avg_rating: avgRating,
      review_count: reviewList.length,
    });
  }

  return { products: results };
}

async function handleBuy(req: Request) {
  const { discord_user_id, product_name } = await req.json();
  const name = product_name.toLowerCase().trim();

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("name", name)
    .maybeSingle();

  if (!product) {
    return { error: "Product not found" };
  }

  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", discord_user_id)
    .maybeSingle();

  if (!userData?.roblox_id) {
    return { error: "Roblox account not linked" };
  }

  const { data: existingPurchase } = await supabase
    .from("purchase_logs")
    .select("id")
    .eq("discord_user_id", discord_user_id)
    .eq("product_name", name)
    .maybeSingle();

  if (existingPurchase) {
    return { error: "Already purchased", product_name: name };
  }

  const owns = await ownsGamepass(userData.roblox_id, product.gamepass_id);
  if (!owns) {
    return {
      error: "Gamepass not owned",
      gamepass_url: `https://www.roblox.com/game-pass/${product.gamepass_id}`,
    };
  }

  const { error: logError } = await supabase.from("purchase_logs").insert({
    discord_user_id,
    discord_username: "",
    roblox_username: userData.roblox_username,
    roblox_id: userData.roblox_id,
    product_name: name,
    price: product.price,
  });

  if (logError) {
    console.error("Supabase error (buy log):", logError);
  }

  return {
    success: true,
    product_name: name,
    file_url: product.file_url,
    file_name: product.file_name,
    price: product.price,
    roblox_username: userData.roblox_username,
    roblox_id: userData.roblox_id,
  };
}

async function handleRetrieve(req: Request) {
  const { discord_user_id, product_name } = await req.json();
  const name = product_name.toLowerCase().trim();

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("name", name)
    .maybeSingle();

  if (!product) {
    return { error: "Product not found" };
  }

  const { data: purchased } = await supabase
    .from("purchase_logs")
    .select("id")
    .eq("discord_user_id", discord_user_id)
    .eq("product_name", name)
    .maybeSingle();

  if (!purchased) {
    return { error: "Not purchased" };
  }

  return {
    file_url: product.file_url,
    file_name: product.file_name,
  };
}

async function handleReview(req: Request) {
  const { discord_user_id, discord_username, product_name, stars, feedback } = await req.json();
  const name = product_name.toLowerCase().trim();

  const { data: purchased } = await supabase
    .from("purchase_logs")
    .select("id")
    .eq("discord_user_id", discord_user_id)
    .eq("product_name", name)
    .maybeSingle();

  if (!purchased) {
    return { error: "Can only review purchased products" };
  }

  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", discord_user_id)
    .maybeSingle();

  const { error: reviewError } = await supabase.from("reviews").insert({
    product_name: name,
    discord_user_id,
    discord_username: discord_username || "",
    roblox_username: userData?.roblox_username || "Unknown",
    roblox_id: userData?.roblox_id || "Unknown",
    stars,
    feedback,
  });

  if (reviewError) {
    if (reviewError.code === "23505") {
      return { error: "Already reviewed" };
    }
    console.error("Supabase error (review):", reviewError);
    return { error: "Database error" };
  }

  const avatar = userData?.roblox_id ? await getRobloxAvatar(userData.roblox_id) : null;

  return {
    success: true,
    roblox_username: userData?.roblox_username || "Unknown",
    roblox_id: userData?.roblox_id || "Unknown",
    avatar,
  };
}

async function handleBuyLogs(req: Request) {
  const url = new URL(req.url);
  const filter = url.searchParams.get("product")?.toLowerCase().trim();

  let query = supabase
    .from("purchase_logs")
    .select("*")
    .order("purchased_at", { ascending: false })
    .limit(20);

  if (filter) query = query.eq("product_name", filter);

  const { data: logs } = await query;

  if (!logs || logs.length === 0) {
    return { logs: [] };
  }

  return { logs };
}

async function handleProfile(req: Request) {
  const { discord_user_id } = await req.json();

  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", discord_user_id)
    .maybeSingle();

  if (!userData?.roblox_id) {
    return { error: "Roblox account not linked" };
  }

  const { data: purchases } = await supabase
    .from("purchase_logs")
    .select("product_name, price")
    .eq("discord_user_id", discord_user_id);

  const avatar = await getRobloxAvatar(userData.roblox_id);

  return {
    roblox_username: userData.roblox_username,
    roblox_id: userData.roblox_id,
    avatar,
    purchases: purchases || [],
  };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace("/market-bot", "").replace(/\/$/, "") || "/";

    let result: Record<string, unknown>;

    switch (path) {
      case "/linkroblox":
        result = await handleLinkRoblox(req);
        break;
      case "/verify":
        result = await handleVerify(req);
        break;
      case "/addproduct":
        result = await handleAddProduct(req);
        break;
      case "/removeproduct":
        result = await handleRemoveProduct(req);
        break;
      case "/listproducts":
        result = await handleListProducts();
        break;
      case "/buy":
        result = await handleBuy(req);
        break;
      case "/retrieve":
        result = await handleRetrieve(req);
        break;
      case "/review":
        result = await handleReview(req);
        break;
      case "/buylogs":
        result = await handleBuyLogs(req);
        break;
      case "/profile":
        result = await handleProfile(req);
        break;
      default:
        result = {
          status: "online",
          endpoints: [
            "/linkroblox",
            "/verify",
            "/addproduct",
            "/removeproduct",
            "/listproducts",
            "/buy",
            "/retrieve",
            "/review",
            "/buylogs",
            "/profile",
          ],
        };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
