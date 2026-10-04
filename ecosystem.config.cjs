module.exports = {
  apps: [
    {
      name: 'wingo-whatsapp-bot',
      script: 'dist/server.cjs',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
