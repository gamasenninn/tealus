-- Add is_bot column to users table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'is_bot'
  ) THEN
    ALTER TABLE users ADD COLUMN is_bot BOOLEAN DEFAULT false;
  END IF;
END $$;
