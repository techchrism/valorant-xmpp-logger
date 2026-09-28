import { exec } from 'node:child_process'

export async function isRiotClientRunning() {
	return new Promise<boolean>((resolve, reject) => {
		exec(
			'tasklist /fi "imagename eq RiotClientServices.exe"',
			(error, stdout, stderr) => {
				if (error) return reject(error)
				resolve(stdout.includes('RiotClientServices.exe'))
			}
		)
	})
}

const installStringRegex = new RegExp(
	'    UninstallString    REG_SZ    "(.+?)" --uninstall-product=valorant --uninstall-patchline=live'
)

export async function getRiotClientPath() {
	return new Promise<string>((resolve, reject) => {
		// It's not great but it works. Better than looking for start menu shortcuts
		exec(
			'reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Riot Game valorant.live" /v UninstallString',
			(error, stdout, stderr) => {
				if (error) return reject(error)

				const lines = stdout.split('\r\n')
				for (const line of lines) {
					if (line.startsWith('ERROR')) {
						return reject(new Error(line))
					} else {
						const match = installStringRegex.exec(line)

						if (match !== null) {
							return resolve(match[1])
						}
					}
				}
				reject(
					new Error(
						'Riot Client path was not found in the Valorant uninstall entry'
					)
				)
			}
		)
	})
}
