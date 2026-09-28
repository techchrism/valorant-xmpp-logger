import * as tls from 'node:tls'
import { isIP } from 'node:net'
import { ConfigMITM } from './ConfigMITM'
import { Writable } from 'node:stream'

export class XmppMITM {
	private _socketID = 0
	private _server?: tls.Server
	private readonly sockets = new Set<tls.TLSSocket>()

	constructor(
		private readonly _port: number,
		private readonly _host: string,
		private readonly _configMitm: ConfigMITM,
		private readonly _logStream: Writable,
		private readonly _tlsOptions: tls.TlsOptions
	) {}

	private log(type: string, fields: Record<string, unknown> = {}) {
		this._logStream.write(
			JSON.stringify({ type, time: Date.now(), ...fields }) + '\n'
		)
	}

	async start() {
		this._server = tls.createServer(
			{ ...this._tlsOptions, requestCert: false },
			socket => {
				const target = this._configMitm.target

				if (!target) {
					console.error('TLS accepted, but no Riot chat route is available yet')
					socket.destroy()
					return
				}

				const socketID = ++this._socketID

				this.log('open-valorant', {
					host: target.riotHost,
					port: target.riotPort,
					socketID
				})

				console.log(
					'Client TLS accepted; connecting to ' +
						target.riotHost +
						':' +
						target.riotPort +
						'...'
				)

				socket.pause()

				const upstream = tls.connect({
					host: target.riotHost,
					port: target.riotPort,
					servername: isIP(target.riotHost) ? undefined : target.riotHost,
					rejectUnauthorized: true
				})

				this.sockets.add(upstream)

				const timer = setTimeout(
					() => upstream.destroy(new Error('Riot TLS handshake timed out')),
					15000
				)

				upstream.once('secureConnect', () => {
					clearTimeout(timer)
					this.log('open-riot', { socketID })
					console.log('Riot TLS connected; forwarding XMPP')

					socket.on('data', data =>
						this.log('outgoing', { data: data.toString(), socketID })
					)

					upstream.on('data', data =>
						this.log('incoming', { data: data.toString(), socketID })
					)

					socket.pipe(upstream)
					upstream.pipe(socket)
				})
				for (const [name, current, other] of [
					['valorant', socket, upstream],
					['riot', upstream, socket]
				] as const) {
					current.on('error', error =>
						console.error(name + ' TLS error: ' + error.message)
					)

					current.once('close', () => {
						clearTimeout(timer)
						this.sockets.delete(current)
						this.log('close-' + name, { socketID })
						other.destroy()
					})
				}
			}
		)
		this._server.on('connection', socket => {
			console.log(
				'TCP connection from ' + socket.remoteAddress + '; waiting for TLS'
			)
		})

		this._server.on('secureConnection', socket => {
			this.sockets.add(socket)
			socket.once('close', () => this.sockets.delete(socket))
		})

		this._server.on('tlsClientError', (error, socket) => {
			console.error(
				'Client TLS handshake failed: ' +
					error.message +
					'. Check certificate hostname, expiry and trust.'
			)

			this._logStream.write(
				'# Client TLS handshake failed: ' +
					error.message.replace(/[\r\n]/g, ' ') +
					'\n'
			)

			socket.destroy()
		})

		await new Promise<void>((resolve, reject) => {
			this._server!.once('error', reject)
			this._server!.listen(this._port, this._host, resolve)
		})
	}

	async stop() {
		for (const socket of this.sockets) socket.destroy()

		await new Promise<void>((resolve, reject) => {
			if (!this._server?.listening) return resolve()
			this._server.close(error => (error ? reject(error) : resolve()))
		})
	}
}
