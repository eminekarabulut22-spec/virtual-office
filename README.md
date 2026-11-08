# Virtual Office

3D agents' office UI + API (departments, Update → Qwen plan, Hermes BOTS metrics).

Extracted from the Kyaani AI Infra Doc monorepo — this repository contains **only** this package.

## Quick start

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:3001** (Vite + API on 3002 in dev).

Production-style:

```bash
npm start
```

Optional: `./scripts/run-office.sh` (build, bots proxy, Python server on :3001).

## Environment (Hermes / Qwen)

See `server/office_server.py` and env vars in `scripts/run-office.sh` — tunnels to lab Qwen (`KYAANI_CHAT_URL`) and Hermes profiles are optional for full KPI demo.

## License

Private / company origins — use according to your employment agreement.
