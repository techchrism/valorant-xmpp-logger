import * as fs from 'node:fs'

(async () => {
    try {
        await fs.promises.mkdir('./logs')
    }
    catch (ignored) {}

    const logPath = `./logs/${(new Date()).getTime()}.txt`
    console.log(`Writing to ${logPath}`)

    const logStream = fs.createWriteStream(logPath)
    // Log header format
    logStream.write(JSON.stringify({
        type: 'valorant-xmpp-logger',
        version: '1.0.0'
    }) + '\n')
})()