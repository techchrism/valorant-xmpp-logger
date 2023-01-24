# Valorant XMPP Logger

## Log Format
The first line of the file must contain a json-encoded object with required properties
`type` being set to `valorant-xmpp-logger` and `version` being a semver representing the format version.

Following lines are either comments (to be ignored by parsers) starting with `#` or log entries.
Log entries are json-encoded objects with the following properties:
 - TODO