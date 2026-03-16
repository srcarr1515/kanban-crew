#!/usr/bin/env node
// Kill dev server processes.
// Usage:
//   node dev-stop.js          -- kill backend + frontend
//   node dev-stop.js backend  -- kill only Rust backend
const { execSync } = require('child_process');

const mode = process.argv[2]; // "backend" or undefined (all)

// 1. Kill Rust processes by image name
const rustProcesses = ['server.exe', 'cargo-watch.exe', 'cargo.exe'];
for (const name of rustProcesses) {
  try {
    execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore' });
    console.log(`Killed ${name}`);
  } catch {
    // Process not running
  }
}

if (mode === 'backend') {
  console.log('Backend stopped.');
  process.exit(0);
}

// 2. Kill processes listening on common dev ports (Vite frontend)
const devPorts = ['3000', '3001', '3002', '3003', '5173', '5174'];
for (const port of devPorts) {
  try {
    const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const pids = new Set();
    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid);
      }
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log(`Killed PID ${pid} (port ${port})`);
      } catch {
        // Already dead
      }
    }
  } catch {
    // No process on this port
  }
}

console.log('Dev servers stopped.');
