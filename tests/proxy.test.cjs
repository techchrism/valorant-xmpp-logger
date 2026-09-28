const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const tls = require('node:tls')
const http = require('node:http')
const { once } = require('node:events')
const { Writable } = require('node:stream')
const forge = require('node-forge')
const { ConfigMITM } = require('../dist/ConfigMITM')
const { XmppMITM } = require('../dist/XmppMITM')
const { decodeProxyPfx } = require('../dist/proxyCertificate')
const cert = fs.readFileSync(path.join(process.env.XMPP_TEST_DIR, 'cert.pem'))
const key = fs.readFileSync(path.join(process.env.XMPP_TEST_DIR, 'key.pem'))

test('PFX conversion produces a matching certificate and key', () => {
	const pfx = forge.pkcs12.toPkcs12Asn1(
		forge.pki.privateKeyFromPem(key.toString()),
		[forge.pki.certificateFromPem(cert.toString())],
		'',
		{ algorithm: '3des' }
	)
	const options = decodeProxyPfx(
		Buffer.from(forge.asn1.toDer(pfx).getBytes(), 'binary')
	)
	assert.doesNotThrow(() => tls.createSecureContext(options))
	assert.throws(() => decodeProxyPfx(Buffer.from('invalid pfx')))
})

test('player affinity selects upstream before rewriting every host', async t => {
	const originalFetch = global.fetch
	t.after(() => {
		global.fetch = originalFetch
	})
	global.fetch = async (url, options) => {
		assert.equal(
			url,
			'https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat'
		)
		assert.equal(options.headers.authorization, 'Bearer test')
		return new Response(
			'header.' +
				Buffer.from(JSON.stringify({ affinity: 'eu' })).toString('base64url') +
				'.signature'
		)
	}
	const proxy = new ConfigMITM(0, '127.0.0.1', 35478, 'localhost')
	const result = await proxy.rewriteConfig(
		{
			'chat.host': 'fallback.example',
			'chat.port': 5223,
			'chat.affinity.enabled': true,
			'chat.affinities': { eu: 'eu.example', na: 'na.example' },
			unrelated: true
		},
		'Bearer test'
	)
	assert.deepEqual(proxy.target, { riotHost: 'eu.example', riotPort: 5223 })
	assert.deepEqual(result['chat.affinities'], {
		eu: 'localhost',
		na: 'localhost'
	})
	assert.equal(result['chat.host'], 'localhost')
	assert.equal(result['chat.port'], 35478)
	assert.equal(result['chat.allow_bad_cert.enabled'], false)
	assert.equal(result.unrelated, true)
})

test('fallback host works without affinities; unrelated responses preserve route', async () => {
	const proxy = new ConfigMITM(0, '127.0.0.1', 35478, 'localhost')
	await proxy.rewriteConfig({
		'chat.host': 'fallback.example',
		'chat.port': 5223
	})
	const target = proxy.target
	assert.deepEqual(target, { riotHost: 'fallback.example', riotPort: 5223 })
	assert.deepEqual(await proxy.rewriteConfig({ other: 1 }), { other: 1 })
	assert.equal(proxy.target, target)
})

test('affinity errors do not silently route the player to a different region', async t => {
	const originalFetch = global.fetch
	t.after(() => {
		global.fetch = originalFetch
	})
	global.fetch = async () => new Response('unavailable', { status: 503 })
	const proxy = new ConfigMITM(0, '127.0.0.1', 35478, 'localhost')
	await assert.rejects(
		proxy.rewriteConfig(
			{
				'chat.host': 'fallback.example',
				'chat.port': 5223,
				'chat.affinity.enabled': true,
				'chat.affinities': { eu: 'eu.example' }
			},
			'Bearer test'
		),
		/HTTP 503/
	)
	assert.equal(proxy.target, undefined)
})

function request(port) {
	return new Promise((resolve, reject) => {
		http
			.get(
				{
					host: '127.0.0.1',
					port,
					path: '/api/v2/config/public',
					headers: { 'if-none-match': 'stale' }
				},
				res => {
					let body = ''
					res.on('data', data => {
						body += data
					})
					res.on('end', () => resolve({ status: res.statusCode, body }))
				}
			)
			.on('error', reject)
	})
}

test('HTTP proxy rewrites other config paths and handles upstream failures', async t => {
	const originalFetch = global.fetch
	t.after(() => {
		global.fetch = originalFetch
	})
	const proxy = new ConfigMITM(0, '127.0.0.1', 35478, 'localhost')
	await proxy.start()
	t.after(() => proxy.stop())
	global.fetch = async (url, options) => {
		assert.equal(options.headers.has('if-none-match'), false)
		return new Response(
			JSON.stringify({ 'chat.host': 'eu.example', 'chat.port': 5223 })
		)
	}
	const port = proxy._server.address().port
	const result = await request(port)
	assert.equal(result.status, 200)
	assert.equal(JSON.parse(result.body)['chat.host'], 'localhost')
	global.fetch = async () => {
		throw new Error('test network failure')
	}
	assert.equal((await request(port)).status, 502)
	const occupied = new ConfigMITM(port, '127.0.0.1', 35478, 'localhost')
	await assert.rejects(occupied.start(), { code: 'EADDRINUSE' })
})

test(
	'trusted TLS proxy forwards early client bytes and upstream replies, then closes both sides',
	{ timeout: 10000 },
	async t => {
		const upstream = tls.createServer({ cert, key }, socket =>
			socket.on('data', data => socket.write(data))
		)
		upstream.listen(0, '127.0.0.1')
		await once(upstream, 'listening')
		t.after(() => new Promise(resolve => upstream.close(resolve)))
		const config = new ConfigMITM(0, '127.0.0.1', 0, 'localhost')
		config.target = {
			riotHost: '127.0.0.1',
			riotPort: upstream.address().port
		}
		let log = ''
		const output = new Writable({
			write(data, encoding, callback) {
				log += data.toString()
				callback()
			}
		})
		const proxy = new XmppMITM(0, '127.0.0.1', config, output, { cert, key })
		await proxy.start()
		t.after(() => proxy.stop())
		const client = tls.connect({
			host: '127.0.0.1',
			port: proxy._server.address().port,
			servername: 'localhost'
		})
		t.after(() => client.destroy())
		await once(client, 'secureConnect')
		const reply = once(client, 'data')
		client.write('<presence/>')
		assert.equal((await reply)[0].toString(), '<presence/>')
		const closed = once(client, 'close')
		client.end()
		await closed
		const entries = log
			.trim()
			.split('\n')
			.map(line => JSON.parse(line))
		for (const type of ['open-valorant', 'open-riot', 'outgoing', 'incoming']) {
			assert.ok(
				entries.some(entry => entry.type === type),
				type
			)
		}
		const occupied = new XmppMITM(
			proxy._server.address().port,
			'127.0.0.1',
			config,
			output,
			{ cert, key }
		)
		await assert.rejects(occupied.start(), { code: 'EADDRINUSE' })
	}
)
