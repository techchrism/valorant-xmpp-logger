# Valorant XMPP Logger

A simple tool to log XMPP traffic between the Riot client and the Riot XMPP server. Includes information such as presences and chat.

_Heavily_ based on [Burak](https://github.com/BurakDev)'s [riot-xmpp-mitm](https://github.com/ValorantDevelopers/riot-xmpp-mitm) project.

## Usage

Note: This project makes use of global fetch in Node 18+

- Clone the repo and run `npm install`
- Run `npm run build` to build the project
- Fully close Valorant and Riot Client (including the tray icon), then run `node .`. This starts Valorant automatically.

## TLS compatibility

The logger uses `deceive-localhost.molenzwiebel.xyz`, which must resolve to `127.0.0.1`, and downloads its current certificate from `https://mln.cx/deceive/localhost.pfx` on startup. This follows [Deceive's certificate approach](https://github.com/molenzwiebel/Deceive/blob/master/Deceive/Utils.cs). No certificate is installed in the Windows trust store. The service is a third-party startup dependency; certificate downloads must succeed before Riot Client is launched.

Recent Riot Client builds can reject the old self-signed certificate even with `chat.allow_bad_cert.enabled=true`. The old files in `certs/` are no longer used. The downloaded PFX is converted to PEM in memory, with hostname, validity and matching-key checks. Normal TLS verification remains enabled.

The config proxy resolves the authenticated player's chat affinity via Riot's geo service before routing to the regional XMPP server. Affinity lookup failures produce a visible error and HTTP 502 so the client can retry, rather than silently connecting to a different region. Run one Riot Client account per logger instance.

To use your own domain and trusted certificate instead of Deceive's service, set `XMPP_HOST`, `XMPP_CERT_PATH` (PEM leaf certificate followed by its chain), and `XMPP_KEY_PATH` (PEM private key). The domain must resolve only to `127.0.0.1`.

The console distinguishes TCP arrival, client TLS acceptance, and upstream TLS connection. A `Client TLS handshake failed` message is also written as a comment in the log. Run `npm test` for offline routing and TLS forwarding tests.

## Log Format

The first line of the file must contain a json-encoded object with required properties
`type` being set to `valorant-xmpp-logger` and `version` being a semver representing the format version.

Following lines are either comments (to be ignored by parsers) starting with `#` or log entries.
Log entries are json-encoded objects with the following properties:

- `type`:
  - `incoming` for incoming data
  - `outgoing` for outgoing data
  - `open-valorant` when Valorant initiates an XMPP socket connection to this application
  - `open-riot` when this application initiates an XMPP socket connection to the Riot XMPP server (in response to `open-valorant`)
  - `close-valorant` when Valorant closes the XMPP socket connection
  - `close-riot` when this the Riot XMPP server closes the XMPP socket connection
- `time`: timestamp of the log entry

If the type is `incoming` or `outgoing`, the following properties are also present:

- `data`: the data that was sent or received

If the type is `open-*` or `close-*`, the following properties are also present:

- `socketID`: A unique ID for the socket connection. Internally implemented as a counter.

If the type is `open-valorant`, the following properties are also present:

- `host`: the hostname of the Riot XMPP server that the connection is intended for
- `port`: the port of the Riot XMPP server that the connection is intended for

## Motivation

While [an excellent xmpp mitm project](https://github.com/ValorantDevelopers/riot-xmpp-mitm) had already been created,
I wanted to try my hand at creating a similar project to better understand MITM-ing the Riot client config.
This project also writes logs to disk in an easily parsable format, which is useful for creating tools to analyze the logs.
Finally, this project automatically finds and starts the Riot client which is convenient.
