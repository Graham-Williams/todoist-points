/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native better-sqlite3 out of the client/server bundle (loaded at runtime).
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
