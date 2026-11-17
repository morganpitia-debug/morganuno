# Tabletop Tumble

## Run locally

```sh
npm start
```

Open `http://localhost:3000`. For phone play, use the invite QR while the phone and host PC are on the same Wi-Fi.

## Deploy on Render

- Create a **Web Service** connected to this project.
- Use `npm install` as the build command (there are no package dependencies to install) and `npm start` as the start command.
- Render supplies the port automatically. The app reads the forwarded host and HTTPS protocol to build public invite links.
- If your service uses a custom domain or the proxy headers are unavailable, set `PUBLIC_URL` to the public origin, for example `https://your-game.onrender.com`.
- After a deploy, open the published site and create a **new room**. The QR is generated for that room’s public site address.

Rooms are held in server memory, so active games end when the service restarts or sleeps.
