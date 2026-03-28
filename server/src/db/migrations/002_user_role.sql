-- Add role column to users table for admin dashboard access control
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    ALTER TABLE users ADD COLUMN role VARCHAR(10) DEFAULT 'user' CHECK (role IN ('admin', 'user'));
  END IF;
END $$;
