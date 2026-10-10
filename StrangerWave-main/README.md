# StrangerWave — random worldwide text chat

A dark, responsive web app plus an Electron Windows desktop wrapper. Includes username/password accounts, bcrypt password hashing, JWT auth, live Socket.IO chat, random queue matching, next-person, typing indicator, report/block controls, and basic rate limiting.

## Important before you launch publicly

This is a starter implementation, not a fully audited production service. It uses a local JSON file for user/report/block data and an in-memory matching queue, so it is appropriate for local testing or a small single-server prototype. Do not use multiple server instances with this storage. Before opening it to the public, use HTTPS, persistent database storage, moderation and abuse review, email/account recovery, age/safety policy, data-retention rules, and stronger distributed rate limiting. Reports are stored but no moderation dashboard is included. Chat messages are relayed live and not stored as history.

## 1. Install Node.js

Install the current Node.js LTS release from https://nodejs.org/ . Open a NEW PowerShell window and check:

```powershell
node -v
npm -v
```

## 2. Set up the project

Extract the ZIP, open PowerShell in the `strangerwave` folder, then run:

```powershell
npm install
```

Set a strong JWT secret for this PowerShell session:

```powershell
$env:JWT_SECRET = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Keep this secret private and use the same secret each time you start the server if you want existing login tokens to remain valid. For repeat local use, create a private `.env` file and use a dotenv loader, or set the environment variable in your deployment host. Never commit your secret to a public repository.

## 3. Run the website locally

```powershell
npm start
```

Open http://localhost:3000 in your browser. Register two different accounts and open a second browser/incognito window to test matching. To stop the server, press Ctrl+C in the PowerShell window.

The app needs two signed-in accounts online at the same time to make a match. If no one else is online, it stays in the queue.

## 4. Run the desktop app locally

Leave the server running. Open a second PowerShell window in the same project folder, set the same `JWT_SECRET` (not technically required by the desktop wrapper, but useful for consistency), and run:

```powershell
npm run desktop
```

The desktop app opens `http://localhost:3000` by default. It is a desktop window for the same server-backed service, not a standalone offline chat server.

## 5. Make it available worldwide

To let people on different computers chat, deploy the Node server to a host that supports long-lived WebSocket connections, set `JWT_SECRET` to a long random value in the host's environment settings, and attach a domain with HTTPS. The server uses `PORT` from the host when provided. Ensure WebSocket/Socket.IO traffic is supported. Do not expose a local PC directly to the internet as a production host.

Once the website is deployed, configure the desktop wrapper's `APP_URL` to the public HTTPS URL before building it. In PowerShell:

```powershell
$env:APP_URL = 'https://your-real-domain.example'
npm run desktop
```

Replace the example with your actual deployed URL. To build a Windows installer:

```powershell
$env:APP_URL = 'https://your-real-domain.example'
npm run desktop:build
```

The installer will be created under `dist`. Build the installer on Windows for the most straightforward Windows result. You cannot build a working worldwide app just by sending the desktop installer: the backend must remain hosted and running.

## Project layout

- `server.js` — Express API, accounts, token checks, Socket.IO matching and chat
- `public/` — responsive web UI
- `electron/main.js` — desktop window wrapper
- `data.json` — automatically created user/block/report store; keep it private and back it up carefully

## Troubleshooting

- `Set JWT_SECRET...`: run the environment-variable command in the same PowerShell window before `npm start`.
- `EADDRINUSE`: port 3000 is already used. Stop the other server or set `$env:PORT = '3001'` and open that port instead.
- Can't find a chat: keep two distinct accounts online, each in a separate browser session or device.
- Desktop says it can't connect: start `npm start` first, or set `APP_URL` to your deployed HTTPS site.
