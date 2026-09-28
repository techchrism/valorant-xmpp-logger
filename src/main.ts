import * as fs from 'node:fs'
import { ConfigMITM } from './ConfigMITM'
import { XmppMITM } from './XmppMITM'
import { getRiotClientPath, isRiotClientRunning } from './riotClientUtils'
import { spawn } from 'node:child_process'
import { DEFAULT_CHAT_HOST, loadProxyCertificate } from './proxyCertificate'

;(async () => {
	const logDir = './logs'
	const httpPort = 35479
	const xmppPort = 35478
	const host = '127.0.0.1'

	if (await isRiotClientRunning()) {
		console.log(
			'Riot client is running, please close it before running this tool'
		)
		process.exit(1)
	}

	const riotClientPath = await getRiotClientPath()
	const chatHost = process.env.XMPP_HOST || DEFAULT_CHAT_HOST
	const certificate = await loadProxyCertificate(chatHost)
	await fs.promises.mkdir(logDir, { recursive: true })

	const logPath = `${logDir}/${new Date().getTime()}.txt`
	console.log(`Writing to ${logPath}`)

	const logStream = fs.createWriteStream(logPath)
	// Log header format
	logStream.write(
		JSON.stringify({
			type: 'valorant-xmpp-logger',
			version: '1.1.0'
		}) + '\n'
	)

	logStream.on('error', error => {
		console.error('Log file error:', error.message)
		process.exit(1)
	})
	const configMitm = new ConfigMITM(httpPort, host, xmppPort, chatHost)
	await configMitm.start()
	console.log(`Listening on ${host}:${httpPort}`)
	const xmppMitm = new XmppMITM(
		xmppPort,
		host,
		configMitm,
		logStream,
		certificate
	)
	await xmppMitm.start()
	console.log('XMPP listening...')

	console.log('Starting Riot Client...')
	const child = spawn(
		riotClientPath,
		[
			`--client-config-url=http://${host}:${httpPort}`,
			'--launch-product=valorant',
			'--launch-patchline=live',
			'--allow-direct-launch'
		],
		{ stdio: 'ignore' }
	)
	child.once('error', error => {
		console.error('Riot Client launch failed:', error.message)
		process.exit(1)
	})
})().catch(error => {
	console.error('Startup failed:', error.message)
	process.exit(1)
})
