import * as http from 'node:http'

export interface ChatTarget {
	riotHost: string
	riotPort: number
}

export class ConfigMITM {
	private _server: http.Server | null = null
	public target: ChatTarget | undefined

	constructor(
		private readonly _port: number,
		private readonly _host: string,
		private readonly _xmppPort: number,
		private readonly _chatHost: string
	) {}

	async rewriteConfig(data: Record<string, unknown>, authorization?: string) {
		const affinities = data['chat.affinities'] as
			Record<string, string> | undefined
		const port = data['chat.port']
		let host = data['chat.host']
		if (typeof port !== 'number' || port < 1 || port > 65535) return data
		if (affinities && data['chat.affinity.enabled'] === true && authorization) {
			const response = await fetch(
				'https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat',
				{
					headers: { authorization },
					signal: AbortSignal.timeout(15000)
				}
			)
			if (!response.ok)
				throw new Error('Chat affinity lookup returned HTTP ' + response.status)
			const token = await response.text()
			const payload = JSON.parse(
				Buffer.from(token.split('.')[1], 'base64url').toString()
			)
			const selected = affinities[payload.affinity]
			if (typeof selected !== 'string' || !selected)
				throw new Error('No chat server for player affinity')
			host = selected
		}
		if (typeof host !== 'string' || !host) return data
		this.target = { riotHost: host, riotPort: port }
		data['chat.host'] = this._chatHost
		data['chat.port'] = this._xmppPort
		data['chat.allow_bad_cert.enabled'] = false
		if (affinities) {
			data['chat.affinities'] = Object.fromEntries(
				Object.keys(affinities).map(region => [region, this._chatHost])
			)
		}
		console.log(
			'Chat route: ' +
				this._chatHost +
				':' +
				this._xmppPort +
				' -> ' +
				host +
				':' +
				port
		)
		return data
	}

	async start() {
		this._server = http.createServer(async (req, res) => {
			try {
				if (req.method !== 'GET' && req.method !== 'HEAD') {
					res.writeHead(405).end()
					return
				}
				const headers = new Headers()
				for (const name of [
					'user-agent',
					'authorization',
					'x-riot-entitlements-jwt',
					'accept'
				]) {
					const value = req.headers[name]
					if (typeof value === 'string') headers.set(name, value)
				}
				// Never forward conditional-cache headers: a 304 would bypass rewriting.
				const response = await fetch(
					'https://clientconfig.rpg.riotgames.com' + req.url,
					{
						method: req.method,
						headers,
						signal: AbortSignal.timeout(15000)
					}
				)
				let body = await response.text()
				if (response.ok && req.method === 'GET') {
					let data: unknown
					try {
						data = JSON.parse(body)
					} catch {
						/* Forward non-JSON unchanged. */
					}
					if (data && typeof data === 'object' && !Array.isArray(data)) {
						body = JSON.stringify(
							await this.rewriteConfig(
								data as Record<string, unknown>,
								req.headers.authorization
							)
						)
					}
				}
				console.log(
					'Config: ' +
						req.method +
						' ' +
						req.url?.split('?')[0] +
						' -> ' +
						response.status
				)
				res.writeHead(response.status, {
					'content-type':
						response.headers.get('content-type') || 'application/json',
					'cache-control': 'no-store'
				})
				res.end(body)
			} catch (error) {
				console.error(
					'Config proxy failed:',
					error instanceof Error ? error.message : 'Unknown error'
				)
				res.writeHead(502).end('Configuration proxy failed; see logger console')
			}
		})
		await new Promise<void>((resolve, reject) => {
			this._server!.once('error', reject)
			this._server!.listen(this._port, this._host, resolve)
		})
	}

	async stop() {
		await new Promise<void>((resolve, reject) => {
			if (!this._server?.listening) return resolve()
			this._server.close(error => (error ? reject(error) : resolve()))
		})
	}
}
