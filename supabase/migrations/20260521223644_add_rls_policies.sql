/*
  # Add RLS Policies for Market Bot Tables

  1. Security
    - Add separate SELECT/INSERT/UPDATE/DELETE policies for service role on all 4 tables
    - Tables: products, users, purchase_logs, reviews
    - All access is server-side via service role key (Discord bot)
    - No public or authenticated user direct access

  2. Notes
    - Tables already exist with RLS enabled but no policies
    - Without policies, all access is blocked (restrictive by default)
    - Service role policies allow the bot to manage all data
*/

-- Products policies
CREATE POLICY "Service role can select products"
  ON products FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role can insert products"
  ON products FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update products"
  ON products FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can delete products"
  ON products FOR DELETE TO service_role USING (true);

-- Users policies
CREATE POLICY "Service role can select users"
  ON users FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role can insert users"
  ON users FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update users"
  ON users FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can delete users"
  ON users FOR DELETE TO service_role USING (true);

-- Purchase logs policies
CREATE POLICY "Service role can select purchase_logs"
  ON purchase_logs FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role can insert purchase_logs"
  ON purchase_logs FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update purchase_logs"
  ON purchase_logs FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can delete purchase_logs"
  ON purchase_logs FOR DELETE TO service_role USING (true);

-- Reviews policies
CREATE POLICY "Service role can select reviews"
  ON reviews FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role can insert reviews"
  ON reviews FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role can update reviews"
  ON reviews FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can delete reviews"
  ON reviews FOR DELETE TO service_role USING (true);

-- Add missing indexes
CREATE INDEX IF NOT EXISTS idx_purchase_logs_discord_user_id ON purchase_logs (discord_user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_logs_product_name ON purchase_logs (product_name);
CREATE INDEX IF NOT EXISTS idx_reviews_product_name ON reviews (product_name);
CREATE INDEX IF NOT EXISTS idx_reviews_discord_user_id ON reviews (discord_user_id);

-- Unique constraint: one review per user per product
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique_user_product ON reviews (product_name, discord_user_id);
