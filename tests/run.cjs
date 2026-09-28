const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const forge = require('node-forge')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xmpp-logger-test-'))
try {
	const keys = forge.pki.rsa.generateKeyPair(2048)
	const cert = forge.pki.createCertificate()
	cert.publicKey = keys.publicKey
	cert.serialNumber = '01'
	cert.validity.notBefore = new Date(Date.now() - 60000)
	cert.validity.notAfter = new Date(Date.now() + 86400000)
	cert.setSubject([{ name: 'commonName', value: 'localhost' }])
	cert.setIssuer(cert.subject.attributes)
	cert.setExtensions([
		{ name: 'basicConstraints', cA: true },
		{
			name: 'keyUsage',
			digitalSignature: true,
			keyEncipherment: true,
			keyCertSign: true
		},
		{
			name: 'subjectAltName',
			altNames: [
				{ type: 2, value: 'localhost' },
				{ type: 7, ip: '127.0.0.1' }
			]
		}
	])
	cert.sign(keys.privateKey, forge.md.sha256.create())
	fs.writeFileSync(
		path.join(directory, 'cert.pem'),
		forge.pki.certificateToPem(cert)
	)
	fs.writeFileSync(
		path.join(directory, 'key.pem'),
		forge.pki.privateKeyToPem(keys.privateKey)
	)
	const result = spawnSync(
		process.execPath,
		['--test', 'tests/proxy.test.cjs'],
		{
			stdio: 'inherit',
			env: {
				...process.env,
				XMPP_TEST_DIR: directory,
				NODE_EXTRA_CA_CERTS: path.join(directory, 'cert.pem')
			}
		}
	)
	process.exitCode = result.status ?? 1
} finally {
	// The only files removed are the two fixtures created above.
	for (const name of ['cert.pem', 'key.pem']) {
		const file = path.join(directory, name)
		if (fs.existsSync(file)) fs.unlinkSync(file)
	}
	fs.rmdirSync(directory)
}
