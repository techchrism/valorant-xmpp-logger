import * as tls from 'node:tls'
import { promises as fs } from 'node:fs'
import { lookup } from 'node:dns/promises'
import { createPrivateKey, X509Certificate } from 'node:crypto'
import * as forge from 'node-forge'

export const DEFAULT_CHAT_HOST = 'deceive-localhost.molenzwiebel.xyz'

export function decodeProxyPfx(buffer: Buffer): tls.TlsOptions {
	const pfx = forge.pkcs12.pkcs12FromAsn1(
		forge.asn1.fromDer(buffer.toString('binary')),
		false,
		''
	)
	const certs =
		pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ||
		[]
	const keys = [
		...(pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
			forge.pki.oids.pkcs8ShroudedKeyBag
		] || []),
		...(pfx.getBags({ bagType: forge.pki.oids.keyBag })[
			forge.pki.oids.keyBag
		] || [])
	]
	// Forge decrypts PKCS#12; Node handles both RSA and EC key/certificate parsing.
	const keyBag = keys.find(bag => bag.key || bag.asn1)
	if (!keyBag) throw new Error('Proxy PFX contains no private key')
	const key = keyBag.key
		? forge.pki.privateKeyToPem(keyBag.key)
		: forge.pem.encode({
				type: 'PRIVATE KEY',
				body: forge.asn1.toDer(keyBag.asn1).getBytes()
			})
	const privateKey = createPrivateKey(key)
	const certificates = certs.map(bag =>
		bag.cert
			? forge.pki.certificateToPem(bag.cert)
			: forge.pem.encode({
					type: 'CERTIFICATE',
					body: forge.asn1.toDer(bag.asn1).getBytes()
				})
	)
	const leaf = certificates.find(cert =>
		new X509Certificate(cert).checkPrivateKey(privateKey)
	)
	if (!leaf)
		throw new Error('Proxy PFX contains no certificate matching its key')
	return {
		key,
		cert: [leaf, ...certificates.filter(cert => cert !== leaf)].join('\n')
	}
}

export async function loadProxyCertificate(
	chatHost: string
): Promise<tls.TlsOptions> {
	const addresses = await lookup(chatHost, { all: true })
	if (
		!addresses.length ||
		addresses.some(address => address.address !== '127.0.0.1')
	) {
		throw new Error(
			chatHost +
				' must resolve only to 127.0.0.1; check DNS before starting Riot Client'
		)
	}
	let options: tls.TlsOptions
	if (process.env.XMPP_CERT_PATH && process.env.XMPP_KEY_PATH) {
		options = {
			cert: await fs.readFile(process.env.XMPP_CERT_PATH),
			key: await fs.readFile(process.env.XMPP_KEY_PATH)
		}
	} else if (process.env.XMPP_CERT_PATH || process.env.XMPP_KEY_PATH) {
		throw new Error('Set both XMPP_CERT_PATH and XMPP_KEY_PATH')
	} else {
		if (chatHost !== DEFAULT_CHAT_HOST)
			throw new Error(
				'A custom XMPP_HOST requires XMPP_CERT_PATH and XMPP_KEY_PATH'
			)
		console.log('Downloading the current Deceive localhost certificate...')
		const response = await fetch('https://mln.cx/deceive/localhost.pfx', {
			signal: AbortSignal.timeout(15000)
		})
		if (!response.ok)
			throw new Error('Certificate download returned HTTP ' + response.status)
		options = decodeProxyPfx(Buffer.from(await response.arrayBuffer()))
	}
	const certificate = new X509Certificate(options.cert as string | Buffer)
	if (!certificate.checkHost(chatHost))
		throw new Error('Proxy certificate does not cover ' + chatHost)
	if (
		Date.parse(certificate.validFrom) > Date.now() ||
		Date.parse(certificate.validTo) <= Date.now()
	) {
		throw new Error(
			'Proxy certificate is not currently valid: ' +
				certificate.validFrom +
				' - ' +
				certificate.validTo
		)
	}
	tls.createSecureContext(options)
	console.log('Proxy certificate valid until ' + certificate.validTo)
	return options
}
