/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained production build for the Docker image (node server.js).
  output: "standalone",
  // Keep native better-sqlite3 out of the client/server bundle (loaded at runtime).
  serverExternalPackages: ["better-sqlite3"],
  // Next 16.3 `next dev` otherwise writes an agent-rules block into CLAUDE.md.
  agentRules: false,
};

export default nextConfig;
