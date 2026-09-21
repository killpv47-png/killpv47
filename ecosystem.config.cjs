module.exports = {
  apps: [{
    name: 'flytrader',
    script: 'server/index.mjs',
    interpreter: 'node',
    node_args: '--max-old-space-size=600',
    env: { NODE_ENV: 'production', PORT: 3000 },
    watch: false, instances: 1, exec_mode: 'fork', autorestart: true, max_memory_restart: '800M',
  }]
}
