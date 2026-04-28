// MongoDB is not used — this app runs on Supabase (PostgreSQL).
// Calling mongoose.connect() was consuming connection slots and calling process.exit(1) on failure.

const connectDB = async () => {
  console.log('ℹ️  MongoDB disabled — using Supabase (PostgreSQL) only.');
  return null;
};

module.exports = connectDB;