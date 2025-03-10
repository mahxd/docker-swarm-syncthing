import axios from 'axios'

        // for Docker: handle SIGINT and SIGTERM 
        process.on('SIGINT', function () { process.exit() })
        process.on('SIGTERM', function () { process.exit() })

        const debug = false

        const KEY = process.env.STGUIAPIKEY || ''
        const SECS = process.env.SYNCTHING_SLEEP || '60'
        const PORT = process.env.SYNCTHING_PORT || '8384'

        function arraysEqual(a1, a2) {
            return JSON.stringify(a1.sort()) == JSON.stringify(a2.sort());
        }

        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }


        // get data from Docker via docker.sock
        async function getDocker(url) {
            const options = {
                socketPath: '/var/run/docker.sock',
                headers: {
                    'Content-Type': 'application/json',
                }
            }
            const response = await axios.get(url, options);
            return response.data
        }

        // get IPs of all running tasks of a Docker service
        async function getDockerServiceIPs(name) {
            const filters = {
                'service': [name],
                'desired-state': ['running'],
            }
            const tasks = await getDocker('/tasks?filters=' + JSON.stringify(filters))

            let ips = []
            for (let t of tasks) {
                for (let n of t.NetworksAttachments) {
                    for (let i of n.Addresses) {
                        let ip = String(i).substring(0, i.indexOf('/'))
                        ips.push(ip)
                    }
                }
            }
            return ips
        }


        // get data from Syncthing
        async function getSyncthing(url) {
            const options = {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': KEY,
                }
            }
            const response = await axios.get(url, options);
            return response.data
        }

        // post data to Syncthing
        async function postSyncthing(url, post) {
            const options = {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': KEY,
                }
            }
            const response = await axios.post(url, post, options);
            return response.data
        }

        // patch data to Syncthing
        async function patchSyncthing(url, patch) {
            const options = {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': KEY,
                }
            }
            const response = await axios.patch(url, patch, options);
            return response.data
        }


        // get myID of a Syncthing instance
        async function getSyncthingID(ip) {
            const url = 'http://' + ip + ':' + PORT + '/rest/system/status'
            const data = await getSyncthing(url)
            return data.myID
        }

        // get all myIDs of all Syncthing instances
        async function getAllSyncthingIDs(ips) {
            let ids = []
            for (let ip of ips) {
                let id = await getSyncthingID(ip)
                ids.push(id)
            }
            return ids
        }


        // get devices of a Syncthing instance
        async function getSyncthingDevices(ip) {
            const url = 'http://' + ip + ':' + PORT + '/rest/config/devices'
            const data = await getSyncthing(url)
            return data.map(d => d.deviceID)
        }

        // add a device to a Syncthing instance
        async function addSyncthingDevice(ip, device) {
            const url = 'http://' + ip + ':' + PORT + '/rest/config/devices'
            const post = {
                deviceID: device,
                autoAcceptFolders: true
            }
            const data = await postSyncthing(url, post)
            return data
        }

        // add missing devices to every Syncthing instance
        async function addMissingSyncthingDevices(ips, ids) {
            for (let ip of ips) {
                let devices = await getSyncthingDevices(ip)
                for (let id of ids) {
                    if (!devices.includes(id)) {
                        console.log('add device to Syncthing', ip, id)
                        await addSyncthingDevice(ip, id)
                    }
                }
            }
        }


        // get folders of a Syncthing instance
        async function getSyncthingFolders(ip) {
            const url = 'http://' + ip + ':' + PORT + '/rest/config/folders'
            const data = await getSyncthing(url)
            return data.map(f => f.path)
        }

        // add a folder to a Syncthing instance
        async function addSyncthingFolder(ip, folder) {
            const url = 'http://' + ip + ':' + PORT + '/rest/config/folders'
            let post = {
                id: folder,
                label: folder,
                path: folder,
                "type": "sendreceive",
                "devices": []
            }
            for (let id of await getSyncthingDevices(ip)) {
                post.devices.push({ "deviceID": id })
            }
            const data = await postSyncthing(url, post)
            return data
        }

        // add devices to folder of every Syncthing instance
        async function addDevicesToFolder(ips, ids, name) {
            for (let ip of ips) {
                const url = 'http://' + ip + ':' + PORT + '/rest/config/folders/' + name
                let folder = await getSyncthing(url)
                let devices = folder.devices.map(d => d.deviceID)
                if (!arraysEqual(ids, devices)) {
                    console.log('patch folder devices at Syncthing', ip, folder.id, ids)
                    const patch = { 'devices': [] }
                    for (let i of ids) {
                        patch.devices.push({ 'deviceID': i })
                    }
                    await patchSyncthing(url, patch)
                } else {
                    console.log('folder already shared at Syncthing', ip, folder.id, ids)
                }
            }
        }

        // add missing folder to a single Syncthing instance
        async function addMissingSyncthingFolder(ip, folder) {
            let folders = await getSyncthingFolders(ip)
            if (!folders.includes(folder)) {
                console.log('add folder to Syncthing', ip, folder)
                await addSyncthingFolder(ip, folder)
            }
        }


        async function run() {
            const ips = await getDockerServiceIPs('syncthing_syncthing')
            console.log('Got IPs from Docker Swarm', ips)
            const ids = await getAllSyncthingIDs(ips)
            console.log('Got IDs from Syncthing', ids)
            const updatedDevices = await addMissingSyncthingDevices(ips, ids)
            const updatedFolders = await addDevicesToFolder(ips, ids, 'default')
        }

        while (true) {
            try {
                run()
            } catch (e) {
                console.error(e.message)
            }
            console.log('----- going to sleep for ' + SECS + ' seconds -----')
            await sleep(SECS * 1000)
        }
