# etchwp-ai relay

Stateless WebSocket broker for the **relay** transport mode. Pairs one MCP controller with
one in-page agent per `room`, matched by a shared `token`, and forwards frames between them.
It understands nothing about Etch — pure routing.

## Run

```sh
RELAY_PORT=8787 bun relay/server.ts
```

Put it behind a TLS-terminating reverse proxy so clients connect over `wss://`:

```
# Caddy example
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

## Wire it up

Both peers must agree on relay URL + room + token.

**MCP server** (`claude_desktop_config.json` env):

```
ETCH_TRANSPORT=ws
ETCH_WS_MODE=relay
ETCH_WS_RELAY_URL=wss://relay.example.com
ETCH_WS_ROOM=my-site
ETCH_WS_TOKEN=<long-random-secret>
```

**WordPress plugin** (Settings → etchwp-ai Bridge): Mode = Relay, same Relay URL / Room /
Token.

## Notes

- One controller + one agent per room. A second peer of the same role in a room is rejected
  (`4002`); a wrong token is rejected (`4001`).
- The relay holds no message state and never persists frames.
- Run one relay for many sites — give each site its own `room` + `token`.
